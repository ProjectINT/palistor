# Palistor — Entity-методы (строки 500–811)

Документация по приватным и internal-методам класса `Palistor`, отвечающим
за работу с entity (сущностями): submit, upsert, синхронизация кеша,
обход дерева, валидация.

---

## Оглавление

1. [executeEntityTemplateSubmit](#1-executeentitytemplatesubmit)
2. [_setEntitiesRaw](#2-_setentitiesraw)
3. [_syncListValuesCache](#3-_synclistvaluescache)
4. [walkAndSyncEntityNode](#4-walkandsyncemtitynode)
5. [collectEntityLeaves](#5-collectentityleaves)
6. [collectEntityTemplateErrors](#6-collectentitytemplateerrors)
7. [buildEntityValuesForTemplate](#7-buildentityvaluesfortemplate)

---

## Ключевые структуры данных

```
EntityNode (сущность в реестре):
{
  id:   { value: "u1" },          // EntityLeafNode — обязательный leaf
  name: { value: "Alice" },       // EntityLeafNode — произвольное поле
  address: {                      // EntityGroupNode — вложенная группа
    city:   { value: "Moscow" },
    street: { value: "Tverskaya" }
  }
}

projectionObj (POJO-зеркало для valuesCache):
{
  id: "u1",
  name: "Alice",
  address: { city: "Moscow", street: "Tverskaya" }
}

templateNode (шаблон формы для entity):
{
  name:  { value: "", validate: (v) => !v ? "Required" : undefined },
  email: { value: "", validate: (v, vals) => ... },
  onSubmit: async (proxy, store) => { ... },
  afterSubmit: (result, { reset }) => { ... }
}
```

---

## 1. `executeEntityTemplateSubmit`

**Назначение:** Submit (отправка) данных entity через template (шаблон формы).
Вызывается из `EntityProjectionProxy.submit()`.

**Аргументы:**
- `entityId` — ID сущности в EntityRegistry
- `templateNode` — config-нода шаблона (содержит `validate`, `onSubmit`, `afterSubmit`)
- `entityProxy` — Proxy-объект entity, который передаётся в `onSubmit`

**Алгоритм:**

```
1. Найти entity в реестре по entityId
2. Установить submitting = true → уведомить подписчиков (React перерендерит кнопку)
3. Пройти по полям template и вызвать validate() для каждого leaf-поля
4. Если есть ошибки → вернуть { success: false, errors }
5. Вызвать templateNode.onSubmit(entityProxy, store) → получить result
6. Вызвать templateNode.afterSubmit(result, { reset })
7. Вернуть { success: true, result }
8. В finally: submitting = false → уведомить подписчиков
```

**Пример использования:**

```typescript
// Конфигурация entity template:
const userTemplate = {
  name:  { value: "", validate: (v) => !v ? "Имя обязательно" : undefined },
  email: { value: "", validate: (v) => !v ? "Email обязателен" : undefined },

  onSubmit: async (form, store) => {
    const response = await api.updateUser({
      name:  form.name.value,
      email: form.email.value,
    });
    return response;
  },

  afterSubmit: (result, { reset }) => {
    console.log("Сохранено:", result);
  },
};

// Где-то в React-компоненте через EntityProjectionProxy:
// proxy.submit() → внутри вызывает executeEntityTemplateSubmit(entityId, template, proxy)

// Результат при ошибках валидации:
// { success: false, errors: [{ path: "name", message: "Имя обязательно" }] }

// Результат при успешном submit:
// { success: true, result: { id: "u1", name: "Alice", email: "alice@example.com" } }
```

---

## 2. `_setEntitiesRaw`

**Назначение:** Upsert (создание/обновление) массива entity-объектов в реестре
и синхронизация их leaf-нод с NodeRegistry. **Не вызывает** recompute/notify —
это ответственность вызывающего кода.

**Возвращает:** `Set<object>` — множество изменённых leaf-нод.

**Алгоритм:**

```
Для каждого item из items:
  1. entityRegistry.upsert(item) → создаёт или обновляет EntityNode
  2. Получить entityId из entityNode.id.value
  3. Получить или создать projectionObj (POJO-зеркало entity в valuesCache)
  4. Рекурсивно обойти entity через walkAndSyncEntityNode →
     зарегистрировать новые листья или обнаружить изменения
```

**Пример:**

```typescript
// Входные данные:
const items = [
  { id: "u1", name: "Alice", age: 30 },
  { id: "u2", name: "Bob",   age: 25 },
];

// Вызов:
const changed = store._setEntitiesRaw(items);
// changed = Set([nameLeafU1, ageLeafU1, nameLeafU2, ageLeafU2])
//   (для новых entity — все leaf-ноды; для существующих — только изменённые)

// Внутреннее состояние после вызова:
// entityRegistry.entities: Map { "u1" → EntityNode, "u2" → EntityNode }
// entityProjectionObjs:    Map { "u1" → { id:"u1", name:"Alice", age:30 },
//                                "u2" → { id:"u2", name:"Bob",   age:25 } }

// Вызывающий код далее делает:
// const recomputed = this.recompute(changed);
// this.notifyChanged(recomputed);
```

---

## 3. `_syncListValuesCache`

**Назначение:** Обновить массив значений списка (`valuesCache.values[listKey]`)
по актуальному `listState.itemIds`. Вызывается после resolve списка, когда
`itemIds` изменились.

**Алгоритм:**

```
1. Найти nodeSlot для listNode → { parent, key }
2. Найти listState для listNode → { itemIds: ["u1", "u2", ...] }
3. Собрать массив projectionObj по itemIds
4. Записать новый массив в parent[key]
```

**Пример:**

```typescript
// Исходное состояние:
// listState.itemIds = ["u1", "u2"]
// entityProjectionObjs = Map {
//   "u1" → { id: "u1", name: "Alice" },
//   "u2" → { id: "u2", name: "Bob" }
// }

store._syncListValuesCache(usersListNode);

// Результат: valuesCache.values.users = [
//   { id: "u1", name: "Alice" },
//   { id: "u2", name: "Bob" }
// ]
// (ссылки на те же POJO-объекты, не копии)
```

---

## 4. `walkAndSyncEntityNode`

**Назначение:** Рекурсивный DFS-обход дерева entity-ноды. Для каждого
leaf-узла:
- **Новый leaf** — зарегистрировать в NodeRegistry (`registerDynamicLeaf`)
  и привязать к `projectionObj` через `nodeSlot`.
- **Существующий leaf с изменённым value** — обновить `nodeState.value`
  и `projectionObj` через `updateValuesCacheEntry`.

Для групповых узлов — рекурсивный вызов с вложенным `projectionObj`.

**Аргументы:**
| Параметр       | Описание |
|:---------------|:---------|
| `node`         | Текущий узел entity (EntityNode / EntityGroupNode) |
| `prefix`       | Dot-path, e.g. `"_entity_.u1"` или `"_entity_.u1.address"` |
| `parent`       | Ссылка на entity-объект (для `nodeParents` регистрации) |
| `changed`      | Accumulator: Set изменённых leaf-нод (мутируется) |
| `projectionObj`| POJO-зеркало текущего уровня вложенности |

**Пример:**

```typescript
// EntityNode:
// {
//   id:      { value: "u1" },
//   name:    { value: "Alice" },
//   address: {
//     city: { value: "Moscow" }
//   }
// }

// Вызванный с prefix = "_entity_.u1":
//
// Итерация 1: key = "id"
//   → leaf, новый → registerDynamicLeaf("_entity_.u1.id")
//   → projectionObj.id = "u1"
//
// Итерация 2: key = "name"
//   → leaf, новый → registerDynamicLeaf("_entity_.u1.name")
//   → projectionObj.name = "Alice"
//
// Итерация 3: key = "address"
//   → group → рекурсия с prefix = "_entity_.u1.address"
//   → projectionObj.address = {}
//     Итерация 3.1: key = "city"
//       → leaf, новый → registerDynamicLeaf("_entity_.u1.address.city")
//       → projectionObj.address.city = "Moscow"

// При повторном вызове (upsert):
// Если name.value изменился "Alice" → "Bob":
//   → existing leaf, state.value !== leaf.value
//   → state.value = "Bob", updateValuesCacheEntry → projectionObj.name = "Bob"
//   → changed.add(nameLeaf)
```

---

## 5. `collectEntityLeaves`

**Назначение:** Рекусивно собрать все leaf-ноды из дерева entity в `Set<object>`.
Используется в `delete()` для массового удаления leaf-нод из NodeRegistry.

**Пример:**

```typescript
// EntityNode: { id: { value: "u1" }, name: { value: "Alice" },
//               address: { city: { value: "Moscow" } } }

const leaves = new Set<object>();
this.collectEntityLeaves(entityNode, leaves);
// leaves = Set([id_leaf, name_leaf, city_leaf])

// Далее в delete():
for (const leaf of leaves) {
  this.nodes.unregisterLeaf(leaf);  // очистка из NodeRegistry
}
```

---

## 6. `collectEntityTemplateErrors`

**Назначение:** Рекурсивно собрать ошибки валидации для entity по правилам
из template. Обходит template-дерево, для каждого leaf-поля с `validate()`
вызывает валидатор с текущим значением entity.

**Аргументы:**
| Параметр       | Описание |
|:---------------|:---------|
| `templateNode` | Config-нода template (содержит `validate` функции) |
| `entityNode`   | Соответствующий узел из EntityRegistry |
| `errors`       | Accumulator: массив ошибок `{ path, message }` |
| `parentPath`   | Текущий dot-path для формирования пути ошибки |

**Алгоритм:**

```
1. Построить entityValues из entityNode (через buildEntityValuesForTemplate)
2. Для каждого ключа в templateNode (пропуская CONFIG_PROPS):
   a. Если leaf + есть validate → вызвать validate(currentValue, entityValues, translate)
      Если вернул строку — добавить в errors
   b. Если group → рекурсия в соответствующий entityNode[key]
```

**Пример:**

```typescript
// Template:
// {
//   name:  { value: "", validate: (v) => !v ? "Required" : undefined },
//   address: {
//     city: { value: "", validate: (v) => !v ? "City required" : undefined }
//   }
// }

// Entity:
// { name: { value: "" }, address: { city: { value: "Moscow" } } }

const errors: Array<{ path: string; message: string }> = [];
this.collectEntityTemplateErrors(template, entity, errors, "");

// Результат: errors = [{ path: "name", message: "Required" }]
// (city валидна → нет ошибки)
```

---

## 7. `buildEntityValuesForTemplate`

**Назначение:** Построить plain-объект со значениями entity для передачи
в валидаторы. Рекурсивно читает `nodeState.value` для каждого leaf, fallback
на `field.value`.

**Пример:**

```typescript
// EntityNode:
// { id: { value: "u1" }, name: { value: "Alice" },
//   address: { city: { value: "Moscow" } } }
//
// nodeState Map:
// id_leaf   → { value: "u1" }
// name_leaf → { value: "Alice" }
// city_leaf → { value: "Moscow" }

const vals = this.buildEntityValuesForTemplate(entityNode);
// vals = {
//   id: "u1",
//   name: "Alice",
//   address: { city: "Moscow" }
// }
// Этот объект передаётся вторым аргументом в validate(currentValue, vals, translate)
```

---

---

## Вопрос 1: Тотальный ли обход при submit?

**Короткий ответ:** Нет, submit entity **сфокусирован**, но есть один узкий момент в `notifyChanged`.

**Что происходит при `executeEntityTemplateSubmit`:**

| Шаг | Что обходится | Scope |
|:----|:-------------|:------|
| `collectEntityTemplateErrors` | Поля `templateNode` (не весь rootConfig!) | **Scoped** — только поля шаблона |
| `buildEntityValuesForTemplate` | Поля `entityNode` (одна entity) | **Scoped** — одна entity |
| `notifyChanged(Set([entityNodeObj]))` | `recomputeDirty(rootConfig, ...)` внутри hub | **FULL TREE** |

Валидация (`collectEntityTemplateErrors`) ходит **только по templateNode** — если
у тебя template с 3 полями, обойдутся только 3 поля, а не все 500 полей в store.

`notifyChanged` — подписчики уведомляются **только для changed-нод** (O(changed)).
Но внутри `hub.notifyChanged` вызывается `recomputeDirty(rootConfig, ...)` который
**обходит полный rootConfig** для пересчёта dirty-флагов. Это потенциальное место
для оптимизации.

**Узкое место:** `recomputeDirty` — полный обход rootConfig при **каждом** notify.
Для entity submit он вызывается **дважды** (submitting=true и submitting=false).

**Возможная оптимизация:** сделать targeted `recomputeDirty`, который проходит
только по affected-группам (аналогично `recomputeTargeted` для compute).

---

## Вопрос 2: Тотальный ли обход при установке данных (set)?

**Короткий ответ:** Нет, `set()` в основном сфокусирован — но тот же `recomputeDirty`.

**Что происходит при `store.set(data)`:**

| Шаг | Что обходится | Scope |
|:----|:-------------|:------|
| `entityRegistry.upsert(item)` | Поля entity data (один объект) | **Scoped** |
| `walkAndSyncEntityNode` | Дерево EntityNode (одна entity) | **Scoped** — только эта entity |
| `recompute(changed)` | BFS по dependency graph → affected groups | **Targeted** — O(affected groups) |
| `notifyChanged(recomputed)` | `recomputeDirty(rootConfig, ...)` внутри | **FULL TREE** |

Основная работа (`_setEntitiesRaw` + `walkAndSyncEntityNode`) — O(entity fields).
`recompute(changed)` — targeted через BFS по graphDeps, НЕ полный обход.

Единственный полный обход — опять `recomputeDirty(rootConfig)` внутри `notifyChanged`.

**Вывод:** Оба пути (submit и set) хорошо оптимизированы **кроме** `recomputeDirty`.

---

## Вопрос 3: Нужен ли отдельный абстрактный сервис обхода?

### Текущая ситуация

В кодовой базе обнаружено **~28 независимых реализаций обхода дерева** в 15+ файлах.
Все следуют одному паттерну:

```typescript
for (const key of Object.keys(node)) {
  if (CONFIG_PROPS.has(key)) continue;
  const child = node[key];
  if (!child || typeof child !== "object") continue;
  if ("value" in child) {
    // лист: выполнить действие
  } else {
    // группа: рекурсия
  }
}
```

**Места с обходом дерева:**

| Модуль | Функции | Полный / Scoped |
|:-------|:--------|:----------------|
| `dirtyTracking/` | `recomputeDirty`, `captureInitialValues`, `collectInitialSnapshot`, `mergeInitialValues`, `setGroupRevalidate` | Полный (rootConfig) |
| `compute/recompute/` | `collectGroupLeafNodes`, `recomputeTargeted` (BFS по графу), `recomputeLeaves` | Scoped (affected groups) |
| `palistor.ts` | `walkAndSyncEntityNode`, `collectEntityLeaves`, `collectEntityTemplateErrors`, `buildEntityValuesForTemplate` | Scoped (entity/template) |
| `writePipeline/` | `formatPatch` | Scoped (patch) |
| `resetPipeline/` | `collectDefaults`, `buildResetPatch` | Полный (rootConfig) |
| `submitPipeline/` | `collectLeafStates` | Полный (rootConfig) |
| `valuesCache/` | `buildValuesCache` | Полный (init only) |
| `NodeRegistry/` | `registerNodes` | Полный (init only) |
| `entityRegistry/` | `createEntityNode`, `mergeEntityNode` | Scoped (entity data) |

### Мнение по идее «TraversalService»

**Идея:** сервис принимает store, точку изменений, маппинг связей и action.

Это **имеет смысл**, но с нюансами:

**За:**
- 60% обходов дублируют один и тот же boilerplate (Object.keys + CONFIG_PROPS + leaf/group)
- Единая точка входа для фильтрации (CONFIG_PROPS, массивы, null-проверки)
- Легче тестировать инварианты обхода
- Будущие оптимизации (кеширование пройденных узлов, батчинг) внедряются в одном месте

**Против:**
- У каждого обхода **разные stopping criteria** (reset boundaries, leaf-only, template-only)
- **Разные стратегии аккумуляции** (WeakMap, Set, Array, мутация на месте)
- Некоторые обходы **performance-critical** — абстракция добавляет overhead от замыканий
- Полные обходы делаются **только при init/reset** — runtime-обходы уже targeted

**Рекомендуемый подход:** не один монолитный сервис, а **слоёная архитектура**:

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: Actions (конкретные операции)              │
│  recomputeDirty, collectDefaults, walkAndSync, etc.  │
├─────────────────────────────────────────────────────┤
│  Layer 2: Traversal Strategy                         │
│  walkScoped(changedNodes, depsGraph, visitor)         │  ← НОВОЕ
│  walkFull(rootConfig, visitor)                        │
├─────────────────────────────────────────────────────┤
│  Layer 1: Node Classifier                            │
│  isLeaf(node), isGroup(node), isArray(node)          │  ← НОВОЕ
│  filterConfigKeys(Object.keys(node))                 │
└─────────────────────────────────────────────────────┘
```

**Layer 1 — Node Classifier** (минимальный, можно внедрить сразу):
```typescript
// store/traversal/nodeClassifier.ts
export function isLeaf(node: unknown): node is { value: unknown } {
  return node !== null && typeof node === "object" && "value" in node;
}
export function configKeys(node: Record<string, unknown>): string[] {
  return Object.keys(node).filter(k => !CONFIG_PROPS.has(k));
}
```

**Layer 2 — Traversal Strategy** (visitor-паттерн):
```typescript
// store/traversal/walkScoped.ts
export interface TreeVisitor<TAccum> {
  onLeaf(node: object, path: string, parent: object, accum: TAccum): void;
  onGroup?(node: object, path: string, parent: object, accum: TAccum): boolean; // false = skip subtree
}

export function walkScoped<TAccum>(
  changedNodes: Set<object>,
  depsGraph: Set<string>,
  rootConfig: AnyConfigNode,
  visitor: TreeVisitor<TAccum>,
  accum: TAccum,
): void { ... }

export function walkFull<TAccum>(
  node: AnyConfigNode,
  visitor: TreeVisitor<TAccum>,
  accum: TAccum,
  path?: string,
): void { ... }
```

### План оптимизации (приоритет)

| # | Задача | Эффект | Сложность |
|:--|:-------|:-------|:----------|
| 1 | **Targeted `recomputeDirty`** — пересчитывать dirty только для affected-групп (как `recomputeTargeted`) | Высокий: убирает полный обход при каждом notify (самый горячий path) | Средняя |
| 2 | **Node Classifier** — выделить `isLeaf`, `configKeys` в отдельный модуль | Средний: убирает дублирование, уменьшает ошибки | Лёгкая |
| 3 | **`walkFull` visitor** — унифицировать init-обходы (buildValuesCache, captureInitialValues, registerNodes) | Средний: -40% boilerplate в init-фазе | Средняя |
| 4 | **`walkScoped` visitor** — унифицировать runtime-обходы через dependency graph | Низкий (уже оптимизировано через recomputeTargeted) | Высокая |

**Приоритет #1 — targeted `recomputeDirty`** — даст наибольший performance-эффект,
потому что `recomputeDirty` вызывается при **каждом** notifyChanged, а сейчас это
единственный полный обход на рантайме.

---

## Схема вызовов

```
proxy.submit()
  └─ executeEntityTemplateSubmit(entityId, templateNode, entityProxy)
       ├─ collectEntityTemplateErrors(templateNode, entityNode, errors, "")
       │    └─ buildEntityValuesForTemplate(entityNode)
       ├─ templateNode.onSubmit(entityProxy, store)
       └─ templateNode.afterSubmit(result, { reset })

store.set(data)
  └─ _setEntitiesRaw(items)
       └─ walkAndSyncEntityNode(entityNode, prefix, parent, changed, projectionObj)
            └─ (рекурсия по вложенным группам)
     → recompute(changed)
     → notifyChanged(recomputed)

resolveManager → executeListResolve
  └─ _setEntitiesRaw(items)      // upsert полученных entity
  └─ _syncListValuesCache(listNode) // обновить массив в valuesCache

store.delete(id)
  └─ collectEntityLeaves(entityNode, deletedLeaves)
  └─ nodes.unregisterLeaf(leaf)   // для каждого leaf
  └─ entityRegistry.delete(id)
  └─ notifyChanged(deletedLeaves)
```
