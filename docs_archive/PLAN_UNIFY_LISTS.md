# План: унификация списков (один кубик «список» вместо двух)

> Контекст: после внедрения per-entity nested lists (вариант C, см.
> [PLAN_PER_ENTITY_LISTS_C.md](PLAN_PER_ENTITY_LISTS_C.md)) в системе появились **два
> параллельных списочных слоя** — root-list (старая модель, shared `ListState` по
> config-узлу) и per-entity-list (новая модель, `EntityListState` per-(owner,узел)).
> Они дублируются на ~90% и расходятся в 5 точках касания. Это и есть «кубики
> чуть-чуть разные».
>
> Цель: **один кубик «список»**, у которого root — вырожденный случай с одним
> владельцем. Подход — **унификация на объекте состояния** (Вариант 2 из анализа), без
> концептуального скачка «root = entity» (Вариант 1, см. §«Что осталось за рамками»).
>
> Принцип фаз (как в PLAN_PER_ENTITY_LISTS_C): **каждая фаза самодостаточна, сливается
> в main, имеет свои тесты и не ломает существующее поведение.** После каждой фазы:
> `npx vitest run` зелёный + `tsc -p tsconfig.build.json` чистый.

---

## Вердикт (для решения «делать / не делать»)

- **Делать стоит.** Per-entity-модель — строго более общая; root-list застрял на
  старой. Это не встречное движение двух дизайнов, а **подтягивание root к уже
  существующему правильному**. Большая часть «правильного» кода уже написана.
- **Объём:** ~5 фаз, каждая 0.5–1.5 дня. Удаляется один из двух builder-файлов
  (`buildEntityListProxy.ts`, 316 строк), одна из двух веток трекинга, один из двух
  sync-методов, один из двух resolve-путей, вестигиальное поле `ListState.version`.
- **Главный риск** — фазы U2 (трекинг/реактивность) и U5 (resolve): это самый старый
  и самый покрытый тестами код. Митигируется «мостами обратной совместимости»
  (dual-bump версии, единая точка входа при двух телах) и тем, что фазы независимы.
- **Точка невозврата отсутствует:** можно остановиться после любой фазы — система
  остаётся консистентной. Даже U0+U1 уже убирают самый заметный дубль (два builder-а).

---

## Целевая модель

Список **всегда** идентифицируется объектом `ListState`, живущим в per-owner
контейнере. Root — это `ownerEntity === null`.

```ts
// store/store/types.ts — ЕДИНЫЙ тип (EntityListState удаляется как алиас)
export interface ListState {
  listConfigNode: object;            // сам array-узел [template, listConfig?]
  template: object;                  // listConfigNode[0]
  listConfig?: ListConfig;           // listConfigNode[1]
  ownerEntity: EntityNode | null;    // null = root list; иначе — владелец
  itemIds: string[];
  initialItemIds: string[];
  // version — УДАЛЕНО (вестигиально; трекинг ключуется объектом ListState в хабе)
}
```

Из этого единообразно выводится всё:

| Точка касания | Было (2 ветки) | Стало (1 ветка) |
|---|---|---|
| **Brand трекинга** | `Array.isArray(configNode)` (root) / `ENTITY_LIST_STATE` (entity) | `LIST_STATE` → объект `ListState` (всегда) |
| **Хаб-версия** | `getNodeVersion(configNode)` (root) / `getNodeVersion(EntityListState)` (entity) | `getNodeVersion(listState)` (всегда) |
| **Builder** | `buildListProxy(node)` / `buildEntityListProxy(owner,node)` | `buildListProxy(listState)` |
| **Resolve** | `executeListResolve` / `triggerEntityListResolve` | `triggerListResolve(listState)` |
| **Resolve-state** | `states.get(node)` / `entityStates.get(ownerId,node)` | `listResolveStates.get(listState)` |
| **loading** | `nodeState.loading` (root) / `entityStates.status` (entity) | resolve-state `.status === "pending"` (всегда) |
| **valuesCache sync** | `_syncListValuesCache(node)` / `_syncEntityListValuesCache(owner,node)` | `syncListValuesCache(listState)` |

> Прецедент уже в коде: [`_restoreListsRec`](store/store/palistor.ts#L679-L762) обходит
> ОБА вида списков одним рекурсивным проходом, различая их по `ownerEntity === null`.
> Это эталон целевой формы — её надо распространить на остальные 4 точки касания.

---

## Фаза U0 — Единый тип `ListState` + brand `LIST_STATE` + удаление `version`

**Цель:** фундамент. Один тип состояния, один brand-символ, выпиленное мёртвое поле.
Поведение НЕ меняется.

### Шаги
1. **Тип.** В [store/store/types.ts:319](store/store/types.ts#L319) расширить `ListState`:
   добавить `listConfigNode: object` и `ownerEntity: EntityNode | null`; удалить `version`.
   В [store/entityRegistry/types.ts:34](store/entityRegistry/types.ts#L34) сделать
   `EntityListState` алиасом `ListState` (`export type EntityListState = ListState`) —
   чтобы не переписывать сразу все импорты; алиас удалить в конце.
2. **Root ListState.** В [registerNodes.ts:97-104](store/store/registerNodes.ts#L97-L104)
   при создании root-`ListState` проставить `listConfigNode: child`, `ownerEntity: null`,
   убрать `version: 0`.
3. **Entity ListState.** В
   [entityRegistry.getOrCreateEntityListState](store/entityRegistry/entityRegistry.ts#L218-L235)
   заполнять новые поля: `template = listConfigNode[0]`, `listConfig = listConfigNode[1]`,
   `ownerEntity = entity`.
4. **Удалить `version++`** из [buildListProxy.ts](store/buildProxy/buildListProxy.ts#L114)
   (4 места) и [executeListResolve.ts:135,143](store/resolvePipeline/executeListResolve.ts#L135).
   Проверено грепом: `ListState.version` читается ТОЛЬКО в тесте `listStateInit.test.ts`.
5. **Brand.** В [constants.ts:38](store/constants.ts#L38) переименовать `ENTITY_LIST_STATE`
   → `LIST_STATE`; оставить `export const ENTITY_LIST_STATE = LIST_STATE` (deprecated alias).

### Тесты / DoD
- Обновить `listStateInit.test.ts` (убрать assert на `version`).
- Полный `npx vitest run` зелёный, `tsc` чистый.

**Риск: низкий.** Объём: ~1 ч. Чисто структурный рефактор типа.

---

## Фаза U1 — Единый `buildListProxy(listState)` (удалить `buildEntityListProxy`)

**Цель:** одна функция-builder, владелец-агностичная. Тело читает/мутирует `listState`,
не зная, root это или entity. Внутренние вызовы resolve/sync пока **диспетчеризуются**
по `listState.ownerEntity` (на существующие две реализации — их слияние в U3/U5).

### Шаги
1. Переписать сигнатуру: `buildListProxy(listState: ListState, kernel)`.
   Все чтения `listState.itemIds`, item-проекции из `listState.template`.
2. Перенести мутации (`add`/`remove`/`setItems`) из обоих файлов — они почти идентичны;
   единственная разница (owner-stamping в per-entity) включается условием
   `if (listState.ownerEntity) kernel.entityRegistry.setEntityOwner(child, ownerId, node)`.
3. `getOwnerId` для root не нужен; `notifyListChanged` бампает `listState` (объект)
   через `notifyChanged([listState, ...])`. Для root дополнительно — мост из U2.
4. Внутренние диспетчеры (временно, до U3/U5):
   - sync: `listState.ownerEntity ? _syncEntityListValuesCache(owner,node) : _syncListValuesCache(node)`;
   - resolve: `listState.ownerEntity ? triggerEntityListResolve(...) : triggerResolve(node)`;
   - loading: тот же бранч, что сейчас.
5. Оба GET-трапа возвращают `listState` по `LIST_STATE`.
6. **Call sites:**
   - root: в [buildProxy.ts](store/buildProxy/buildProxy.ts) GET list-узла →
     `buildListProxy(listStates.get(node)!, kernel)`.
   - entity: в
     [buildEntityProjectionProxy.ts:150-157](store/buildProxy/buildEntityProjectionProxy.ts#L150-L157)
     → `buildListProxy(getOrCreateEntityListState(owner, node), kernel)`.
7. Единый кэш proxy: `WeakMap<ListState, object>` на `kernel.nodes`
   (заменяет и root-кэш, и `entityListProxyCache`).
8. **Удалить** `store/buildProxy/buildEntityListProxy.ts`.

### Тесты / DoD
- Все списочные тесты (`entityList*.test.ts`, `listResolve.test.ts`, `defineList.*`,
  `entity-list-*.test.tsx`) зелёные без изменений (поведение сохранено).
- `tsc` чистый.

**Риск: средний** (большой механический перенос, но логика сохранена). Объём: ~1 день.

---

## Фаза U2 — Единая ветка трекинга в `createTrackingProxy`

**Цель:** убрать дубль из [createTrackingProxy.ts](react/createTrackingProxy.ts) — две
ветки (`ENTITY_LIST_STATE` [:94-128](react/createTrackingProxy.ts#L94-L128) и
`Array.isArray(configNode)` [:144-180](react/createTrackingProxy.ts#L144-L180)) → одна,
ключующаяся на `LIST_STATE`. Root-list начинает трекаться по объекту `ListState`, а не
по config-узлу.

### Шаги
1. Одна ветка: `const listState = target[LIST_STATE]; if (listState) { ... }` —
   для `items`/`map`/`length`/`loading`/`dirty` трекать `listState` (как сейчас делает
   entity-ветка). **Удалить** ветку `Array.isArray(configNodeForList)`.
2. **Реактивность root.** Сейчас root-мутации/resolve бампают хаб-версию config-узла
   (`notifyChanged([listNode])`). Теперь надо бампать объект `listState`. **Мост обратной
   совместимости:** на переходный период бампать ОБА (`notifyChanged([listState, listNode])`),
   чтобы существующие тесты `getNodeVersion(listNode)` (в `defineList.resolver.test.ts`,
   `listResolve.test.ts`) остались зелёными. Финальная зачистка моста + миграция тестов на
   `getNodeVersion(listState)` — отдельным коммитом в конце фазы.

### Тесты / DoD
- React-тесты ре-рендеров списков (root и per-entity) зелёные.
- Тест изоляции версий per-owner (`entityListResolve.test.ts`) зелёный.
- Новый тест: root-list трекается по `LIST_STATE`-объекту (версия растёт на нём).

**Риск: средний-высокий** (ядро реактивности). Митигация: dual-bump мост. Объём: ~1 день.

---

## Фаза U3 — Единый `syncListValuesCache(listState)`

**Цель:** слить [`_syncListValuesCache`](store/store/palistor.ts#L589) и
[`_syncEntityListValuesCache`](store/store/palistor.ts#L631) в один метод, ветвящийся по
`listState.ownerEntity`.

### Шаги
1. `syncListValuesCache(listState)`:
   - `ownerEntity === null` → текущая root-логика (nodeSlot для `listConfigNode`);
   - иначе → текущая per-entity-логика (projectionObj владельца + path из `listFieldKeys`).
2. Обновить все call sites на единый метод (builder из U1, restoreLists, resolve).
3. Убрать диспетчер sync из U1-builder.

### Тесты / DoD
- `entityListGetValues.test.ts`, `entityListPersist.test.ts`, root getValues-тесты зелёные.

**Риск: низкий-средний.** Объём: ~0.5 дня.

---

## Фаза U5 — Единый resolve-путь `triggerListResolve(listState)`

> (нумерация оставляет «U4» зарезервированным под опциональное слияние reset/dirty —
> см. §«Дополнительно».)

**Цель:** слить [`executeListResolve`](store/resolvePipeline/executeListResolve.ts) и
[`triggerEntityListResolve`](store/init/createResolveManager.ts#L323) в один путь.
Самая тонкая фаза — здесь расходятся retry/optimistic/auto-deps. **Делать последней.**

### Шаги
1. Единое хранилище resolve-state списков: `Map<ListState, ResolveState>`
   (заменяет `states.get(listNode)` для root и `entityStates.get(ownerId,node)` для entity).
2. Единая точка входа `triggerListResolve(listState)`. Ветви по `ownerEntity`:
   - **values для resolver-а:** root → snapshot через values-tracking-proxy (auto-deps);
     entity → `buildEntityValues(owner)`. ⚠️ **Решение:** дать ли per-entity тоже auto-deps
     и retry? Сейчас нет. Рекомендация — да (выравнивание возможностей), но это
     поведенческое расширение → отдельный under-test флаг/коммит.
   - **owner-stamping:** `if (ownerEntity)` проставить owner детям + индексировать.
   - **loading:** оба → `resolveState.status`. Root перестаёт писать `nodeState.loading`
     (proxy.loading в U1 уже читает resolve-state).
3. Если расхождение retry/optimistic слишком велико — допустимо оставить **два тела**
   (`_executeRootListResolve` / `_executeEntityListResolve`), но **одну точку входа и одно
   хранилище state**. Это уже снимает дубль на уровне API; внутренняя развилка — мелочь.

### Тесты / DoD
- `listResolve.test.ts`, `defineList.resolver.test.ts`, `entityListResolve.test.ts` зелёные.
- Новый тест: root и per-entity list `loading` берётся из одного источника (resolve-state).

**Риск: высокий.** Объём: ~1.5 дня. Митигация: «одна точка входа, два тела» как fallback.

---

## Дополнительно (опционально, низкий приоритет)

- **U4 — reset/dirty:** `resetEntityListStates` и root-reset списков можно объединить в
  один проход по всем `ListState` (root + per-entity лежат в одном «реестре состояний»,
  если завести `allListStates` включающим и per-entity). Мелочь, но добивает единообразие.
- **Единый реестр состояний:** сейчас root-`ListState` лежат в `nodes.listStates`,
  per-entity — в `owner.lists`. Можно ввести `kernel.listStates: Set<ListState>` (или
  итератор), чтобы reset/persist/debug обходили ВСЕ списки единообразно. Не обязательно
  для унификации builder/tracking/resolve, но завершает картину «один реестр кубиков».

---

## Что осталось за рамками (Вариант 1: «root = синглтон-entity»)

Полная унификация контейнера (root config становится одной EntityNode-синглтоном, и
тогда `listStates` вообще исчезает — остаётся только `owner.lists`, где owner корня =
root-entity) — **не входит в этот план**. Она дополнительно потребовала бы:
- протащить root через `EntityRegistry` / `nodeViews` / `buildEntityValues`;
- переписать valuesCache root на projectionObj-модель;
- мигрировать dirty/submit/persist корня на entity-путь.
Это отдельный крупный эпик с высоким риском на самом старом коде. После U0–U5 разрыв
между «root» и «entity» сузится до **способа хранения одного `ListState`** (nodeSlot vs
projectionObj) — и тогда Вариант 1 станет дешёвым добиванием, если вообще понадобится.

---

## Карта рисков

| Риск | Митигация |
|------|-----------|
| U2 ломает реактивность root-списков (версия мигрирует с config-узла на `ListState`). | Dual-bump мост: бампать оба узла на переходный период; миграция тестов отдельным коммитом. |
| U5: при слиянии resolve теряются retry/optimistic/auto-deps root-списка. | «Одна точка входа, два тела» как fallback; новые тесты на каждую ветку перед слиянием. |
| `EntityListState`-алиас и `ENTITY_LIST_STATE`-алиас «застрянут» навсегда. | Явный финальный коммит-зачистка алиасов после U5; grep на 0 использований. |
| Per-entity получает auto-deps/retry → меняется поведение существующих per-entity resolve. | Поведенческое расширение — отдельный коммит под тестами, не смешивать со слиянием API. |
| Единый proxy-кэш `WeakMap<ListState,_>` живёт дольше владельца (утечка). | `ListState` per-entity удаляется вместе с владельцем (`node.lists.clear()` в delete) → WeakMap-ключ собирается GC. Root-`ListState` живёт столько же, сколько store. |

---

## Контрольные точки (после каждой фазы)

1. `npx vitest run` — зелёный.
2. `npx tsc --noEmit -p tsconfig.build.json` — без ошибок.
3. Обновить [architecture.md](architecture.md) раздел «Списки» (одна модель вместо двух).
4. Коммит `refactor(lists): phase Ux — <one-liner>`.
5. Короткий review-комментарий «что упростилось в реальности» — вход в следующую фазу.
</content>
</invoke>
