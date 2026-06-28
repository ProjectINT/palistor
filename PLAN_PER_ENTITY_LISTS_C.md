# План внедрения варианта C: Per-Entity Nested Lists

> Контекст: см. [PROPOSAL_PER_ENTITY_LISTS_RFC.md](PROPOSAL_PER_ENTITY_LISTS_RFC.md), вариант **C**.
> Аудитория: исполнитель — модель Sonnet, работающая по одной фазе за итерацию.
> Принцип: **каждая фаза самодостаточна, сливается в main, имеет свои тесты и не ломает существующее поведение.**

---

## Статус (актуализировано 2026-06-24)

**В коде не сделано ничего.** Оба документа (`PLAN_*`, `PROPOSAL_*`) — untracked, ни одной строки реализации нет:

- C0 **не сделан** — в [buildEntityProjectionProxy.ts:151-157](store/buildProxy/buildEntityProjectionProxy.ts#L151-L157) всё ещё `return undefined` (не `throw`).
- C1–C4 **не начаты** — нет `EntityListState`, `buildEntityListProxy`, `executeEntityListResolve`, `childrenByOwner`, owner-ссылок. Проверено grep-ом: совпадений 0.
- [entity-list-field.test.tsx](react/entity-list-field.test.tsx): **2/4 passed, 2 failed** (`TypeError: Cannot read properties of undefined (reading 'proxy')` в [useForm.ts:94](react/useForm.ts#L94)) — ровно то, что описывает RFC §1.2. Оба теста уже написаны как «позитивные» (не `it.todo`), так что C0 потребует их временно переписать (см. C0 шаг 2).

**Корректировки плана после ревизии кода** (детали — в соответствующих фазах):
1. **Tracking** (C1 §6) переписан: версия per-(owner,list) ведётся через сам объект `EntityListState` как ключ в существующем `NotificationHub` (`notifyChanged`/`getNodeVersion`/`subscribe` уже принимают любой объект-узел). Новый публичный метод `getEntityListVersion` **не нужен** — он удалён из плана.
2. **Resolve-state** (C1 §3): переиспользуем существующий `ResolveManager.entityStates` (`EntityResolveStateMap`, ключ `(ownerId, node)`) — как уже делают template-binding и field-resolve. Параллельный sub-registry `entityListStates` **не заводим**.
3. **Новый риск** (критичный): `lists`/`owner` на `EntityNode` обязаны быть **non-enumerable**, иначе `buildEntityValues` ([buildEntityProjectionProxy.ts:14-31](store/buildProxy/buildEntityProjectionProxy.ts#L14-L31)) затянет их в плоский snapshot values для резолверов/computed. См. карту рисков.
4. **Предсуществующий shared `ListState`**: `registerNodes` ([registerNodes.ts:92-108](store/store/registerNodes.ts#L92-L108)) уже создаёт ОДИН общий `ListState` для in-template list-узла. Per-entity слой обязан его игнорировать. См. C1 §1.
5. **Q4 уточнён**: resolver получает плоский snapshot владельца через `buildEntityValues`, НЕ projection-proxy (вопреки заявленной «симметрии» — template-resolve реально передаёт proxy). Тест читает `values.id` — плоский snapshot этого достаточно.

---

## 0. Решения по открытым вопросам (Q1–Q5 из RFC §5)

Зафиксированы перед стартом C1, иначе ownership-модель будет несогласованной.

| Q | Решение | Обоснование |
|---|---------|-------------|
| **Q1. Где хранятся child-entity** | В **общем** `entityRegistry`, но `EntityNode` получает поле `owner?: { ownerId: string; ownerListNode: object }`. | Реиспользуем существующую инфраструктуру (leaf nodes, nodeState, dirty, writePipeline). Не плодим параллельный sub-registry. |
| **Q2. Неймспейс ID children** | **Глобальный**. ID должен быть уникален в пределах store. Конфликт → ошибка при `set`. | Совпадает с текущей моделью registry. Per-owner неймспейс потребовал бы рефакторинга всего lookup-слоя. |
| **Q3. Каскадное удаление** | На `delete(ownerId)` → каскадно удаляются все children, у которых `owner.ownerId === ownerId`. Реализуется через обратный индекс `childrenByOwner: Map<string, Set<string>>`. | Иначе orphan-сущности будут жить в registry без visible корня. |
| **Q4. Аргументы resolver-а child-list** | Resolver получает `(parentValues, store)`, где `parentValues` — flat snapshot **владельца**, собранный через `buildEntityValues(ownerEntity, nodeState)`. `ownerId` доступен через `parentValues.id`. | ⚠️ Уточнение: `triggerEntityTemplateResolve` реально передаёт **projection-proxy**, а не flat snapshot ([createResolveManager.ts:277](store/init/createResolveManager.ts#L277)). Полной «симметрии» нет. Для child-list берём flat snapshot, потому что у нас на руках только `ownerEntity` (EntityNode) + `listConfigNode`, без owner-template-node, нужного для построения proxy. Падающий тест читает `values.id` — flat snapshot этого достаточно. |
| **Q5. `useForm(form.contacts)` API** | Не меняется. Возвращает list-proxy с независимым tracking. Внутри — per-entity `EntityListState`. | API стабильность; вся новизна — в storage layer. |

---

## Фаза C0 — Понятная ошибка вместо `undefined` (опционально, ~1 час)

> **Решение:** C0 — это страховочный стоп-ган. Он имеет смысл, **только если C1 не садится в тот же присест** (нужен промежуточный безопасный коммит). Если C1 реализуется сразу — **C0 пропускаем**: C1 всё равно заменяет тот же `throw`/`undefined` на рабочий билдер, а тесты в C0 пришлось бы переписать дважды (туда — в `toThrow`, обратно — в позитивные). Не помечен ✅: в коде НЕ сделан.

**Цель:** убрать молчаливый `undefined` в [store/buildProxy/buildEntityProjectionProxy.ts](store/buildProxy/buildEntityProjectionProxy.ts#L151-L157). Это разблокирует написание тестов под C1 и улучшит DX уже сейчас.

### Шаги

1. В [store/buildProxy/buildEntityProjectionProxy.ts](store/buildProxy/buildEntityProjectionProxy.ts) в ветке `Array.isArray(templateField)` бросить:
   ```ts
   throw new Error(
     `[palistor] Per-entity list "${String(key)}" inside template entity is not supported yet. ` +
     `See PROPOSAL_PER_ENTITY_LISTS_RFC.md (variant C). ` +
     `Workaround: declare list at root of config and filter by ownerId.`,
   );
   ```
2. В [react/entity-list-field.test.tsx](react/entity-list-field.test.tsx):
   - один из двух упавших тестов переписать в позитивный: `expect(() => render(<UserCard .../>)).toThrow(/per-entity list/i)`;
   - второй — пометить `it.todo(...)` со ссылкой на C1.
3. Запустить `npx vitest run react/entity-list-field.test.tsx` — все 4 теста зелёные.
4. Запустить полный `npx vitest run` — регресс отсутствует.

### Definition of Done
- Все существующие тесты зелёные.
- Сообщение об ошибке упоминает RFC и workaround.
- Нет изменений вне `buildEntityProjectionProxy.ts` и одного теста.

---

## Фаза C1 — Read-only per-entity list (основная фаза)

**Цель:** `form.contacts` для каждой entity возвращает **отдельный** list-proxy с `items`, `length`, `loading`, `map`, `getById`, итерацией. Resolver вызывается **per-entity**, состояние кэшируется в registry, при unmount/remount не теряется. **Без** `add/remove/setItems/dirty/persist/getValues`.

### Архитектурные сущности

> ⚠️ **Предсуществующий shared `ListState`.** `registerNodes` ([registerNodes.ts:92-108](store/store/registerNodes.ts#L92-L108)) уже при инициализации обходит in-template list-узел (`editUser.contacts`) и кладёт ОДИН общий `ListState` в `kernel.nodes.listStates`, ключ — сам array-узел. Этот объект — корень проблемы из RFC §2.1 (один itemIds на всех владельцев). Per-entity слой его **не использует и не мутирует**; всё состояние — в `EntityListState` per-owner. Удалять shared `ListState` в C1 не нужно (его трогают dirty-recompute и valuesCache для root-lists), но `buildEntityListProxy` обязан читать только `EntityNode.lists`.

#### 1. `EntityListState` (новый тип)
В [store/entityRegistry/types.ts](store/entityRegistry/types.ts):
```ts
export interface EntityListState {
  /** Конфиг-узел list (ListNode из template — array). Дублирует ключ Map — для удобства. */
  listConfigNode: object;
  /** ID элементов в порядке отображения. */
  itemIds: string[];
  /** Initial для будущего dirty (C3). В C1 заполняется при resolve. */
  initialItemIds: string[];
  /** Per-(owner,list) version для tracking. Сам объект EntityListState — ключ версии в хабе (§6). */
  version: number;
}
```
> Поле `version` оставляем для совместимости/отладки, но **источник правды для re-render — `getNodeVersion(entityListState)`** (см. §6), а не это число. Бампать оба синхронно либо опираться только на хаб — решить при имплементации (рекомендация: только хаб, `version` убрать, если не понадобится).

#### 2. `EntityNode.lists` (расширение)
В [store/entityRegistry/types.ts](store/entityRegistry/types.ts):
```ts
export interface EntityNode extends EntityGroupNode {
  id: EntityLeafNode;
  /** Map<listConfigNode, EntityListState>. Лениво создаётся. NON-ENUMERABLE. */
  lists?: Map<object, EntityListState>;
  /** Owner reference для child-entity (C1 уже проставляет при заливке resolver-результата). NON-ENUMERABLE. */
  owner?: { ownerId: string; ownerListNode: object };
}
```
> ⚠️ **`lists` и `owner` ОБЯЗАНЫ быть non-enumerable** — присваивать через `Object.defineProperty(node, "lists"/"owner", { value, enumerable: false, writable: true, configurable: true })`. Иначе `buildEntityValues` и любые `Object.keys(entityNode)`-обходы затянут их в плоские values (см. карту рисков — это критичный баг, не косметика).
>
> ⚠️ `Map` хранится прямо на `EntityNode` (а не в side `WeakMap`), потому что `EntityNode` — обычный объект registry, и нам нужно гарантировать удаление вместе с владельцем при `delete(ownerId)`. Альтернатива — `WeakMap<EntityNode, Map<...>>` в `nodes` — допустима, но усложняет cleanup.
>
> Поправка к RFC: `owner` НЕ «резервируется без использования» — уже в C1 резолвер проставляет его при заливке children (нужно для tracking-cleanup и как фундамент C2). Не используется только **каскад** удаления (он в C2).
>
> **Хелпер:** `getOrCreateEntityListState(ownerEntity, listConfigNode): EntityListState` в `entityRegistry`.

#### 3. Resolve-state — переиспользуем `ResolveManager.entityStates` (НЕ новый sub-registry)
В коде уже есть `EntityResolveStateMap` ([store/resolvePipeline/types.ts:136](store/resolvePipeline/types.ts#L136)), ключ `(entityId, node)`, на котором работают и template-binding-resolve, и field-resolve. List-resolve кладём туда же, ключ `(ownerId, listConfigNode)`. `ResolveState` уже несёт `status / promise / error / dependencies / attempt` — этого достаточно; отдельный тип `EntityListResolveState` и отдельный `Map` **не заводим**.

Файл: [store/init/createResolveManager.ts](store/init/createResolveManager.ts) (рядом с `triggerEntityTemplateResolve`). Новый метод:
```ts
triggerEntityListResolve(ownerId: string, listConfigNode: object, ownerEntity: EntityNode): void
```
Сигнатура и тело — по образцу `triggerEntityTemplateResolve` ([createResolveManager.ts:252-305](store/init/createResolveManager.ts#L252-L305)), не `executeEntityTemplateResolve` (такого метода нет). Внутри:
1. читает `resolve = listConfigNode[1]?.resolve`; если нет resolver-а — return;
2. `state = entityStates.getOrCreate(ownerId, listConfigNode, deps)`;
3. дедупликация: `if (state.status === "pending") return;`
4. (deps-инвалидация — как у field-resolve через `_retriggerEntityFieldResolves`; в C1 достаточно «resolved → skip», deps-driven re-resolve можно отложить, но deps-ключ всё равно строится по `parentValues`);
5. `state.status = "pending"` → notify (`notifyChanged(new Set([entityListState]))` — см. §6);
6. строит `parentValues = buildEntityValues(ownerEntity, nodeState)` (см. Q4);
7. `await resolve.resolver(parentValues, store)`;
8. результат → внутренний `setEntitiesRaw(items, listConfigNode)` (уже существует, [createResolveManager.ts:47](store/init/createResolveManager.ts#L47)), затем для каждого item проставить `owner: { ownerId, ownerListNode: listConfigNode }` (см. C1 §План.3);
9. заполняет `EntityListState.itemIds = result.map(r => r.id)`, `initialItemIds = [...itemIds]`;
10. `state.status = "resolved"`; bump version → notify (см. §6).

> `loading` для proxy читается из этого же состояния: `entityStates.get(ownerId, listConfigNode)?.status === "pending"` — ровно так, как projection-proxy читает template-binding loading ([buildEntityProjectionProxy.ts:126](store/buildProxy/buildEntityProjectionProxy.ts#L126)).

#### 4. `buildEntityListProxy` (новый файл)
[store/buildProxy/buildEntityListProxy.ts](store/buildProxy/buildEntityListProxy.ts):
```ts
export function buildEntityListProxy(
  ownerEntity: EntityNode,
  listConfigNode: AnyConfigNode,   // [template, listConfig?]
  kernel: Palistor<any>,
): ListProxyNode<object>
```
- Структурно повторяет существующий `buildListProxy` ([store/buildProxy/buildListProxy.ts](store/buildProxy/buildListProxy.ts)), но читает `EntityListState` (с `EntityNode`) вместо общего `ListState` из `listStates`.
- ⚠️ **Не использовать** `kernel.nodes.listStates.get(listConfigNode)` — там лежит предсуществующий **shared** `ListState` (см. C1 §1), общий на всех владельцев. Per-entity слой работает только со своим `EntityListState`.
- При первом доступе к `items`/`length`/`map`/итерации — лениво триггерит resolve, **но через `queueMicrotask`**, как `buildListProxy.triggerLazyResolveIfNeeded` ([buildListProxy.ts:90-101](store/buildProxy/buildListProxy.ts#L90-L101)): синхронный вызов resolve→notify внутри GET-трапа во время React-рендера даёт «Cannot update a component while rendering another». Триггерим только если `entityStates.get(ownerId, listConfigNode)?.status === "idle"` (или отсутствует).
- `loading` → `entityStates.get(ownerId, listConfigNode)?.status === "pending"` (НЕ `nodeState[listNode].loading`).
- Item-proxy строится через **существующий** `buildEntityProjectionProxy(childEntity, template, kernel, perListCache)`, где `template = listConfigNode[0]`.
- В C1 публикует только: `items`, `length`, `loading`, `map`, `getById`, `[Symbol.iterator]`. Мутации (`add`/`remove`/`setItems`) бросают `Error("per-entity list mutations not supported until phase C2")`.
- Кэш list-proxy: `WeakMap<EntityNode, Map<listConfigNode, ListProxyNode>>` на `kernel.nodes` (новое поле `entityListProxyCache`) — стабильные ссылки для React.

#### 5. Интеграция с `buildEntityProjectionProxy`
В [store/buildProxy/buildEntityProjectionProxy.ts](store/buildProxy/buildEntityProjectionProxy.ts), в проверке `Array.isArray(templateField)`:
- **убрать** `throw` из C0;
- **вернуть** `buildEntityListProxy(rootEntityNode, templateField, kernel)`.

#### 6. Tracking (переписано — это была самая слабая часть плана)

**Проблема изоляции.** `NotificationHub` ведёт версии и подписки по **объекту-узлу** (`nodeVersions`/`nodeListeners`, [createNotificationHub.ts:99-101,160-162](store/init/createNotificationHub.ts#L99-L162)). Tracking proxy для списков сейчас берёт ключ = `CONFIG_NODE` и проверяет `Array.isArray(configNode)` ([createTrackingProxy.ts:103-139](react/createTrackingProxy.ts#L103-L139)). Но `listConfigNode` (`contacts`) — ОДИН на всех владельцев. Если per-entity proxy отдаст его как ключ трекинга, версии Alice и Bob схлопнутся → перерисовка всех карточек при изменении любой. Это и есть требование изоляции из RFC §2.6.

**Решение (простое, без нового публичного API).** Идентичностью per-(owner,list) служит сам объект `EntityListState` (живёт на `EntityNode.lists`, уникален на владельца). Существующий хаб уже умеет работать с любым объектом-узлом, поэтому:
- resolve/мутации делают `kernel.notifyChanged(new Set([entityListState]))` → бампается версия именно этого узла;
- чтение версии — `kernel.getNodeVersion(entityListState)` (уже есть, [palistor.ts:309](store/store/palistor.ts#L309)); **новый `getEntityListVersion` НЕ нужен** — удалён из плана;
- подписка — штатный `hub.subscribe(entityListState, …)`.

**Что для этого нужно в proxy + tracking:**
1. `buildEntityListProxy` экспонирует `EntityListState` через **бренд-символ** `ENTITY_LIST_STATE` (новая константа в [store/constants.ts](store/constants)) — отдельно от `CONFIG_NODE`. (`CONFIG_NODE` может по-прежнему отдавать `listConfigNode` для отладки/`useForm`, но ключом трекинга он быть не должен.)
2. В [createTrackingProxy.ts](react/createTrackingProxy.ts) добавить ветку **до** существующей `Array.isArray(configNode)`: если у target есть `ENTITY_LIST_STATE` — для `items`/`map`/`length`/`loading` трекать ИМЕННО этот объект (`refs.accessed.add(entityListState)` + `lastVersions.set(entityListState, store.getNodeVersion(entityListState))`), а `items`/`map` оборачивать в дочерние tracking-proxy как сейчас.
3. `useForm` (стандартный режим) уже подписывается на все узлы из `refs.accessed` — раз там лежит `entityListState`, ре-рендер per-owner заработает автоматически, отдельной проводки в `useForm` не требуется.

> Почему не `WeakMap<...>`-«виртуальный узел»: `EntityListState` уже создаётся per-owner и хранится на `EntityNode` → удаляется вместе с владельцем (cleanup в C2 бесплатный). Дополнительная сущность-ключ не нужна.

### План действий C1

1. **Типы:** обновить [store/entityRegistry/types.ts](store/entityRegistry/types.ts) (`EntityListState`, `EntityNode.lists`, `EntityNode.owner`). ⚠️ `lists` и `owner` объявить и **присваивать как non-enumerable** (`Object.defineProperty(node, "lists", { value, enumerable: false, writable: true })`), иначе `buildEntityValues` ([buildEntityProjectionProxy.ts:14-31](store/buildProxy/buildEntityProjectionProxy.ts#L14-L31)) и прочие `Object.keys(entityNode)`-обходы утянут их в плоские values. См. карту рисков.
2. **Registry helpers:** в [store/entityRegistry/entityRegistry.ts](store/entityRegistry/entityRegistry.ts) добавить:
   - `getOrCreateEntityListState(entity, listConfigNode): EntityListState` (создаёт `EntityNode.lists` лениво, non-enumerable);
   - `childrenByOwner: Map<string, Set<string>>` + `getChildrenByOwner(ownerId): Set<string>` (индекс нужен для C2, но заводим сейчас, чтобы owner-link регистрировался с самого начала). Чистить в `delete`/`rekey` (сейчас `delete` чистит только `entities/bindings/resolvedCache` — [entityRegistry.ts:175-181](store/entityRegistry/entityRegistry.ts#L175-L181)).
3. **Set with owner:** при заливке результатов резолвера проставлять `EntityNode.owner = { ownerId, ownerListNode }` (non-enumerable) и индексировать в `childrenByOwner`. Делать это после `setEntitiesRaw` внутри `triggerEntityListResolve` (а не менять публичный `store.set`).
4. **ResolveManager:** добавить `triggerEntityListResolve(ownerId, listConfigNode, ownerEntity)` в [store/init/createResolveManager.ts](store/init/createResolveManager.ts), переиспользуя `entityStates` (см. §3). Новый sub-registry НЕ заводить.
5. **Proxy builder:** создать [store/buildProxy/buildEntityListProxy.ts](store/buildProxy/buildEntityListProxy.ts) (см. §4).
6. **Projection proxy:** обновить [store/buildProxy/buildEntityProjectionProxy.ts](store/buildProxy/buildEntityProjectionProxy.ts) — в ветке `Array.isArray(templateField)` ([buildEntityProjectionProxy.ts:150-157](store/buildProxy/buildEntityProjectionProxy.ts#L150-L157)) вместо `return undefined` вернуть `buildEntityListProxy(rootEntityNode, templateField, kernel)`. ⚠️ `rootEntityNode` здесь = текущий `entityNode`, который при рекурсии в nested-группы СБРАСЫВАЕТСЯ ([buildEntityProjectionProxy.ts:69](store/buildProxy/buildEntityProjectionProxy.ts#L69)). Для C1 (list прямо под корневым template) это корректно; для C4 (list внутри nested group) нужно протащить настоящий owner-id отдельным параметром — см. C4.
7. **Constants:** добавить символ `ENTITY_LIST_STATE` в [store/constants.ts](store/constants).
8. **Tracking:** в [react/createTrackingProxy.ts](react/createTrackingProxy.ts) добавить ветку для entity-list по бренду `ENTITY_LIST_STATE` (см. §6). Публичный `getEntityListVersion` НЕ добавляем — используем существующий `getNodeVersion(entityListState)`.

### Тесты C1
- Сделать зелёными 2 падающих теста в [react/entity-list-field.test.tsx](react/entity-list-field.test.tsx) (они уже написаны как позитивные — `it`, не `it.todo`). Если делался C0 — вернуть их из `toThrow` обратно в позитивные.
- Добавить в [store](store) новый файл `entityListResolve.test.ts`:
  - resolver вызывается per-owner с правильными `parentValues` (проверить, что `parentValues.id === ownerId` и в нём НЕТ `lists`/`owner` — регресс на non-enumerable);
  - повторный mount той же entity не дёргает resolver (кэш hit — `status === "resolved"`);
  - смена `deps` — re-resolve (если deps-driven re-resolve вошёл в C1; иначе явно пометить `it.todo` со ссылкой на C-фазу, где он появится);
  - два владельца → два независимых `itemIds`;
  - изменение списка одного владельца не бампит `getNodeVersion(entityListState)` другого (изоляция tracking — ключевой тест на §6);
  - mutating API (`add`/`remove`/`setItems`) бросает осмысленную ошибку про C2.
- Регресс: весь существующий `npx vitest run` — зелёный (особое внимание — тестам на `getValues`/computed, чтобы `lists`/`owner` не протекли).

### Definition of Done C1
- 4/4 теста в `entity-list-field.test.tsx` зелёные.
- Новые тесты `entityListResolve.test.ts` зелёные.
- `store.delete(ownerId)` работает корректно (см. ниже): удаляет EntityListState владельца, но **child-entity пока остаются** (это ок для C1, потому что child-set не управляется записями; resolver просто перезальёт). Каскад и orphan handling — фаза C2.
- Документация: добавить раздел про per-entity lists в [README.md](README.md) или `architecture.md`.

### Что НЕ делаем в C1
- Никаких `add`/`remove`/`setItems` для child-list.
- Никакого dirty по составу child-list.
- Никакого включения в `getValues()`.
- Никакого persist child-list.
- Никакого каскадного удаления по `delete(ownerId)`.

---

## Фаза C2 — Mutations + Ownership ✅

**Цель:** включить `add`/`remove`/`setItems` для per-entity list. Сделать ownership-модель честной: child-entity при `delete(ownerId)` каскадно удаляются.

> **Сделано (2026-06-24).** Все шаги реализованы. Тесты: `store/entityListMutations.test.ts` (9 шт.) зелёные, полный `npx vitest run` зелёный (962), `tsc -p tsconfig.build.json` чистый.
>
> **Что упростилось/уточнилось против плана:**
> 1. **Каскад вынесен в `Palistor.delete`, а не в `EntityRegistry.delete`.** Registry изолирован от store (нет доступа к NodeRegistry/resolveManager), поэтому чисто-registry-каскад протёк бы leaf-нодами. `Palistor.delete` рекурсивно вызывает себя по `childrenByOwner`, переиспользуя полную per-entity очистку (leaves + resolve-states + notify). `EntityRegistry.delete` чистит только свои структуры (`childrenByOwner`, `EntityNode.lists`).
> 2. **Новый notify-канал `notifyEntityListChanged` НЕ понадобился** (шаг 3 плана). Идентичность трекинга — сам объект `EntityListState` (как в C1), поэтому мутация делает `notifyChanged([entityListState])` + `recompute` — тот же путь, что и resolve. Один канал на resolve и мутации.
> 3. **Ownership «один владелец на child»** реализован в `setEntityOwner`: при переадресации снимается устаревшее членство из `childrenByOwner` прежнего владельца. Это разруливает кейс «child у двух владельцев» детерминированно (last-write-wins) без отдельного warning/ошибки.
> 4. **`add(values)` предзадаёт id** (генерирует `_tmp_`, если нет) и делает один `kernel.set` — без двойного upsert, которым страдает root-level `buildListProxy.addFn` (там id-less `add` создаёт две entity).
> 5. Параллельно: починена предсуществующая (не из C2) рассинхронизация `computeProxyKeys.test.ts` с `LIST_SPREAD_KEYS` (отсутствовал `getValues`).

### Шаги

1. **Каскадное удаление:** в [store/entityRegistry/entityRegistry.ts](store/entityRegistry/entityRegistry.ts) — при `delete(id)`:
   - обойти `childrenByOwner.get(id)`;
   - для каждого child-id рекурсивно `delete(childId)`;
   - очистить `EntityNode.lists` владельца.
2. **Mutations в `buildEntityListProxy`:**
   - `add(values)`: генерация id (через `generateId`), `set` с `owner = { ownerId, ownerListNode }`, push в `itemIds`, bump `version`, notify.
   - `add(id)`: проверить, что entity существует, иначе ошибка; push в `itemIds`.
   - `remove(id)`: убрать из `itemIds`; **не** удалять entity из registry (entity может быть переиспользована в другом списке). Cascade происходит **только** на `delete(ownerId)`.
   - `setItems(ids)`: replace `itemIds`, проверить existence, bump `version`.
3. **Notify-каналы:** при мутациях — `notifyChanged(ownerEntity)` + `notifyEntityListChanged(ownerId, listNode)` (новый канал, потребуется для tracking).
4. **Reset:** `store.reset()` должен возвращать `itemIds = initialItemIds` для всех `EntityListState`. Реализуется в существующем `resetPipeline`.

### Тесты C2
- Новый файл `entityListMutations.test.ts`:
  - `add` создаёт child с правильным `owner`;
  - `remove` не трогает другие списки;
  - `delete(ownerId)` каскадно удаляет children;
  - `delete` владельца с child-у-двух-владельцев — поведение зафиксировано (рекомендация: child принадлежит **одному** owner, делим через `add(id)` для shared доступа; дублирование — ошибка либо warning).
  - `reset()` возвращает initial composition.

### Definition of Done C2
- Все мутации работают изолированно per-owner.
- Каскадное удаление — без orphan'ов, без утечек памяти (`childrenByOwner` тоже чистится).
- Регресс зелёный.

---

## Фаза C3 — Persist + dirty + getValues ✅

**Цель:** child-list попадает в `getValues()`, в `dirty` корня, в persist-снапшот.

> **Сделано (2026-06-24).** Тесты: `entityListGetValues.test.ts` (6), `entityListDirty.test.ts` (5),
> `entityListPersist.test.ts` (4) — зелёные. Полный `npx vitest run` зелёный (977 + 1 todo),
> `tsc -p tsconfig.build.json` чистый.
>
> **Что упростилось/уточнилось против плана:**
> 1. **`getValues()` через материализацию в projectionObj, а не override.** Состав списка
>    пишется в `ownerProjectionObj[fieldKey]` (реверс-индекс `listConfigNode → fieldKey` —
>    `NodeRegistry.listFieldKeys`). projectionObj уже входит в `values.users[i]` по ссылке, поэтому
>    `store.getValues()` (тот же `structuredClone(valuesCache.values)`) отдаёт вложенную структуру
>    без изменений самого метода. Работает рекурсивно для nested-of-nested.
> 2. **`__schemaVersion` НЕ вводился.** Graceful-деградация достигается тем, что отсутствие
>    вложенных данных в snapshot → no-op при `restoreLists` (нет ключа списка → пропуск). Добавление
>    поля во ВСЕ snapshot-ы (включая flat-конфиги без списков) сочли излишне инвазивным; версионную
>    миграцию можно ввести позже, когда появится реальное несовместимое изменение формата.
> 3. **`restoreLists` закрыл и корневой list-persist (его раньше не было — `applyPatch` пропускает
>    list-узлы).** Один рекурсивный проход восстанавливает И корневые (`listStates`), И per-entity
>    (`EntityListState`) списки + owner-ссылки → round-trip и каскадное удаление работают после reload.
> 4. **Dirty:** `list.dirty` (composition) + `entityProxy.dirty` (`isEntityDirty` = leaf-dirty ∪
>    list-composition-dirty). Базовый `buildEntityValues` оставлен **без** списков (питает
>    резолверы/валидаторы); вложенность даёт отдельный `buildEntityValuesWithLists`.
> 5. **Nested-of-nested (C4) частично заработал «бесплатно»** для списков на верхнем уровне template
>    (рекурсия в `buildEntityValuesWithLists`/`restoreLists`/`_syncEntityListValuesCache`). Остался
>    только блокер list-внутри-nested-group — см. C4.

### Шаги

1. **`getValues()`:** в обходе values для root entity — если у entity есть `lists`, то для каждой пары `(listNode, state)` дописать `values[fieldKey] = state.itemIds.map(id => buildChildValues(id))`. Реализуется в `valuesCache` или прямо в getValues-хелпере.
2. **`dirty`:** агрегатор list-dirty — `state.itemIds !== state.initialItemIds` (поверхностное сравнение). Подмешивается в `EntityListState.dirty` getter и в `dirty` родительской entity.
3. **Persist driver:**
   - формат: для каждой root-entity сериализуем `{ id, fields..., lists: { [listKey]: ChildEntitySnapshot[] } }`;
   - hydrate: рекурсивно создаёт child-entity с правильным `owner`;
   - **версионная миграция:** добавить поле `__schemaVersion` в snapshot, старые snapshot'ы игнорируют child-list (graceful).
4. **`setValues({ contacts: [...] })`:** для child-list — переиспользует `setItems` + create-on-the-fly.

### Тесты C3
- `entityListGetValues.test.ts`: `store.getValues()` содержит nested `contacts`.
- `entityListDirty.test.ts`: add/remove/reset правильно влияют на `dirty` владельца.
- `entityListPersist.test.ts`: round-trip `save → reload → restore`.

### Definition of Done C3
- Snapshot тестов persist стабилен.
- Старые snapshot'ы (без `__schemaVersion`) загружаются без ошибки.

---

## Фаза C4 (опционально) — Nested-of-nested ✅

**Цель:** child-entity сама может иметь child-list (contact → emails). Реализуется почти автоматически, **если** C1–C3 используют рекурсивные хелперы (а не хардкодят «два уровня»).

> **Сделано (2026-06-24).** Тесты: `store/entityListNested.test.ts` (13) и
> `react/entity-list-nested.test.tsx` (2) — зелёные. Полный `npx vitest run` зелёный (992 + 1 todo),
> `tsc -p tsconfig.build.json` чистый.
>
> **Что упростилось/уточнилось против плана:**
> 1. **Entity-в-entity (основная цель) уже работало** благодаря рекурсивным хелперам C3
>    (`buildEntityValuesWithLists` / `_restoreListsRec` / `_syncEntityListValuesCache`). Каждый child
>    — корень своей projection-proxy, поэтому его `id` сам становится owner-ом для его списков. Здесь
>    только **закрыли тестами**: каскад на 3 уровня, изоляция мутаций и tracking-версий на глубине,
>    resolver на 2-м уровне.
> 2. **Блокер закрыт минимальным параметром.** Добавлен `ownerEntityNode?` в
>    `buildEntityProjectionProxy`: на верхнем вызове = сама entity, при рекурсии в nested-группу
>    протаскивается дальше. Список берёт владельца из него (`listOwnerEntity`), а не из сбрасываемого
>    `rootEntityNode`. `rootEntityNode` для values/dirty/leaf-view НЕ трогали — риск регресса нулевой.
> 3. **Реверс-индекс `listFieldKeys` стал path-aware** (`WeakMap<object, string>` → `string[]`),
>    путь сбрасывается на границе каждого списка (новый entity-scope). Для списков верхнего уровня
>    путь = `["contacts"]` → навигация — no-op, поведение C3 не изменилось (backward-compatible).
> 4. **`buildEntityValuesWithLists` теперь обходит nested-группы** (вынесено в `materializeListsInto`),
>    чтобы список в группе попадал в правильное место value-дерева. Симметрично с
>    `_syncEntityListValuesCache`.
> 5. **persist для списка в nested-группе заработал «бесплатно»** — `_restoreListsRec` уже рекурсил
>    в группы (C3), а path-aware sync довершил round-trip.

⚠️ **Закрытый блокер из C1 §План.6:** `buildEntityProjectionProxy` сбрасывал `rootEntityNode` при рекурсии в nested-группы, поэтому list внутри nested group получал неверного владельца. Закрыто протаскиванием настоящего owner-entity параметром `ownerEntityNode` через рекурсию `buildEntityProjectionProxy` → `buildEntityListProxy`.

### Тесты C4
- ✅ 3-уровневая вложенность: `users[*].contacts[*].emails[*]` (add/getValues/list.getValues, рендер);
- ✅ каскадное удаление трёх уровней (+ изоляция соседних поддеревьев);
- ✅ persist round-trip (покрыт в C3 для entity-нестинга + добавлен для списка в nested-группе);
- ✅ list внутри nested-группы: owner = root entity, getValues по вложенному path, каскад, изоляция.

---

## Карта рисков

| Риск | Митигация |
|------|-----------|
| **`lists`/`owner` на `EntityNode` протекают в плоские values.** `buildEntityValues` ([buildEntityProjectionProxy.ts:14-31](store/buildProxy/buildEntityProjectionProxy.ts#L14-L31)) обходит `Object.keys(entityNode)` и рекурсит в любой объект-field → `values.lists`, `values.owner.ownerListNode[...]` попадут в snapshot для резолверов/computed. | Объявлять `lists`/`owner` через `Object.defineProperty(..., { enumerable: false })`. Тест в C1 проверяет, что `parentValues` не содержит этих ключей. (`__kind` уже безопасен — это строка, отсекается `typeof === "object"`.) |
| `Map` на `EntityNode` ломает существующие сериализаторы entity. | C1 не трогает serialization. non-enumerable `lists`/`owner` (см. выше) автоматически выпадают из `JSON.stringify` и spread. В C3 hydrate/persist обрабатывает их явно. |
| Tracking proxy не различает версии разных владельцев одного listNode. | Ключ трекинга = объект `EntityListState` (per-owner), а не shared `listConfigNode`. Хаб уже версионирует по объекту-узлу. Бренд `ENTITY_LIST_STATE` + ветка в `createTrackingProxy`. **`getEntityListVersion` не нужен** — `getNodeVersion(entityListState)`. Тест изоляции в C1. |
| Resolver child-list зависит от `parentValues`, которые меняются → бесконечные re-resolve. | `lastResolvedKey` строится по `JSON.stringify(deps)`, как уже сделано для template-resolve. |
| ID-коллизии при двух владельцах с одинаковыми child id из API. | Глобальный неймспейс (Q2). На коллизии — `set` бросает ошибку, как сейчас для root entities. Фикс — на стороне resolver-а (нормализация id). |
| Каскадное удаление пропускает child через несколько уровней. | Рекурсивный `delete` + явный тест C4 на 3 уровня. |

---

## Контрольные точки для исполнителя

После каждой фазы:
1. `npx vitest run` — зелёный.
2. `npx tsc --noEmit -p tsconfig.build.json` (или эквивалент) — без ошибок.
3. Изменения в публичном API (`store.proxy.*`, `useForm`) задокументированы в `architecture.md` или README.
4. Коммит с заголовком `feat(per-entity-lists): phase Cx — <one-liner>` и описанием в теле.
5. Перед стартом следующей фазы — короткий review-комментарий: «что упростилось в дизайне после реальной имплементации». Это входной фильтр для уточнения плана следующей фазы.
