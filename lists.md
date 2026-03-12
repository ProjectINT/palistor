# Списки и модульность через ID — План реализации

## Текущая архитектура (резюме)

Дерево конфига статично: все узлы создаются при `createProxyStore` и никогда не добавляются/удаляются.

**Ключевые структуры данных:**
- `nodeState: WeakMap<object, FieldState>` — вычисленное состояние каждого узла
- `leafNodes: Array<{node, path}>` — все листовые узлы для recompute
- `proxyCache: WeakMap<object, unknown>` — один Proxy на узел конфига
- `initialValueMap: WeakMap<object, unknown>` — начальные значения для dirty
- `nodePaths: WeakMap<object, string>` — dot-путь каждого узла
- `nodeParents: WeakMap<object, object>` — родитель каждого узла

**Обход дерева:** все функции (`registerNodes`, `applyPatch`, `recomputeAll`, `buildNodeMaps`, `captureInitialValues`, `recomputeDirty`) итерируются по `Object.keys(node)`, пропуская `CONFIG_PROPS`, и рекурсируют в дочерние объекты. Массивы сейчас **не обрабатываются** — `applyPatch` явно пропускает `Array.isArray`.

---

## Концепция списков

### Объявление в конфиге

```ts
const config = {
  // обычный групповой узел
  order: {
    total: { value: 0 },
  },

  // список — массив с одним элементом-шаблоном
  users: [{
    name: { value: '', isRequired: true },
    email: { value: '', validate: (v) => !v ? 'required' : undefined },
  }],
};
```

Массив из одного элемента = шаблон (template) для элементов списка. Сам массив — это **ListNode**.

### Сущности (Entity) и ID

Каждый элемент списка — это полноценный групповой узел со своим ID.

```
ListNode "users"
  ├─ entity "abc-1" → { name: { value: "Alice" }, email: { value: "alice@..." } }
  ├─ entity "abc-2" → { name: { value: "Bob" }, email: { value: "bob@..." } }
  └─ entity "abc-3" → { name: { value: "Carol" }, email: { value: "carol@..." } }
```

ID генерируется автоматически при добавлении (или принимается извне, например с сервера).

### Разделяемые ссылки

Одна и та же сущность может быть в нескольких списках:

```ts
const config = {
  allUsers: [{ name: { value: '' } }],
  activeUsers: [{ name: { value: '' } }], // тот же шаблон
};

// Один объект присутствует в обоих списках:
store.proxy.allUsers.add(entity);
store.proxy.activeUsers.add(entity); // ссылка на тот же узел
```

Изменение `entity.name.value` отразится в обоих списках автоматически — это один и тот же config-узел.

### API списков

```ts
// Через прокси:
const users = form.users;

users.items        // массив entity proxy (readonly)
users.length       // количество элементов
users.add(values?) // создать новый элемент из шаблона (+ optional initial values), вернуть proxy
users.remove(id)   // удалить элемент по ID
users.getById(id)  // получить элемент по ID
users.map(fn)      // маппинг по элементам (для React рендеринга)
users.dirty        // хотя бы один элемент dirty
users.submitting   // submit в процессе

// Каждый элемент — полноценный GroupProxyNode:
const user = users.items[0];
user.id             // уникальный ID сущности
user.name.value     // "Alice"
user.dirty          // dirty этого элемента
user.submit()       // submit этого элемента
user.reset()        // reset этого элемента
```

---

## Пошаговый план

### Шаг 0: `recomputeGroup(node)` — скопированный recompute

**Зачем:** Сейчас `recomputeAll` пересчитывает **все** листья в массиве `leafNodes`. При изменении одного элемента списка из 1000 пересчитываются все 1000. Нужна функция, которая пересчитывает только поддерево одного узла.

**Что делать:**
1. Создать `recomputeGroup(groupNode, nodeState, translate)` — пересчитывает только leafNodes, принадлежащие поддереву `groupNode`.
2. Для определения принадлежности: либо фильтровать `leafNodes` по path-prefix (`nodePaths`), либо хранить per-group список leafNodes.
3. Рефакторить `recomputeAll` → вызов `recomputeGroup(rootConfig)`.
4. При записи значения в элемент списка — вызывать `recomputeGroup(entity)` вместо `recomputeAll`.

**Что нужно решить:**
- Computed-свойства могут зависеть от значений **вне** группы (например, `isVisible: (values) => values.order.total > 0`). При скопированном recompute мы всё равно берём `valuesCache.values` для всех computed/validate, так что зависимости от внешних полей работают. Но внешние поля не пересчитываются — если есть обратная зависимость, нужен полный recompute.
- **Решение:** `recomputeGroup` пересчитывает только поддерево, но берёт глобальный `valuesCache.values`. Для обратных зависимостей (computed вне группы, зависящий от поля в группе) — оставляем `recomputeAll` при необходимости (через `dependencies` граф).

**Файлы:** `store/recomputeAll.ts`

---

### Шаг 1: Детекция и хранение списков

**Зачем:** Нужно при инициализации распознать массив в конфиге как ListNode, сохранить шаблон, и **не** пытаться обходить его как обычный объект.

**Что делать:**
1. Добавить в `CONFIG_PROPS` / `constants.ts` новый символ `LIST_NODE` (или пропускать массивы явно).
2. В `registerNodes` — при встрече массива длины 1 (шаблон):
   - Сохранить шаблон (`template = array[0]`)
   - Создать `ListState` — хранилище метаданных списка (template, items: Map<string, configNode>, order: string[])
   - Зарегистрировать ListNode в `nodeState` (с `value: undefined`, аналогично группе)
3. Создать `store/listState.ts`:
   ```ts
   interface ListState {
     template: AnyConfigNode;         // шаблон элемента
     items: Map<string, AnyConfigNode>; // id → config node
     order: string[];                  // порядок ID
   }
   ```
4. `WeakMap<object, ListState>` — хранилище состояния списков (ключ — массив из конфига).

**Что НЕ трогаем:** `applyPatch` и другие pipeline-файлы — на этом шаге списки пустые, нет элементов.

**Файлы:** `store/listState.ts` (новый), `store/constants.ts`, `store/registerNodes.ts`

---

### Шаг 2: Создание элемента списка (add)

**Зачем:** API для добавления нового элемента в список. Элемент создаётся из шаблона, регистрируется во всех WeakMap, и получает уникальный ID.

**Что делать:**
1. Функция `createListItem(listState, listNode, initialValues?, id?)`:
   - Глубоко клонировать `template` → создать новый config-объект `entity`
   - Присвоить ID: `id ?? crypto.randomUUID()` (или nanoid/counter)
   - Вызвать `registerNodes(entity, initialValues, leafNodes, nodeState)` — регистрирует все листья
   - Вызвать `buildNodeMaps(entity, nodePaths, nodeParents)` — пути и родители
   - Вызвать `initGroupSubmitting(entity, nodeState)` — submitting/dirty/revalidate для группы
   - Вызвать `captureInitialValues(entity, nodeState, initialValueMap)` — dirty baseline
   - Добавить в `listState.items.set(id, entity)` и `listState.order.push(id)`
   - `recomputeGroup(entity)` — пересчитать новый элемент
   - `notifyChanged` — уведомить подписчиков
   - Вернуть `{ id, node: entity }`

2. При клонировании шаблона: все объекты создаются заново (deep clone), но функции (validate, formatter, setter, computed) **остаются ссылками на оригиналы** — это правильно, т.к. функции stateless.

**Важно:** Пути элементов в `nodePaths` будут иметь вид `users.[abc-1].name`, `users.[abc-2].email` — используем ID в path.

**Файлы:** `store/listOperations.ts` (новый)

---

### Шаг 3: Удаление элемента из списка (remove)

**Зачем:** Очистка при удалении — WeakMap сами собирают мусор при потере ссылок, но нужно убрать из `leafNodes`, `listState`, `proxyCache`, и уведомить подписчиков.

**Что делать:**
1. `removeListItem(listState, id)`:
   - Получить `entity = listState.items.get(id)`
   - Удалить из `listState.items` и `listState.order`
   - Удалить все leaf-узлы entity из `leafNodes` (фильтр по path-prefix)
   - `notifyChanged` — уведомить подписчиков (версия списка инкрементируется)
   - WeakMap-ы (`nodeState`, `proxyCache`, `nodePaths`, `nodeParents`, `initialValueMap`) очистятся автоматически при GC, но можно явно удалить для немедленного освобождения.

2. Если элемент присутствует в нескольких списках — удаление из одного списка не уничтожает сущность. Сущность уничтожается только когда её нет ни в одном списке (или явно).

**Файлы:** `store/listOperations.ts`

---

### Шаг 4: Proxy для списков

**Зачем:** При обращении к `form.users` прокси должен вернуть не обычный GroupProxyNode, а ListProxyNode с массивным API.

**Что делать:**
1. В `buildProxy.ts` — в GET trap при обращении к дочернему ключу:
   - Проверяем, является ли `child` массивом (Array.isArray) → это ListNode
   - Строим специальный `ListProxy` вместо обычного рекурсивного buildProxy
2. `ListProxy` — Proxy над объектом с traps:
   ```ts
   {
     get(target, key) {
       // "items" → массив buildProxy(entity) для каждого элемента по порядку
       // "length" → listState.order.length
       // "add" → (values?, id?) => createListItem(...)
       // "remove" → (id) => removeListItem(...)
       // "getById" → (id) => buildProxy(listState.items.get(id))
       // "map" → (fn) => listState.order.map((id, i) => fn(buildProxy(items.get(id)), i, id))
       // "dirty" → хотя бы один элемент dirty
       // "submitting" → ...
       // числовой индекс → buildProxy(items.get(order[index]))
       // Symbol.iterator → итерация по элементам
     }
   }
   ```
3. Для tracking proxy: при обращении к `form.users.items[0].name.value` — tracking записывает config-ноду `name` конкретного элемента. Изменение `name` у другого элемента не вызовет re-render.

**Файлы:** `store/buildProxy/buildListProxy.ts` (новый), `store/buildProxy/buildProxy.ts` (модификация)

---

### Шаг 5: valuesCache / applyPatch для списков

**Зачем:** `valuesCache.values` содержит snapshot значений для computed/validate. Списки должны быть представлены как массив объектов. `applyPatch` должен уметь принимать массив для bulk-обновления списка.

**Что делать:**
1. `buildValuesCache` — при встрече массива (ListNode):
   ```ts
   // Вместо рекурсии в объект:
   result.set(key, listState.order.map(id => {
     const entity = listState.items.get(id);
     return { _id: id, ...getSubValues(valuesCache.values, entity) };
   }));
   ```
2. `applyPatch` — при встрече массива в патче:
   - Если `patchValue` — массив: это bulk-update списка (перезапись данных, например с сервера)
   - Если `patchValue` — объект с `_id`: обновление конкретного элемента

**Решение нужно продумать:** Как `computed` и `validate` будут получать список в values? Скорее всего массив объектов:
```ts
// В computed/validate:
isVisible: (values) => values.users.length > 0
isVisible: (values) => values.users.some(u => u.name === 'Admin')
```

**Файлы:** `store/valuesCache.ts`, `store/applyPatch.ts`

---

### Шаг 6: Типизация

**Зачем:** TypeScript должен понимать, что массив в конфиге — это список, и выдавать правильные типы для proxy.

**Что делать:**
1. `ConfigNodeToProxy` — добавить ветку для массива:
   ```ts
   type ConfigNodeToProxy<T> =
     T extends [infer Item]
       ? ListProxyNode<ConfigNodeToProxy<Item>>  // массив из одного = список
       : T extends { value: any }
         ? FieldProxyNode<ExtractNodeValue<T>>
         : T extends Record<string, any>
           ? GroupProxyNode & { ... }
           : never;
   ```
2. `ListProxyNode<TItem>`:
   ```ts
   interface ListProxyNode<TItem> {
     readonly items: ReadonlyArray<TItem & { readonly id: string }>;
     readonly length: number;
     add(values?: Partial<ExtractValues<...>>, id?: string): TItem & { readonly id: string };
     remove(id: string): void;
     getById(id: string): TItem & { readonly id: string } | undefined;
     map<R>(fn: (item: TItem & { readonly id: string }, index: number, id: string) => R): R[];
     readonly dirty: boolean;
     readonly submitting: boolean;
   }
   ```
3. `ExtractValues` — для массивов:
   ```ts
   T extends [infer Item]
     ? Array<ExtractValues<Item>>
     : ...
   ```

**Файлы:** `store/types.ts`

---

### Шаг 7: Dirty / Reset / Submit для списков

**Зачем:** Списки должны интегрироваться с существующими pipeline.

**Dirty:**
- `ListNode.dirty` = хотя бы один элемент dirty, ИЛИ порядок/состав элементов изменился (add/remove с момента initial).
- `recomputeDirty` нужно расширить: при встрече ListNode — проверить dirty каждого элемента + сравнить текущий `order` с initial `order`.

**Reset:**
- `list.reset()` — удалить все элементы, вернуть к начальному состоянию (пустой список, или initial items).
- Для каждого элемента можно вызвать `entity.reset()` отдельно.

**Submit:**
- При submit группы, содержащей список — `beforeSubmit` получает значения со списком (массив).
- Каждый элемент списка проверяется на валидацию.
- `onSubmit` получает snapshot, где списки — это массивы объектов.

**Файлы:** `store/dirtyTracking.ts`, `store/resetPipeline.ts`, `store/submitPipeline.ts`

---

### Шаг 8: React — подписки на списки

**Зачем:** React-компоненты должны подписываться на изменения списка (добавление/удаление) и на изменения конкретных элементов.

**Что делать:**
1. Версионирование ListNode: при add/remove инкрементируется версия ListNode → компонент, который читал `users.items` или `users.length`, перерендерится.
2. Элемент списка — обычный GroupProxyNode → tracking proxy работает как обычно. Компонент, рендерящий один элемент, перерендерится только при изменении этого элемента.
3. Паттерн рендеринга:
   ```tsx
   function UserList() {
     const form = useForm(store);
     return form.users.map((user, i, id) => (
       <UserItem key={id} user={user} />
     ));
   }
   
   function UserItem({ user }) {
     const u = useForm(user); // независимый tracking
     return <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />;
   }
   ```

**Файлы:** `react/useForm.ts` (минимальные изменения — tracking proxy уже работает для объектов), `react/createTrackingProxy.ts` (обработка массивов в items)

---

### Шаг 9: Resolve для списков

**Зачем:** Список может загружаться с сервера: `users.resolve = { resolver: async () => fetch('/api/users') }`.

**Что делать:**
1. ListNode может иметь `resolve` в конфиге (рядом с шаблоном):
   ```ts
   users: Object.assign([{ name: { value: '' } }], {
     resolve: {
       resolver: async () => {
         const data = await fetch('/api/users').then(r => r.json());
         return data; // массив объектов
       },
       onError: (err, { notify }) => notify('Ошибка загрузки пользователей'),
     },
   }),
   ```
   Или альтернативный синтаксис (обсудить).
2. При resolve списка: результат — массив объектов. Для каждого объекта — `createListItem` с данными.
3. `handleLazyResolve` — расширить для ListNode.

**Файлы:** `store/resolvePipeline.ts`, `store/buildProxy/handleLazyResolve.ts`

---

### Шаг 10: Persist для списков

**Зачем:** Сохранение/восстановление состояния списков в localStorage/sessionStorage.

**Что делать:**
1. При hydrate: если в persisted-данных есть массив для ListNode — создать элементы через `createListItem`.
2. При auto-save: `valuesCache.values` уже включает списки как массивы — persist работает через `getValues`.

**Файлы:** `store/persist/persistManager.ts`

---

## Порядок реализации

| # | Задача | Зависимости | Оценка |
|---|--------|-------------|--------|
| 0 | `recomputeGroup` | — | Средняя |
| 1 | `ListState` + детекция массивов | — | Легко |
| 2 | `createListItem` + `removeListItem` | 0, 1 | Средняя |
| 3 | Типизация (`ListProxyNode`, `ConfigNodeToProxy`) | 1 | Средняя |
| 4 | `buildListProxy` + integration в `buildProxy` | 2, 3 | Сложная |
| 5 | `valuesCache` / `applyPatch` для списков | 1, 2 | Средняя |
| 6 | Dirty / Reset / Submit для списков | 2, 5 | Средняя |
| 7 | React подписки на списки | 4 | Средняя |
| 8 | Resolve для списков | 4, 5 | Средняя |
| 9 | Persist для списков | 5 | Легко |

---

## Открытые вопросы

1. **Синтаксис resolve для списка** — `Object.assign([template], { resolve })` неидеален. Альтернатива: оборачивать в helper `list({ template, resolve })` или использовать специальный ключ в шаблоне.

2. **initialValues для списков** — при `createProxyStore({ config, initialValues: { users: [{ name: 'Alice' }, { name: 'Bob' }] } })` нужно автоматически создать элементы. Как передавать ID?

3. **Глубокое клонирование шаблона** — функции не клонируются (stateless), но что делать с `componentProps` объектами? Клонировать или разделять?

4. **Порядок элементов** — поддерживать ли reorder (move/swap)? Или достаточно add/remove?

5. **Вложенные списки** — элемент списка может содержать другой список? Если да — рекурсия усложняется.

6. **Модульность через ID** — помимо списков, нужен ли глобальный registry сущностей (`entityRegistry: Map<string, AnyConfigNode>`) для доступа к любой сущности по ID напрямую из store, без привязки к конкретному списку?

7. **onChange для списков** — при изменении поля внутри элемента списка, `onChange` поднимается к предкам. Должен ли ListNode (массив) быть предком? fieldKey будет вида `[abc-1].name`?
