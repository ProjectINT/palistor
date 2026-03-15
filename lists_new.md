# Нормализованный Entity Store + Списки — Архитектура v2

## Философия

Palistor — **нормализованное реактивное хранилище сущностей** (entity store) с proxy-доступом и декларативными шаблонами. Единый реестр сущностей, а config-дерево описывает **шаблоны отображения** (какие поля показать, какие правила применить, как резолвить и сабмитить).

Принципы:
- **Одна сущность — одна запись** в EntityRegistry, без дублирования данных
- **ID — обычный leaf node**, автогенерируется если не задан
- **Шаблон (template)** — stateless описание: какие поля, какие правила, resolve, submit
- **Один шаблон — много сущностей**: шаблон привязывается к сущности в `useForm`, не в конфиге
- **Списки — массивы ID**, не копии объектов
- **Инкрементальное слияние**: поля entity только добавляются, никогда не удаляются
- **Кеш resolve**: пара entity+template помечается как resolved, повторное открытие — мгновенно

---

## Ментальная модель

```
┌─────────────────────────────────────────────────────────────┐
│                      EntityRegistry                          │
│                  Map<id, EntityNode>                          │
│                                                             │
│  "u1" → { id, name, email, role, avatar, ... }              │
│  "u2" → { id, name, role, ... }                             │
│                                                             │
│  Единственный источник правды для VALUE всех сущностей.      │
│  EntityNode — объект с leaf-нодами в nodeState.              │
│                                                             │
│  resolvedCache: Map<entityId, Set<templateNode>>             │
│  "u1" → { editUserFormNode }  ← уже резолвился в этом tmpl  │
└──────────┬────────────────────┬─────────────────────────────┘
           │                    │
  ┌────────▼──────────┐  ┌─────▼──────────────┐
  │ Template:          │  │ List: users        │
  │ editUserForm       │  │ template: {id,name}│
  │ (stateless)        │  │ itemIds:           │
  │                    │  │ ["u1","u2"]        │
  │ name: isRequired   │  │                    │
  │ email: isRequired  │  │ Template — обычная │
  │ resolve: getUser() │  │ группа. Все правила│
  │ onSubmit: update() │  │ работают.          │
  │                    │  │                    │
  │ НЕ привязан к      │  │                    │
  │ конкретной entity. │  │                    │
  │ Привязка в useForm │  │                    │
  └────────────────────┘  └────────────────────┘

// В списке: 2 поля (только name, id)
form.users[0].name.value → entity "u1".name leaf → 'Alice'

// В форме: 4 поля + validate + submit
const u = useForm(user, (s) => s.editUserForm)
u.name.value → entity "u1".name leaf → 'Alice' (ТА ЖЕ нода!)
u.email.value → entity "u1".email leaf → 'alice@corp.com'
```

---

## 1. EntityRegistry

### Структура

```ts
class EntityRegistry {
  /** Все сущности по ID. Ключ — всегда string. */
  private entities: Map<string, EntityNode> = new Map();

  /**
   * Обратный индекс: entity ID → Set всех активных привязок.
   * Привязка создаётся при useForm(entity, template).
   */
  private bindings: Map<string, Set<object>> = new Map();

  /**
   * Кеш resolved: entity ID → Set template nodes, для которых entity уже резолвилась.
   * При useForm(entity, template) — если пара есть в кеше → skip resolve.
   */
  private resolvedCache: Map<string, Set<object>> = new Map();

  /** Upsert entity: merge полей, никогда не уменьшая. */
  upsert(id: string, data: Record<string, unknown>): EntityNode;

  /** Получить entity. */
  get(id: string): EntityNode | undefined;

  /** Явное удаление entity и всех привязок. */
  delete(id: string): void;

  /** Привязать template к entity (при useForm). */
  bind(entityId: string, templateNode: object): void;

  /** Отвязать template от entity (при unmount). */
  unbind(entityId: string, templateNode: object): void;

  /** Пометить entity как resolved для данного template. */
  markResolved(entityId: string, templateNode: object): void;

  /** Проверить, резолвилась ли entity для данного template. */
  isResolved(entityId: string, templateNode: object): boolean;

  /** Сбросить resolved-статус (при invalidation). */
  clearResolved(entityId: string, templateNode?: object): void;
}
```

### EntityNode

EntityNode — обычный JS-объект. Свойства — leaf config node или вложенные группы:

```ts
// Entity "u1" в registry (плоская):
{
  id:     { value: 'u1' },
  name:   { value: 'Alice' },
  email:  { value: 'alice@corp.com' },
  role:   { value: 'admin' },
  avatar: { value: '/img/alice.jpg' },
}

// Entity с вложенной группой:
{
  id:       { value: 'u1' },
  name:     { value: 'Alice' },
  passport: {
    number: { value: '123456' },
    issued: { value: '2020-01-01' },
  },
}
```

Каждый leaf node регистрируется в `nodeState` (FieldState), `nodePaths`, `nodeParents`. Это минимизирует число исключений и позволяет использовать существующую инфраструктуру (recompute, dirty, notification).

### Инкрементальное слияние

При `store.set({ id: 'u1', avatar: '/new.jpg', phone: '+1234' })`:

```
До:  entity "u1" = { id, name, email, role, avatar }
После: entity "u1" = { id, name, email, role, avatar('/new.jpg'), phone('+1234') }
                                                  ↑ обновлено         ↑ добавлено
```

Правила:
- Существующие поля: **обновить value** если новое значение отличается
- Новые поля: **создать leaf node**, зарегистрировать в nodeState
- Отсутствующие в патче поля: **не трогать** (не удалять)
- Поле `id`: используется как ключ, не обновляется

---

## 2. ID как leaf node

### Автогенерация

ID — обычный leaf с `{ value: '' }`. Если пользователь не объявил `id` в template, система создаёт его автоматически.

Когда `id.value` пустой — система генерирует временный уникальный ID:

```ts
const tempId = `_tmp_${crypto.randomUUID()}`;
```

### Жизненный цикл ID

```
1. Список загружен, entity создаётся с реальным ID:
   store.set([{ id: 'u1', name: 'Alice' }])
   → entity 'u1' в registry

2. Новая entity создаётся без ID (например createUserForm):
   → tempId = "_tmp_abc"
   → entity "_tmp_abc" в registry
   → После submit сервер возвращает реальный ID
   → entity перепривязывается к реальному ID
```

### Пользователь может настроить id

```ts
editUserForm: {
  id: { value: '', isReadOnly: true },  // read-only в форме
}
```

Система не мешает — `id` обычный leaf, просто по нему происходит привязка к registry.

---

## 3. Шаблоны (templates) — stateless описания

### Ключевая идея

Шаблон (template) в конфиге — это **stateless описание** формы/view. Он НЕ привязан к конкретной entity. Привязка entity ↔ template происходит в `useForm`.

Один и тот же шаблон `editUserForm` может одновременно использоваться для разных entity (два окна редактирования разных пользователей).

### Config

```ts
const config = {
  // ─── Шаблоны форм (stateless) ─────────────────────────────
  
  editUserForm: {
    name: { value: '', isRequired: true, validate: (v) => !v ? 'Required' : undefined },
    email: { value: '', isRequired: true },
    role: { value: '' },
    avatar: { value: '' },
    resolve: {
      resolver: async (thisForm, store) => api.getUser(thisForm.id.value),
    },
    onSubmit: async (thisForm, store) => api.updateUser(thisForm.id.value, thisForm),
  },

  createUserForm: {
    name: { value: '', isRequired: true },
    email: { value: '', isRequired: true },
    role: { value: 'viewer' },
    // Нет resolve — нечего загружать
    onSubmit: async (thisForm, store) => api.createUser(thisForm),
  },

  // ─── Списки ────────────────────────────────────────────────

  users: [{
    id: { value: '' },
    name: { value: '' },
  }, {
    resolve: {
      resolver: async (_, store) => {
        return await api.getUsers();
        // → [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }]
      },
    }
  }],
};
```

### Что template определяет

1. **Какие поля видны** — ключи шаблона
2. **Правила** — isRequired, validate, isVisible, formatter, setter
3. **Resolve** — как дозагрузить данные для entity
4. **Submit** — как сохранить entity
5. **Lifecycle** — onChange, beforeSubmit, afterSubmit

### Что template НЕ хранит

- **Значения** — значения живут в EntityNode
- **Привязку к entity** — привязка в `useForm`
- **Состояние** — FieldState вычисляется при привязке

---

## 4. Привязка: useForm(entity, templateSelector)

### Новая сигнатура useForm

```ts
// Вариант 1: как сейчас — root store или поддерево
const form = useForm(store);
const section = useForm(form.passport);

// Вариант 2 (НОВЫЙ): entity + template selector
const user = useForm(entityProxy, (store) => store.editUserForm);
```

**Второй аргумент** — функция-селектор, возвращающая шаблон из конфига. Шаблон определяет набор полей, правила, resolve и submit.

### Что происходит при `useForm(entity, selector)`

```
useForm(user, (store) => store.editUserForm)
  │
  ├─ 1. Извлечь entity ID из user proxy → 'u1'
  │
  ├─ 2. Получить template config node: store.editUserForm
  │
  ├─ 3. Привязать: entityRegistry.bind('u1', editUserFormNode)
  │     Entity 'u1' расширяется полями из template (email, avatar, ...)
  │     Значения из registry подтягиваются
  │
  ├─ 4. Проверить кеш resolve:
  │     entityRegistry.isResolved('u1', editUserFormNode)?
  │     ├─ ДА → skip resolve, данные полные (мгновенно!)
  │     └─ НЕТ → trigger resolve
  │           resolver получает (thisForm, store)
  │           thisForm = proxy entity 'u1' через editUserForm template
  │           → api.getUser(thisForm.id.value)
  │           → результат сливается в entity 'u1'
  │           → entityRegistry.markResolved('u1', editUserFormNode)
  │
  ├─ 5. Построить proxy: entity 'u1' через editUserForm template
  │     { name, email, role, avatar } + isRequired + validate + submit + loading
  │
  └─ 6. Return: tracking proxy с independent re-render
```

### При unmount компонента

```
useForm unmount:
  ├─ entityRegistry.unbind('u1', editUserFormNode)
  ├─ Entity 'u1' ОСТАЁТСЯ в registry (кеш)
  └─ resolved-статус ОСТАЁТСЯ (повторное открытие — мгновенно)
```

### Кеширование: открыл → закрыл → открыл

```
Шаг 1: useForm(alice, (s) => s.editUserForm)
  ├─ entity 'u1' — только { id, name } (из списка)
  ├─ resolve → api.getUser('u1') → { email, role, avatar }
  ├─ entity 'u1' расширяется до 5 полей
  └─ markResolved('u1', editUserFormNode)

Шаг 2: unmount (закрыли модалку)
  ├─ unbind
  └─ entity + resolved-статус остаются ✓

Шаг 3: useForm(alice, (s) => s.editUserForm) (снова открыли)
  ├─ bind
  ├─ isResolved('u1', editUserFormNode) → TRUE
  ├─ skip resolve!
  └─ Все 5 полей доступны мгновенно из кеша ✓
```

### Открытие другой entity через тот же template

```
Шаг 1: useForm(alice, (s) => s.editUserForm) → resolve + cache
Шаг 2: useForm(bob, (s) => s.editUserForm)
  ├─ entity 'u2' — только { id, name } (из списка)
  ├─ isResolved('u2', editUserFormNode) → FALSE
  └─ resolve → загрузка полных данных Bob
```

---

## 5. Resolver и onSubmit — сигнатура (thisForm, store)

### Resolver

```ts
editUserForm: {
  resolve: {
    resolver: async (thisForm, store) => {
      // thisForm — proxy entity через данный template
      // thisForm.id.value — ID текущей entity
      // store — ссылка на Palistor (для доступа к другим данным)
      return await api.getUser(thisForm.id.value);
    },
    // deps не нужны — resolve триггерится при привязке entity,
    // а не при изменении полей
  },
}
```

**`thisForm`** — proxy на entity через текущий template. Содержит все поля entity включая `id`. Resolver читает `thisForm.id.value` для запроса.

**`store`** — ссылка на Palistor, для доступа к другим данным store (`store.getValues()`, etc.).

### onSubmit

```ts
editUserForm: {
  onSubmit: async (thisForm, store) => {
    await api.updateUser(thisForm.id.value, thisForm);
    // thisForm содержит все значения entity через template
  },
}
```

Та же сигнатура. `thisForm` — значения entity, `store` — доступ ко всему хранилищу.

### Отличие от текущей архитектуры

Сейчас: `onSubmit(values)` где `values` = `valuesCache.values` для группы.
Новое: `onSubmit(thisForm, store)` где `thisForm` = proxy entity через template.

Это принципиально, потому что template stateless — он не хранит значений в `valuesCache`. Значения приходят из entity.

---

## 6. store.set() / store.delete()

### store.set(data)

```ts
store.set({ id: 'u1', name: 'Alice', email: 'alice@corp.com' });
```

Алгоритм:

```
1. Извлечь id из data
2. entityRegistry.upsert(id, data)
   a. Entity существует → merge (обновить + добавить новые поля)
   b. Entity не существует → создать EntityNode
3. changed = Set<leafNode> (изменённые leaf-ноды)
4. Propagation ко всем bound templates и спискам
5. recompute + notifyChanged
```

### store.set(array)

```ts
store.set([
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
]);
```

Batched: каждый элемент → upsert, один recompute + notify в конце.

### store.delete(id)

```ts
store.delete('u1');
```

```
1. Удалить из всех списков (убрать id из itemIds)
2. Unbind все привязанные templates
3. Очистить resolvedCache для этой entity
4. Удалить entity leaf-ноды из nodeState
5. Удалить entity из registry
6. notifyChanged
```

---

## 7. Списки

### Объявление

```ts
// Минимальный список (только template):
users: [{
  id: { value: '' },
  name: { value: '' },
}]

// Список с конфигурацией (template + listConfig):
users: [{
  id: { value: '' },
  name: { value: '' },
}, {
  resolve: {
    resolver: async (_, store) => api.getUsers(),
  },
}]
```

Массив длины 1-2 = **ListNode**.
- `array[0]` — **template**: обычная группа, описывает поля элемента. Подчиняется общим правилам (validate, formatter, setter, isRequired — всё работает).
- `array[1]` (опционально) — **listConfig**: конфигурация уровня списка (resolve, и т.д.).

Template — обычный group node. Все правила на leaf-нодах внутри template работают и в списке: formatter, setter, onChange, validate.

### ListState

```ts
interface ListState {
  /** Шаблон элемента — описывает поля для отображения. */
  template: AnyConfigNode;

  /** Конфигурация уровня списка (resolve, etc.) */
  listConfig?: ListConfig;
  
  /** Упорядоченный массив entity ID. */
  itemIds: string[];
  
  /** Версия списка (инкрементируется при add/remove). */
  version: number;

  /** Начальный набор ID (для dirty tracking состава). */
  initialItemIds?: string[];
}

interface ListConfig {
  resolve?: {
    resolver: (list: ListProxyNode, store: ProxyStore) => Promise<any[]>;
  };
}
```

### Элемент списка = entity через list template

Proxy для `form.users[0]`:
- **value** → из EntityNode leaf (чтение + запись)
- **label, placeholder** → из list template
- **isVisible** → из list template (может быть computed)
- **id** → entity ID (readonly удобство)

List item proxy — **EntityProjectionProxy**. Полноценный proxy: все правила template (formatter, setter, validate, isRequired) работают на каждом leaf.

### API

```ts
const users = form.users;

users.items          // ReadonlyArray<EntityProjectionProxy>
users.length         // количество
users.add(id)        // добавить entity по ID
users.add(values)    // upsert entity + добавить в список
users.remove(id)     // убрать из списка (entity остаётся в registry)
users.getById(id)    // найти элемент по ID
users.map(fn)        // маппинг для React
users.setItems(ids)  // bulk-установка
users.loading        // loading (если есть resolver)
```

### Resolver для списков

```ts
users: [{
  id: { value: '' },
  name: { value: '' },
}, {
  resolve: {
    resolver: async (_, store) => {
      return await api.getUsers();
      // → [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }]
    },
  },
}]
```

При resolve:
1. Каждый элемент → `entityRegistry.upsert(item.id, item)`
2. `listState.itemIds = data.map(item => item.id)`
3. listState.version++
4. notifyChanged

### Tracking для списков

```tsx
function UserList({ users }) {
  // users.map → tracking записывает ListNode
  // При add/remove → ListNode version++ → re-render
  return users.map((user, i, id) => (
    <UserRow key={id} user={user} />
  ));
}

function UserRow({ user }) {
  // Чтение user.name.value → tracking записывает entity leaf node
  // Изменение entity "u1".name → version++ → re-render
  // Изменение entity "u2".name → НЕ re-render (другая нода)
  return <li>{user.name.value}</li>;
}
```

---

## 8. Полный пример: список пользователей + форма редактирования

### Config

```ts
const config = {
  // Шаблон формы редактирования (stateless)
  editUserForm: {
    name: { value: '', isRequired: true, validate: (v) => !v ? 'Required' : undefined },
    email: { value: '', isRequired: true },
    role: { value: '' },
    avatar: { value: '' },
    resolve: {
      resolver: async (thisForm, store) => api.getUser(thisForm.id.value),
    },
    onSubmit: async (thisForm, store) => api.updateUser(thisForm.id.value, thisForm),
  },

  // Шаблон формы создания (другие правила, нет resolve)
  createUserForm: {
    name: { value: '', isRequired: true },
    email: { value: '', isRequired: true },
    role: { value: 'viewer' },
    onSubmit: async (thisForm, store) => api.createUser(thisForm),
  },

  // Список пользователей (проекция)
  users: [{
    id: { value: '' },
    name: { value: '' },
  }, {
    /* Тут набор опций списка */
  }],
};

const store = new Palistor({ config });
```

### React

```tsx
function UsersPage() {
  const form = useForm(store);

  return (
    <div>
      <UserList users={form.users} />
    </div>
  );
}

function UserList({ users }) {
  const [editUser, setEditUser] = useState(null);

  return (
    <>
      {users.map((user, i, id) => (
        <li key={id} onClick={() => setEditUser(user)}>
          {user.name.value}
        </li>
      ))}
      {editUser && (
        <EditUserModal user={editUser} onClose={() => setEditUser(null)} />
      )}
    </>
  );
}

function EditUserModal({ user, onClose }) {
  // Привязка entity к шаблону editUserForm
  // → entity расширяется полями из шаблона
  // → resolve проверяет кеш → загружает если нужно
  const u = useForm(user, (store) => store.editUserForm);

  if (u.loading) return <Spinner />;

  return (
    <form onSubmit={async () => {
      const result = await u.submit();
      if (result.success) onClose();
    }}>
      <Input {...u.name} />    {/* isRequired: true, из editUserForm template */}
      <Input {...u.email} />   {/* isRequired: true */}
      <Select {...u.role} />
      <button disabled={u.submitting}>Save</button>
    </form>
  );
}
```

### Поток данных

```
1. Загрузка списка (resolver на users):
   → entityRegistry.upsert('u1', { name: 'Alice' })
   → entityRegistry.upsert('u2', { name: 'Bob' })
   → listState.itemIds = ['u1', 'u2']
   → UserList рендерит 2 строки

2. Клик по "Alice" → setEditUser(aliceProxy):
   → EditUserModal mount
   → useForm(alice, (s) => s.editUserForm)
   → bind('u1', editUserFormNode)
   → entity 'u1' расширяется: { id, name } → { id, name, email, role, avatar }
   → isResolved('u1', editUserFormNode)? → НЕТ
   → resolve: api.getUser('u1')
   → результат: { email: 'alice@corp.com', role: 'admin', avatar: '/a.jpg' }
   → entity 'u1' обновляется
   → markResolved('u1', editUserFormNode)
   → Форма показывает 4 поля с данными

3. Редактирование name:
   u.name.value = 'Alice Cooper'
   → entity 'u1'.name.value = 'Alice Cooper'
   → EditUserModal re-render (name leaf version++)
   → UserList: UserRow для Alice ТОЖЕ re-render (та же leaf нода!)

4. Submit:
   → onSubmit(thisForm, store)
   → thisForm.id.value = 'u1', thisForm.name.value = 'Alice Cooper', ...
   → api.updateUser('u1', thisForm)

5. Закрыли модалку:
   → unbind('u1', editUserFormNode)
   → entity 'u1' и resolved-кеш остаются

6. Открыли Alice снова:
   → isResolved('u1', editUserFormNode) → ДА
   → skip resolve! Мгновенное отображение ✓

7. Открыли Bob:
   → isResolved('u2', editUserFormNode) → НЕТ
   → resolve → загрузка данных Bob
```

---

## 9. Синхронизация значений

### Shared leaf nodes

Ключевой механизм: entity leaf node — **одна и та же** в памяти для всех view.

```
entity 'u1'.name = leaf node object X
form.users[0].name.value   → читает X.value
useForm(alice, editUserForm).name.value  → читает X.value

Запись через любой view → X.value обновляется → все observers X перерендериваются
```

Tracking proxy записывает `X` (объект-ноду) в `accessed`. NotificationHub инкрементирует версию `X`. Все компоненты, читавшие `X`, получают re-render. Не важно через какой template.

### store.set() — внешнее обновление

```
store.set({ id: 'u1', name: 'Alice Updated' })
  │
  ├─ entityRegistry.upsert('u1', { name: 'Alice Updated' })
  │   entity 'u1'.name leaf: value 'Alice' → 'Alice Updated'
  │
  ├─ changed = Set(entity 'u1'.name leaf)
  │
  └─ notifyChanged(changed)
      → UserRow для Alice: re-render (читал name leaf)
      → EditUserModal (если открыт): re-render (читал name leaf)
```

---

## 10. valuesCache

### Для списков

```ts
valuesCache.values.users = [
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
]
```

Массив объектов. Строится из `listState.itemIds` + EntityRegistry. Используется в computed:

```ts
isVisible: (values) => values.users.length > 0
```

### Для template-bound entity

Когда entity привязана к template через `useForm`, значения entity доступны через proxy (thisForm). Template сам по себе не хранит значений в valuesCache — он stateless.

При необходимости доступа к entity-данным в computed других полей — используется `store.getValues()` или `valuesCache.values` для полей, привязанных через id (обычные group nodes вроде `user.passport`).

---

## 11. Взаимосвязь с текущей архитектурой

### Что НЕ меняется

| Компонент | Статус |
|---|---|
| FieldState | Без изменений |
| useSyncExternalStore | Без изменений |
| GroupDepsMap | Без изменений (entity не участвует в groupDeps) |
| PersistManager | Без изменений на Phase 1-3 |

### Что РАСШИРЯЕТСЯ

| Компонент | Изменения |
|---|---|
| ConfigNode type | Ветка `readonly [infer Item, ...any[]]` для массивов |
| SubmitPipeline | Ветка для template-bound submit `(thisForm, store)` |
| NotificationHub | Минимальные — `bumpLeafVersions` работает через shared `leafNodes` массив |
| Proxy (buildProxy) | Крупное — ветки для ListProxy и EntityProjectionProxy |
| Tracking Proxy | Минимальные — поддержка ListNode tracking (version) |
| registerNodes | Array guard + ListState init |
| buildValuesCache | Array → `[]` + entity shared objects |
| applyPatch | Array guard |
| recomputeDirty | Array guard + list dirty по составу |
| computeProxyKeys | `LIST_SPREAD_KEYS` |
| NodeRegistry | `registerDynamicLeaf` method |
| DirtyTracker | Entity leaf initial values при resolve |
| ResolveManager | Template resolve (entity-bound) |

### Что ДОБАВЛЯЕТСЯ

| Компонент | Описание |
|---|---|
| **EntityRegistry** | Новый класс. Хранилище сущностей + resolved cache. |
| **ListState** | Новый интерфейс. Template + itemIds + version. |
| **EntityProjectionProxy** | Proxy для entity через template (list item или useForm). |
| **useForm overload** | `useForm(entity, templateSelector)` — привязка entity к template. |
| **store.set()** | Публичный метод: upsert entity. |
| **store.delete()** | Публичный метод: удаление entity. |
| **ID auto-generation** | При создании entity без ID. |
| **Resolved cache** | `Map<entityId, Set<templateNode>>` — skip resolve при повторном открытии. |

---

## 12. Типизация

### useForm overloads

```ts
// Текущий: store или subtree
function useForm<TConfig>(store: ProxyStore<TConfig>): ConfigProxy<TConfig>;
function useForm<TConfig>(subtree: ConfigProxy<TConfig>): ConfigProxy<TConfig>;

// Новый: entity + template selector
function useForm<TEntity, TTemplate>(
  entity: EntityProxy<TEntity>,
  templateSelector: (store: ConfigProxy<TConfig>) => TemplateProxy<TTemplate>,
): TemplateProxy<TTemplate>;
// Возвращает proxy entity через template: поля template + значения entity + id
```

### ListProxyNode

```ts
interface ListProxyNode<TItem> {
  readonly items: ReadonlyArray<EntityProjectionProxy<TItem>>;
  readonly length: number;
  readonly loading: boolean;

  add(id: string): void;
  add(values: Record<string, unknown>): EntityProjectionProxy<TItem>;
  remove(id: string): void;
  getById(id: string): EntityProjectionProxy<TItem> | undefined;
  setItems(ids: string[]): void;
  map<R>(fn: (item: EntityProjectionProxy<TItem>, index: number, id: string) => R): R[];
  [Symbol.iterator](): Iterator<EntityProjectionProxy<TItem>>;
}
```

### ConfigNodeToProxy (расширение)

```ts
type ConfigNodeToProxy<T> =
  T extends readonly [infer Item, ...any[]]          // ListNode: массив [template] или [template, listConfig]
    ? ListProxyNode<ConfigNodeToProxy<Item>>
    : T extends { value: any }
      ? FieldProxyNode<ExtractNodeValue<T>>
      : T extends Record<string, any>
        ? GroupProxyNode & { [K in ...]: ... }
        : never;
```

### Resolver / onSubmit types

```ts
// Новая сигнатура:
resolve: {
  resolver: (thisForm: EntityProxy<TTemplate>, store: ProxyStore<TConfig>) => Promise<...>;
}

onSubmit: (thisForm: EntityProxy<TTemplate>, store: ProxyStore<TConfig>) => Promise<...>;
```

---

## 13. Решения по архитектурным вопросам

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | **Formatter/setter в list item** | **ДА**. Ноды внутри списка — полноценные. Template в `[template, listConfig]` — обычная группа, все правила (formatter, setter, validate, onChange) работают и в списке. Нет концепции «облегчённого proxy». |
| 2 | **Вложенные entities** (`user.passport`) | **ДА, сразу**. EntityNode может содержать вложенные группы с leaf-нодами. `upsert` — рекурсивный merge. |
| 3 | **Entity re-keying** (temp → real ID) | `EntityRegistry.rekey(oldId, newId)` — обновляет Map, bindings, resolvedCache, itemIds во всех списках. Реализуется в Фазе 1.3. |
| 4 | **Два useForm на одну entity+template** | Не допускать одновременное открытие одной entity в одном template в двух компонентах. Если первый ещё pending — второй показывает `loading: true`. |
| 5 | **Invalidation resolved cache** | `store.invalidate(entityId, templateNode?)`. При `store.set()` — resolved cache **НЕ** сбрасывается (данные совместимы). Сброс только по явному вызову или при `store.delete()`. |
| 6 | **Синтаксис списков** | `[template, listConfig]` — массив длины 1-2. Первый элемент = обычная группа (template). Второй = конфигурация списка (resolve и т.д.). Чистый JS, без хелперов. |
| 7 | **Dirty для списков** | **Dirty по составу**: `listState.initialItemIds` сохраняется при init/resolve. `dirty = itemIds !== initialItemIds`. Dirty по значениям внутри items — это dirty на уровне entity leaf. |

---

## 14. Аудит: совместимость с текущим кодом

> Code review 2026-03-15. Найдены точки несовместимости плана с реализацией.
> Ниже — finding + принятое решение.

### П1. Сигнатура `resolver` / `onSubmit`

**Текущий код**: `resolver(values)`, `onSubmit(values)` — один аргумент (tracking proxy / snapshot).
**Новый план**: `(thisForm, store)` — два аргумента.

**Решение**: Меняем сигнатуру. `thisForm` — значения текущей группы/entity, `store` — ссылка на Palistor. Это удобнее в 90% случаев (доступ к `id` и другим полям entity). Обратная совместимость не нужна — это breaking change для новой major version.

---

### П2. Tree-walkers не понимают массивы

10 функций обходят config-дерево через `Object.keys(node)`. Массив `[{...}]` будет обработан как обычная группа с ключом `"0"`.

**Решение**: Array guard перед циклом по ключам: `if (Array.isArray(child)) { /* ListNode */ }`. В фазе 0 — просто `continue` (пропускать). В фазе 2 — полноценная обработка ListNode.

| Затронутые функции |
|---|
| `registerNodes`, `buildNodeMaps`, `buildValuesCache`, `applyPatch`, `initResolveStates`, `recomputeDirty`, `initGroupSubmitting`, `collectDefaults`, `captureInitialValues`, `collectInitialSnapshot` |

---

### П3. Динамическое создание entity leaf нод

Entity leaf ноды создаются в runtime (при `store.set()`, resolve), но все WeakMap-ы заполняются при init.

**Решение**: `NodeRegistry.registerDynamicLeaf(node, path, parent, state)` — обновляет все 6 WeakMap-ов + push в `leafNodes` массив. Entity leafs добавляются в тот же `leafNodes` массив, что и статические — `bumpLeafVersions` работает автоматически.

---

### П4. `groupDeps` и entity

`GroupDepsMap` строится из статического config tree. Entity ноды создаются после init.

**Решение**: Entity leaf ноды **не участвуют** в groupDeps. Изменение entity leaf → полный recompute для template-bound узлов. Это приемлемо: entity меняется редко (resolve, submit, store.set), recompute = O(поля entity).

---

### П5. `valuesCache` для списков

`nodeSlot` — WeakMap с одним value на key. Один entity leaf может быть и в списке, и в template.

**Решение**: `nodeSlot` entity leaf указывает на **entity-объект**. Список содержит **ссылки на те же entity-объекты**:
```ts
const entityObj = { id: 'u1', name: 'Alice' };
valuesCache.values.users = [entityObj, ...];
nodeSlot.set(u1NameNode, { parent: entityObj, key: 'name' });
// Обновление → entityObj.name = 'Updated' → users[0].name тоже обновлён (shared ref)
```

---

### П6. Типизация: `ConfigNodeToProxy`, `ExtractValues`, `isListNode`

**`isListNode`**: `Array.isArray(node) && node.length >= 1 && node.length <= 2`. Три типа нод: leaf (`"value" in node`), list (`Array.isArray(node)`), group (всё остальное).

**`ConfigNodeToProxy`**: Ветка `T extends readonly [infer Item, ...any[]]` → `ListProxyNode<...>`.

**`ExtractValues`**: Ветка `T[K] extends readonly [infer Item, ...any[]]` → `Array<ExtractValues<Item>>`.

**`computeProxyKeys`**: Третья ветка `LIST_SPREAD_KEYS` для ListNode.

---

### П7. `buildProxy` — стратегии для list и entity

**Решение**: 4 build-стратегии в ProxyBuilder:
1. `buildFieldProxy(leaf)` — текущая leaf логика
2. `buildGroupProxy(group)` — текущая group логика
3. `buildListProxy(listNode)` — **новая**, GET handlers для `items, length, add, remove, map, ...`
4. `buildEntityProjectionProxy(entityNode, template)` — **новая**, читает value из EntityRegistry, применяет правила template

---

### П8. Entity re-keying: `rekey(oldId, newId)`

```ts
rekey(oldId: string, newId: string): void {
  const entity = this.entities.get(oldId);
  if (!entity) return;
  entity.id.value = newId;
  this.entities.delete(oldId);
  this.entities.set(newId, entity);
  // Переместить bindings, resolvedCache
  this.bindings.set(newId, this.bindings.get(oldId));
  this.bindings.delete(oldId);
  this.resolvedCache.set(newId, this.resolvedCache.get(oldId));
  this.resolvedCache.delete(oldId);
  // Обновить itemIds во всех списках
  for (const list of this.allLists) {
    const idx = list.itemIds.indexOf(oldId);
    if (idx >= 0) list.itemIds[idx] = newId;
  }
}
```

---

### П9. Persist для EntityRegistry

**Решение**: Phase 1-3 — persist только для обычных форм. Entity persist — Phase 4 (после стабилизации core).

---

## 15. План реализации

> **Принцип разбиения**: каждая фаза рассчитана на одну сессию Claude Sonnet 4.6 (~300-400 строк нового/изменённого кода, 5-10 файлов). Фаза завершается тестами — можно проверить результат перед следующей сессией.

### Фаза 0: Подготовка инфраструктуры

> Цель: подготовить существующий код к расширению без ломки.

| # | Задача | Описание | Файлы |
|---|--------|---------|-------|
| 0.1 | `isListNode` helper | `Array.isArray(node) && node.length >= 1 && node.length <= 2` | `store/constants.ts` или `nodeUtils.ts` |
| 0.2 | Array guard во всех tree-walkers | `if (Array.isArray(child)) continue;` — 10 функций: `registerNodes`, `buildNodeMaps`, `buildValuesCache`, `applyPatch`, `initResolveStates`, `recomputeDirty`, `initGroupSubmitting`, `collectDefaults`, `captureInitialValues`, `collectInitialSnapshot` | см. П2 |
| 0.3 | `NodeRegistry.registerDynamicLeaf()` | Runtime-регистрация leaf node во всех WeakMaps + `leafNodes.push` | `nodeRegistry.ts` |
| 0.4 | `LIST_SPREAD_KEYS` constant | `["items", "length", "loading", "add", "remove", "getById", "setItems", "map"]` | `store/constants.ts` |
| 0.5 | Тесты на array guard | Конфиг с `[{...}]` и `[{...}, {...}]` не ломает существующие пайплайны | |

### Фаза 1A: EntityRegistry — ядро

> Цель: создать изолированный класс EntityRegistry с полным CRUD и unit-тестами. Не зависит от Palistor.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 1A.1 | `EntityRegistry` класс | `Map<id, EntityNode>`, `bindings`, `resolvedCache`. Методы: `upsert`, `get`, `delete`, `bind`, `unbind`, `markResolved`, `isResolved`, `clearResolved`. | — |
| 1A.2 | `EntityNode` — создание leaf нод | Каждый лист = `{ value }`, поддержка вложенных групп. Рекурсивный merge при upsert (существующие поля обновляются, новые добавляются, отсутствующие не удаляются). | 1A.1 |
| 1A.3 | ID auto-generation | `_tmp_` prefix для пустого id. | 1A.1 |
| 1A.4 | `rekey(oldId, newId)` | Обновляет Map, bindings, resolvedCache. Обновление itemIds в списках — отложено до фазы 2C. | 1A.1 |
| 1A.5 | Unit-тесты EntityRegistry | CRUD, вложенные entities, merge, rekey, bind/unbind, resolvedCache. Тесты изолированные — без Palistor. | 1A.1-1A.4 |

### Фаза 1B: Интеграция EntityRegistry в Palistor

> Цель: подключить EntityRegistry к store, реализовать `store.set()` и `store.delete()` с полной интеграцией в NotificationHub и recompute.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 1B.1 | `this.entityRegistry` field в Palistor | Создание EntityRegistry при init стора. | 1A.1 |
| 1B.2 | `store.set(data \| data[])` | Upsert entity → рекурсивное слияние → регистрация leaf нод через `registerDynamicLeaf` → changed → recompute → notifyChanged. Batch-режим для массивов. | 0.3, 1A.2 |
| 1B.3 | `store.delete(id)` | Удалить entity из registry, убрать id из всех списков (когда появятся), unbind все templates, очистить resolvedCache, удалить leaf-ноды из nodeState, notifyChanged. | 1A.1 |
| 1B.4 | Интеграционные тесты | `store.set()` обновляет entity → notification → recompute. `store.delete()` → cleanup. Batch set. Merge поведение (не удаляет отсутствующие поля). | 1B.1-1B.3 |

### Фаза 2A: ListState + типизация + registerNodes

> Цель: научить стор распознавать массивы как ListNode при init. Добавить ListState, типы, обработку в registerNodes.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 2A.1 | `ListState` interface | `{ template, listConfig?, itemIds, version, initialItemIds }`. `ListConfig` = `{ resolve? }`. | — |
| 2A.2 | ListNode detection в `registerNodes` | При обходе config tree: `if (isListNode(child))` → создать ListState, зарегистрировать template (array[0]) как обычную группу, извлечь listConfig из array[1]. WeakMap `listStates: Map<configNode, ListState>`. | 0.1, 0.2 |
| 2A.3 | `applyPatch` — array guard | Массив в патче → пропускать (списки обновляются через `store.set()`, не через patch). | 0.2 |
| 2A.4 | Типизация: `ConfigNodeToProxy` + `ExtractValues` | Ветка `T extends readonly [infer Item, ...any[]]` → `ListProxyNode<...>`. `ExtractValues`: `Array<ExtractValues<Item>>`. | — |
| 2A.5 | `computeProxyKeys` — ветка `LIST_SPREAD_KEYS` | Третья ветка: если `isListNode(node)` → возвращать `LIST_SPREAD_KEYS`. | 0.4 |
| 2A.6 | Тесты | Конфиг с массивами корректно инициализируется. ListState создаётся. Типы компилируются. `applyPatch` не ломается на массивах. | 2A.1-2A.5 |

### Фаза 2B: Proxy для списков

> Цель: реализовать `ListProxyNode` и `EntityProjectionProxy` — два новых типа proxy в ProxyBuilder.
>
> **Примечание**: `EntityProjectionProxy` — единый proxy для entity через template. Используется и в списках (как элемент), и в `useForm(entity, template)` (фаза 3A). Не создаётся отдельный класс для каждого случая.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 2B.1 | `buildListProxy(listNode)` — ветка в ProxyBuilder | GET trap: `items` → массив EntityProjectionProxy, `length`, `loading`, `add(id\|values)`, `remove(id)`, `getById(id)`, `setItems(ids)`, `map(fn)`, `[Symbol.iterator]`. | 0.4, 2A.2 |
| 2B.2 | `EntityProjectionProxy` — proxy для entity через template | Полноценный proxy: entity leaf values + все правила template (formatter, setter, validate, isRequired, onChange). Строится из `(entityNode, templateNode)`. Запись `proxy.name.value = 'X'` → обновляет entity leaf. | 1A.2, 2A.2 |
| 2B.3 | List в `valuesCache` | `values.users = [entityObj1, entityObj2, ...]`. Entity объекты = shared references. `nodeSlot` entity leaf указывает на entity-объект (см. П5). | 2A.2, 2B.2 |
| 2B.4 | Тесты proxy | `form.users.length`, `form.users.items[0].name.value`, `form.users.add(...)`, `form.users.remove(...)`, `form.users.map(...)`. EntityProjectionProxy: formatter/setter/validate работают. Запись через proxy обновляет entity. | 2B.1-2B.3 |

### Фаза 2C: List resolver + React tracking

> Цель: списки загружают данные через resolver и корректно трекаются для React re-render.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 2C.1 | List resolver | Resolve на list node: конфиг из `array[1].resolve`. Результат → `entityRegistry.upsert()` для каждого элемента → `listState.itemIds = data.map(item => item.id)` → `version++` → notifyChanged. | 2A.2, 1B.2 |
| 2C.2 | `rekey` — обновление itemIds | Расширить `EntityRegistry.rekey()` — обновлять `itemIds` во всех ListState. | 1A.4, 2A.2 |
| 2C.3 | List tracking для React | Чтение `users.items` / `users.map()` → tracking записывает ListNode. `version++` при add/remove → notify → re-render. Entity leaf change → notify per-leaf (не весь список). | 2B.1 |
| 2C.4 | Dirty для списков | `listState.initialItemIds` сохраняется при init/resolve. `dirty = !arraysEqual(itemIds, initialItemIds)`. Dirty по значениям внутри items — на уровне entity leaf (существующий механизм). | 2A.2 |
| 2C.5 | Тесты | Resolver загружает список → entities созданы → proxy работает. Tracking: add → re-render. Entity change → только строка обновляется. Dirty: добавление/удаление → dirty. Rekey обновляет itemIds. | 2C.1-2C.4 |

### Фаза 3A: Новые сигнатуры + useForm overload

> Цель: breaking change сигнатур resolver/onSubmit, новый overload `useForm(entity, template)`, bind/unbind lifecycle, resolved cache.
>
> **Важно**: сначала обновить все существующие тесты resolve/submit пайплайнов под новую сигнатуру `(thisForm, store)`, затем менять код. Иначе большая часть сессии уйдёт на починку сломанных тестов.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 3A.1 | Обновить существующие тесты | Все тесты `resolvePipeline`, `submitPipeline` — обновить mock-и resolver/onSubmit под сигнатуру `(thisForm, store)`. | — |
| 3A.2 | Новая сигнатура resolver/onSubmit в коде | `resolver(thisForm, store)` вместо `resolver(values)`. `onSubmit(thisForm, store)` вместо `onSubmit(values)`. Breaking change. | 3A.1 |
| 3A.3 | Entity-template binding lifecycle | `bind` при mount, `unbind` при unmount. Entity расширяется полями template при bind. Guard на двойное открытие одной entity+template в двух компонентах. | 1A.1, 1A.2 |
| 3A.4 | Resolved cache интеграция | `isResolved(entityId, templateNode)` → skip resolve при повторном открытии. `markResolved` после успешного resolve. | 1A.1 |
| 3A.5 | Overload `useForm(entity, templateSelector)` | Второй аргумент → `(store) => store.editUserForm`. Определяет: entity ID из proxy, template из selector. Вызывает bind, проверяет resolved cache, возвращает proxy. При unmount — unbind. | 2B.2, 3A.2 |
| 3A.6 | Тесты | Старые тесты проходят с новой сигнатурой. useForm overload: bind/unbind lifecycle. Resolved cache: open → close → open = skip resolve. Guard на двойное открытие. | 3A.1-3A.5 |

### Фаза 3B: Template resolve + submit pipelines

> Цель: полноценная работа resolve и submit для entity-bound templates через `useForm(entity, template)`.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 3B.1 | Template resolve pipeline | `resolver(thisForm, store)`. `thisForm` = EntityProjectionProxy (entity через template). Результат сливается в entity через `entityRegistry.upsert()`. После resolve — `markResolved`. `loading` state на useForm proxy. | 3A.2, 2B.2 |
| 3B.2 | Template submit pipeline | `onSubmit(thisForm, store)`. `thisForm` = EntityProjectionProxy. Submit собирает entity values через template. `submitting` state. Валидация перед submit (isRequired, validate) — через template rules на entity листьях. | 3A.2, 2B.2 |
| 3B.3 | `store.invalidate(id, template?)` | API для сброса resolved cache. Без template → сбросить все. С template → сбросить конкретную пару. Триггерит re-resolve при следующем bind. | 3A.4 |
| 3B.4 | Тесты | Template resolve: загружает → merge в entity → markResolved → skip на повторе. Template submit: собирает значения → валидация → onSubmit. Invalidate → re-resolve. Loading/submitting states. | 3B.1-3B.3 |

### Фаза 4: Интеграция и E2E

> Цель: убедиться, что все части работают вместе. Shared leaf notifications, bumpLeafVersions, полный E2E сценарий.

| # | Задача | Описание | Зависит от |
|---|--------|---------|------------|
| 4.1 | Shared leaf notifications | Entity leaf `version++` → все observers (список + форма). Тест: edit name в форме → UserRow в списке re-render (та же leaf нода). | 2C.3, 3A.5 |
| 4.2 | `bumpLeafVersions` с entity leafs | Entity leafs зарегистрированы в том же `leafNodes` массиве через `registerDynamicLeaf` → translator change бампит всё автоматически. Верифицировать. | 0.3 |
| 4.3 | E2E тесты — полный сценарий | Список → resolver загружает entities → клик → useForm(entity, template) → resolve доп. полей → edit name → список обновился → close → open снова (кеш) → submit. | все |
| 4.4 | Persist для entities (опционально) | Сериализация EntityRegistry + listStates. Гидрация entity leaf нод. **Отдельная сессия если потребуется.** | 1A.1, 2A.1 |

---

### Сводная таблица фаз

| # | Фаза | Ключевое содержание | ~Строк | ~Файлов |
|---|------|---------------------|--------|---------|
| 0 | Подготовка | `isListNode`, array guards в 10 функциях, `LIST_SPREAD_KEYS`, `registerDynamicLeaf`, тесты | ~100 | ~12 |
| 1A | EntityRegistry (ядро) | Изолированный класс, EntityNode, upsert/merge, rekey, ID auto-gen, unit-тесты | ~350 | ~3 |
| 1B | EntityRegistry → Palistor | `store.set()`, `store.delete()`, интеграция с NotificationHub + registerDynamicLeaf, интеграционные тесты | ~300 | ~5 |
| 2A | ListState + типы | ListState, detection в registerNodes, типы `ConfigNodeToProxy`/`ExtractValues`, `computeProxyKeys`, applyPatch guard | ~300 | ~8 |
| 2B | Proxy для списков | `ListProxyNode`, `EntityProjectionProxy` (единый для списков и useForm), valuesCache для списков, тесты proxy | ~400 | ~6 |
| 2C | List resolver + React | Resolver для списков, rekey+itemIds, list tracking, dirty по составу, тесты | ~300 | ~6 |
| 3A | useForm overload + сигнатуры | Breaking change сигнатур (тесты сначала!), useForm overload, bind/unbind, resolved cache | ~400 | ~8 |
| 3B | Template pipelines | Template resolve/submit через EntityProjectionProxy, `store.invalidate()`, тесты | ~350 | ~5 |
| 4 | Интеграция + E2E | Shared leaf notify, bumpLeafVersions, E2E тесты полного сценария | ~300 | ~4 |
