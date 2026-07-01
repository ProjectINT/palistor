# RFC: Per-Entity Nested Lists

> Status: **discussion / problem definition** — никакой реализации пока не предлагается, только анализ.
> Trigger: тест [react/entity-list-field.test.tsx](react/entity-list-field.test.tsx) — два теста из четырёх стабильно падают.
>
> **Ревизия 2026-06-24:** анализ §2.1–§2.6 перепроверен по коду и подтверждён (shared `ListState` из `registerNodes`, версии хаба по объекту-узлу). Решение — вариант **C**, разбит на фазы в [PLAN_PER_ENTITY_LISTS_C.md](PLAN_PER_ENTITY_LISTS_C.md). В коде пока **не реализовано ничего** (см. раздел «Статус» в плане). Уточнения к §2.3/§2.6 и открытым Q4 — там же.

---

## 1. Проблема

### 1.1 Сценарий пользователя

В template сущности есть поле-список, и каждая сущность владеет **своим** независимым набором элементов:

```ts
const store = new Palistor({
  config: {
    users: defineList({
      template: { id: { value: "" }, name: { value: "" } },
    }),
    editUser: {
      id: { value: "" },
      name: { value: "" },
      contacts: defineList({                     // ← list внутри template сущности
        template: { id: { value: "" }, phone: { value: "" } },
        resolve: { resolver: contactsResolver, onError },
      }),
    },
  },
});

function UserCard({ userProxy }) {
  const form = useForm(userProxy, (s) => s.editUser);
  return <ContactsList contacts={form.contacts} />; // ← form.contacts должен быть list-proxy
}
```

Семантика, которую ожидает разработчик:
- `Alice.contacts` и `Bob.contacts` — **разные** списки.
- У каждого свой `loading`, свой `itemIds`, свой `dirty`, свой кэш `resolved`.
- Resolver вызывается с values конкретной сущности (`{ id: "u1", name: "Alice" }`).
- При unmount entity-карточки — состояние сохраняется (re-open не дёргает resolver повторно), как сейчас работает entity-mode для скалярных полей.

### 1.2 Что происходит на самом деле

Запуск `npx vitest run react/entity-list-field.test.tsx`:

```
✓ простая форма с полем-списком (list на корне) — 2 теста passed
✗ entity с полем-списком в шаблоне                — 2 теста failed
   → TypeError: Cannot read properties of undefined (reading 'proxy')
     at resolveInput (react/useForm.ts:94)
```

### 1.3 Точная локализация причины

[store/buildProxy/buildEntityProjectionProxy.ts](store/buildProxy/buildEntityProjectionProxy.ts#L150-L156):

```ts
const templateField = templateNode[key as string];
if (
  !templateField ||
  typeof templateField !== "object" ||
  Array.isArray(templateField)        // ← list-узел — это массив, явно отбрасывается
) {
  return undefined;
}
```

Поэтому `form.contacts` → `undefined`. Дочерний `useForm(undefined)` падает в [react/useForm.ts:94](react/useForm.ts#L94) при попытке прочитать `input.proxy`.

Это **не баг забытой ветки** — это намеренный отказ. Сейчас `buildEntityProjectionProxy` умеет проецировать только leaf и nested group. Поддержка list внутри template отсутствует на уровне всей подсистемы — не только в этом проксере.

---

## 2. Почему это архитектурная дыра, а не локальная правка

Чтобы `form.contacts` стал работающим list-proxy, надо ответить на вопросы, на которые в текущем коде ответов нет.

### 2.1 Где хранить `itemIds` per-entity

Сейчас [`ListState`](store/store/types.ts#L316-L330) лежит в `nodes.listStates: WeakMap<configNode, ListState>` — **по одному состоянию на узел конфига**. Узел конфига `contacts` один на все сущности → один itemIds, общий на всех. Это противоречит требованию.

Нужно либо:
- ключ `(entityId, listConfigNode) → ListState` (Map по паре), либо
- `EntityNode` владеет своими list-состояниями: `EntityListState` хранится в registry рядом с leaf-нодами entity.

### 2.2 Как хранить сами entity-элементы списка

Сейчас `entityRegistry` плоский: `Map<entityId, EntityNode>`. Если `Alice.contacts = [c1, c2]`, то `c1`, `c2` — это:

- **(а)** обычные entity первого класса, лежащие в том же глобальном registry, со своими ID? Тогда нужен механизм «c1 принадлежит u1» (parent reference / scope), иначе при удалении u1 контакты остаются «висеть».
- **(б)** Под-entity, локальные для u1, в отдельном scoped-registry внутри `EntityNode`?

Это фундаментальный архитектурный выбор: **flat global registry vs nested ownership**. Текущий код построен на (а)-без-родителя, и это ломает изоляцию между сущностями.

### 2.3 Per-entity resolve cache и зависимости

`ResolveManager.entityStates` уже ключуется парой `(entityId, templateNode)` — для template-резолва сущности это работает. Аналогично нужно ключевать `(entityId, listConfigNode) → ListResolveState` (status, lastResolvedKey, итд). Это расширение, но прямолинейное.

`deps` resolver-а сейчас resolve-ится относительно root config. У per-entity list deps естественно резолвить относительно values сущности (как уже сделано для template-resolve). Решаемо, но требует прокладки.

### 2.4 Persist / dirty / setValues

- `store.getValues()` сейчас формирует `values.users[i]` из плоских entity. Если у сущности есть свой list — `values.users[0].contacts` должен быть массивом. Сейчас этого узла нет → сериализация теряет данные.
- `dirty` для list считается по `initialItemIds vs itemIds` на одном `ListState`. Per-entity — нужно агрегировать по N состояний.
- `persist` driver сейчас не знает про per-entity подструктуры.

### 2.5 NodeView / writePipeline

`buildEntityProjectionProxy` лениво регистрирует `NodeView` для entity-leaf↔template-leaf. Для list-внутри-template аналога нет: list-узел не «leaf», у него нет одного `value`. Нужна параллельная регистрация: `NodeListView` или эквивалент, который writePipeline/dirty будут учитывать.

### 2.6 Tracking / реактивность

Tracking proxy подписывается на `nodeState[node].version`. Per-entity list должен иметь свой `version`, иначе все карточки re-render-ятся при изменении любой. Сейчас единый `ListState.version` на конфиг-узле.

---

## 3. Варианты решения

### Вариант A. **Запретить и дать понятную ошибку** (минимум кода)

`buildEntityProjectionProxy` для array-template-field бросает Error со ссылкой на этот RFC. Тесты переписать на `expect(() => render(...)).toThrow(/per-entity list not supported/)`.

| + | – |
|---|---|
| Час работы. | Не решает заявленную потребность. |
| Перестаёт молча давать `undefined` (сейчас падает уже в дочернем `useForm`). | Откладывает всё на потом. |
| Документирует ограничение. | Юзер всё равно ждёт фичу. |

**Уместен только как промежуточный шаг**, чтобы убрать загадочный `Cannot read properties of undefined`.

---

### Вариант B. **«Cheap proxy»: list-внутри-template как разделяемое состояние**

Не делать per-entity состояния. `form.contacts` для всех сущностей возвращает один и тот же list-proxy (тот же, что `store.proxy.editUser.contacts` сегодня — если бы он работал). Resolver вызывается один раз, не per-entity.

| + | – |
|---|---|
| Минимум новой инфраструктуры — переиспользуем существующий ListState. | **Не отвечает на сценарий**: Alice и Bob будут видеть одни и те же контакты. |
| Тривиально интегрируется с persist/dirty. | Тогда зачем list внутри template вообще? Можно положить на корень. |

Не рекомендую — эта семантика обманет пользователя.

---

### Вариант C. **Per-entity ListState в registry** (полноценная фича)

Расширить модель:

1. **EntityNode** получает поле `lists?: Map<listConfigNode, EntityListState>` (или отдельный side-store `WeakMap<EntityNode, Map<listConfigNode, EntityListState>>`).
2. `EntityListState` = `{ itemIds, initialItemIds, version, resolveState }`. Структурно — то же `ListState`, но per-entity.
3. `buildEntityProjectionProxy` для array-field строит per-entity list-proxy (новый `buildEntityListProxy`), который читает/мутирует именно эту запись.
4. `ResolveManager` получает метод `executeEntityListResolve(entityId, listNode)`, аналогичный существующему `executeEntityTemplateResolve`. Ключ resolve-state: `(entityId, listNode)`.
5. Дочерние entity (контакты Alice) хранятся в **общем** registry, но с **owner-ссылкой** `{ ownerId: "u1", ownerListNode }`. На `delete("u1")` — каскадное удаление children. Это явная новая концепция: **nested ownership**.
6. `getValues()` рекурсивно дописывает `values.users[i].contacts = [...]`.
7. Tracking: per-entity version отдельно, не задевает другие карточки.
8. Persist: формат должен учитывать nested структуру. Возможно — отдельная фаза.

| + | – |
|---|---|
| Закрывает потребность полностью. | Большая работа: затрагивает registry, ResolveManager, valuesCache, dirty, persist, traversal, tracking. |
| Симметрично уже работающему entity-template-resolve. | Нужно явно решить вопрос ownership/каскадного удаления. |
| Открывает дорогу для arbitrary nesting (контакт → его телефоны). | Persist потребует версионной миграции (если он уже используется). |

**Это правильное решение.** Но требует разбиения на фазы.

#### Предлагаемые фазы C

- **C0** (тот же шаг A): осмысленная ошибка вместо `undefined`. Снимает мину сейчас.
- **C1** Read-only: `form.contacts` возвращает per-entity list-proxy с `items` и `loading`, resolver работает per-entity. **Без** add/remove/persist/dirty. Покрывает 80% сценария «загрузить и показать».
- **C2** Mutations: `add`/`remove`/`setItems` per-entity. Ownership-модель в registry.
- **C3** Persist + dirty + getValues включают nested structure.
- **C4** (опционально) Поддержка nested-внутри-nested (contact → emails).

Каждая фаза — самостоятельный RFC с своими тестами; текущий упавший файл покрывается уже после C1.

---

### Вариант D. **«Composition over nesting»: явный list на корне с фильтром по owner**

Не поддерживать list-в-template вообще. Вместо этого в config:

```ts
config: {
  users: defineList({...}),
  contacts: defineList({                 // отдельный root list
    template: { id, ownerId, phone },
    resolve: { resolver, deps: ["selectedUserId"] },
  }),
}
```

Компонент сам фильтрует `contacts.items.filter(c => c.ownerId.value === userId)`.

| + | – |
|---|---|
| Никакой работы по библиотеке. | Перекладывает на пользователя ownership, фильтрацию, per-entity resolve, кэш. |
| Хорошо ложится на «нормализованные» данные. | UX ухудшается; теряется автоматический resolve по конкретной сущности. |
| Иногда правильный паттерн (list контактов глобально + фильтр). | Не решает оригинальный use-case, только обходит. |

Стоит рекомендовать как **best practice** для случаев, когда дочерние сущности живут независимо от родителя. Но не как замена C, потому что меняет семантику владения.

---

## 4. Рекомендация

1. Сейчас: **C0** — заменить молчаливый `undefined` на ошибку с ссылкой на этот RFC. Один из двух упавших тестов превратить в позитивный «правильно сообщает об ограничении», второй пометить `it.todo`.
2. Запланировать **C1** как ближайшую цель: read-only per-entity list проще остального и закрывает основной сценарий загрузки. Тесты из `entity-list-field.test.tsx` — естественный contract.
3. **C2/C3** — после того, как C1 стабилизируется и появится реальный use-case с мутациями/persist (не гипотетический).
4. В документации: упомянуть **D** как альтернативный паттерн для случаев, где дочерние сущности концептуально независимы.

## 5. Открытые вопросы (требуют решения до старта C1)

- Q1. Children-entity лежат в **том же** registry, что и `users`, или в **scoped sub-registry** внутри `EntityNode`? (От этого зависит API `store.set`, `store.delete`, persist-формат.)
- Q2. ID-неймспейс children-сущностей — глобальный или per-owner? («c1» внутри Alice и «c1» внутри Bob — это одна сущность или две?)
- Q3. На `delete("u1")` — children каскадно удаляются или остаются как orphan?
- Q4. Resolver children получает `values` родителя или только id? (Сейчас template-resolve получает плоский snapshot entity — логично продолжить.)
- Q5. `useForm(form.contacts)` в дочернем компоненте — возвращает list-proxy с _независимым_ tracking, как сейчас работает с обычными list. Подтверждаем, что API не меняется.

Без ответов на Q1–Q3 нельзя начинать имплементацию C1, потому что ownership-модель пронизывает весь дизайн.
