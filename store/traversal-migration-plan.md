# Миграция обхода узлов — слоёная архитектура

## План для Claude Sonnet 4.6 (пошаговые итерации)

> **Принцип:** каждая итерация — одна атомарная, полностью завершённая задача
> с тестами. Sonnet 4.6 работает лучше всего с конкретными, ограниченными
> задачами, где чётко описан INPUT → OUTPUT и есть существующий код для
> сверки. Не давай абстрактных целей — давай файлы, строки, сигнатуры.

---

## Обзор целевой архитектуры

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: Actions (конкретные операции)              │
│  recomputeDirty, collectDefaults, walkAndSync, etc.  │
├─────────────────────────────────────────────────────┤
│  Layer 2: walkFull(node, visitor, accum, path?)      │
│  Универсальный обход дерева с visitor-паттерном      │
├─────────────────────────────────────────────────────┤
│  Layer 1: Node Classifier                            │
│  isLeaf(), isGroup(), isArray(), configKeys()        │
└─────────────────────────────────────────────────────┘
```

---

## Карта текущих обходов (28 реализаций)

| # | Функция | Файл | Тип | Аккумулятор | Особенности |
|:--|:--------|:-----|:----|:------------|:------------|
| 1 | `recomputeDirty` | `dirtyTracking/recomputeDirty.ts:31-80` | Full | `Set<object>` + `anyDirty: boolean` | ListNode → arraysEqual; Group → dirty = any child dirty |
| 2 | `captureInitialValues` | `dirtyTracking/captureInitialValues.ts:10-31` | Full | `WeakMap` мутация | Пропускает ListNode |
| 3 | `collectInitialSnapshot` | `dirtyTracking/collectInitialSnapshot.ts:12-38` | Full | `Record<string, unknown>` | Стоп на `reset` boundary; fallback на config default |
| 4 | `mergeInitialValues` | `dirtyTracking/mergeInitialValues.ts:12-33` | Scoped (patch keys) | `WeakMap` мутация | Ходит только по ключам patch |
| 5 | `setGroupRevalidate` | `dirtyTracking/setGroupRevalidate.ts:40-77` | Full subtree | `Set<object>` | Обновляет и сам узел, и всех потомков |
| 6 | `buildValuesCache` | `valuesCache/valuesCache.ts:28-56` | Full | `Record + WeakMap(nodeSlot)` | Регистрирует slot для O(1) update; ListNode → empty array |
| 7 | `collectDefaults` | `resetPipeline/collectDefaults.ts:14-30` | Full | `Record<string, unknown>` | Стоп на `reset` boundary; computed → `""` |
| 8 | `collectLeafStates` | `submitPipeline/collectLeafStates.ts:10-31` | Full | `Array<{path, state}>` | Для submit-валидации |
| 9 | `formatPatch` | `writePipeline/formatPatch.ts:17-36` | Scoped (patch keys) | `Record<string, unknown>` | Параллельный обход config + patch |
| 10 | `applyPatch` | `applyPatch/applyPatch.ts:20-50` | Scoped (patch keys) | `Set<object>` | Параллельный обход config + patch + valuesCache |
| 11 | `collectGroupLeafNodes` | `compute/recompute/collectGroupLeafNodes.ts:12-31` | Scoped (group) | `LeafEntry[]` | Использует `groupLeafMap` |
| 12 | `initGroupSubmitting` | `init/initGroupSubmitting.ts:14-48` | Full | `nodeState` мутация | Init-only |
| 13 | `createGroupDeps` | `groupDeps/createGroupDeps.ts:17-33` | Full | `Set<string>` | Init-only |
| 14 | `walkAndSyncEntityNode` | `store/palistor.ts:665-750` | Scoped (entity) | `Set + projectionObj` мутация | Dynamic leaf registration |
| 15 | `collectEntityLeaves` | `store/palistor.ts:753-770` | Scoped (entity) | `Set<object>` | Для delete |
| 16 | `collectEntityTemplateErrors` | `store/palistor.ts:777-838` | Scoped (template) | `Array<{path, message}>` | Ходит по template, читает entity |
| 17 | `buildEntityValuesForTemplate` | `store/palistor.ts:849-870` | Scoped (entity) | `Record<string, unknown>` | Плоский объект значений |
| 18 | `registerNodes` | `store/registerNodes.ts:77-150` | Full | `WeakMaps + Arrays` | Самый сложный — не мигрировать первым |

---

## Итерация 1: Layer 1 — Node Classifier

### Цель
Создать `store/traversal/nodeClassifier.ts` с 4 функциями + тесты.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: создать модуль store/traversal/nodeClassifier.ts

В кодовой базе ~28 функций обхода дерева. Все они повторяют один и тот же
паттерн классификации узлов. Нужно выделить этот паттерн в отдельный модуль.

Текущий паттерн (повторяется везде):
```typescript
for (const key of Object.keys(node)) {
  if (CONFIG_PROPS.has(key)) continue;
  const child = node[key];
  if (!child || typeof child !== "object") continue;
  if (Array.isArray(child)) { /* list */ continue; }
  if ("value" in child) { /* leaf */ }
  else { /* group — рекурсия */ }
}
```

CONFIG_PROPS определён в store/constants.ts — это Set строк со служебными
ключами конфига (value, label, validate, formatter, setter, ...).

Что создать:

1. Файл store/traversal/nodeClassifier.ts:

```typescript
import { CONFIG_PROPS } from "../constants";

/** Leaf node — объект с полем "value" */
export function isLeaf(node: object): node is { value: unknown } {
  return "value" in node;
}

/** Group node — объект БЕЗ "value", содержит дочерние узлы */
export function isGroup(node: object): boolean {
  return !Array.isArray(node) && !("value" in node);
}

/** List node — массив (entity-списки хранятся как Array) */
export function isListNode(node: unknown): node is unknown[] {
  return Array.isArray(node);
}

/**
 * Вернуть ключи узла, отфильтровав служебные CONFIG_PROPS.
 * Это заменяет повторяющийся паттерн:
 *   for (const key of Object.keys(node)) {
 *     if (CONFIG_PROPS.has(key)) continue;
 *     ...
 *   }
 */
export function configKeys(node: Record<string, unknown>): string[] {
  return Object.keys(node).filter(k => !CONFIG_PROPS.has(k));
}
```

ВАЖНО: в store/store/NodeRegistry/ уже есть nodeUtils.ts с похожими функциями
(isLeaf, isGroup, isListNode). Посмотри его содержимое и убедись что новые
функции совместимы (те же условия). Новый модуль — каноничная реализация,
старые можно будет заменить позже.

2. Файл store/traversal/nodeClassifier.test.ts — тесты vitest:
- isLeaf: true для { value: "x" }, true для { value: "", label: "Name" },
  false для {}, false для { city: { value: "" } }
- isGroup: true для { city: { value: "" } }, false для { value: "x" },
  false для [] (Array)
- isListNode: true для [], true для [1,2,3], false для {}, false для null
- configKeys: отфильтровывает все ключи из CONFIG_PROPS, оставляет
  пользовательские. Тест: { value: "", label: "Name", validate: fn,
  city: { value: "" }, street: { value: "" } } → ["city", "street"]

3. Файл store/traversal/index.ts — реэкспорт:
```typescript
export { isLeaf, isGroup, isListNode, configKeys } from "./nodeClassifier";
```

НЕ ТРОГАЙ существующие файлы. Только создай 3 новых файла.
Запусти тесты и убедись что они проходят.
```

### Критерий завершения
- 3 файла созданы
- Тесты проходят
- Существующий код не сломан

---

## Итерация 2: Layer 2 — walkFull

### Цель
Создать `store/traversal/walkFull.ts` — универсальный обход полного дерева
с visitor-паттерном.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: создать store/traversal/walkFull.ts — универсальный обход дерева конфига.

Контекст: мы делаем слоёную архитектуру обхода. Layer 1 (nodeClassifier) уже
создан в store/traversal/nodeClassifier.ts — там есть isLeaf, isGroup,
isListNode, configKeys.

Сейчас нужен Layer 2: walkFull — обход полного дерева с visitor-паттерном.
Это заменит boilerplate из ~15 функций, которые все делают одно и то же:
Object.keys → CONFIG_PROPS check → leaf/group/list classification → рекурсия.

Посмотри следующие файлы чтобы понять текущие паттерны обхода:
- store/dirtyTracking/captureInitialValues.ts (простейший: leaf → WeakMap.set)
- store/dirtyTracking/collectInitialSnapshot.ts (leaf → result[key], stop at reset boundary)
- store/resetPipeline/collectDefaults.ts (leaf → result[key], skip ListNode, stop at reset)
- store/submitPipeline/collectLeafStates.ts (leaf → push {path, state})
- store/valuesCache/valuesCache.ts (leaf → target[key] + nodeSlot; group → рекурсия с nested object)

Что создать:

1. Файл store/traversal/walkFull.ts:

```typescript
import { configKeys, isLeaf, isListNode } from "./nodeClassifier";
import type { AnyConfigNode } from "../store/types";

export interface TreeVisitor {
  /**
   * Вызывается для каждого leaf-узла ({ value: ... }).
   * @param node — config-узел (ref на объект, можно использовать как ключ WeakMap)
   * @param key — имя ключа в родителе (например "city")
   * @param path — полный dot-path (например "address.city")
   * @param parent — родительский config-узел
   */
  onLeaf(node: object, key: string, path: string, parent: AnyConfigNode): void;

  /**
   * Вызывается для group-узла ПЕРЕД входом в рекурсию.
   * Верни false чтобы пропустить поддерево (например reset boundary).
   * Если не определён — всегда входит.
   */
  onGroupEnter?(node: AnyConfigNode, key: string, path: string, parent: AnyConfigNode): boolean | void;

  /**
   * Вызывается для group-узла ПОСЛЕ обхода всех его потомков.
   * Опционально — для агрегации (например dirty = any child dirty).
   */
  onGroupExit?(node: AnyConfigNode, key: string, path: string, parent: AnyConfigNode): void;

  /**
   * Вызывается для list-узла (Array).
   * Если не определён — list пропускается.
   */
  onList?(node: unknown[], key: string, path: string, parent: AnyConfigNode): void;
}

/**
 * Обход полного дерева конфигурации с visitor-callback'ами.
 * Заменяет повторяющийся паттерн Object.keys + CONFIG_PROPS + leaf/group/list.
 */
export function walkFull(
  node: AnyConfigNode,
  visitor: TreeVisitor,
  parentPath = "",
): void {
  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key];
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if (isListNode(child)) {
      visitor.onList?.(child, key, path, node);
      continue;
    }

    if (isLeaf(child)) {
      visitor.onLeaf(child, key, path, node);
    } else {
      const enter = visitor.onGroupEnter?.(child as AnyConfigNode, key, path, node);
      if (enter === false) continue;
      walkFull(child as AnyConfigNode, visitor, path);
      visitor.onGroupExit?.(child as AnyConfigNode, key, path, node);
    }
  }
}
```

2. Файл store/traversal/walkFull.test.ts — тесты vitest:

Создай тестовый конфиг:
```typescript
const config = {
  name: { value: "", label: "Name", validate: () => undefined },
  email: { value: "" },
  address: {
    city: { value: "Moscow" },
    street: { value: "Tverskaya" },
    nested: {
      zip: { value: "101000" },
    },
  },
  users: [{ template: {} }], // ListNode
  onSubmit: async () => {},   // CONFIG_PROP — должен быть пропущен
};
```

Тесты:
a) "collects all leaf paths" — onLeaf собирает path → ожидай
   ["name", "email", "address.city", "address.street", "address.nested.zip"]
b) "calls onGroupEnter/onGroupExit for groups" — onGroupEnter вызывается
   для "address" и "address.nested", onGroupExit тоже
c) "onGroupEnter returning false skips subtree" — если onGroupEnter
   для "address" вернул false → ни city, ни street, ни nested не посещены
d) "calls onList for array nodes" — onList вызывается для "users"
e) "skips CONFIG_PROPS" — onSubmit не вызывает ни один callback
f) "skips null and primitives" — если добавить configNode.__memo = null,
   configNode.count = 42 → ничего не ломается

3. Обнови store/traversal/index.ts — добавь реэкспорт walkFull и TreeVisitor.

НЕ ТРОГАЙ существующие файлы. Только создай новые + обнови index.ts.
Запусти тесты.
```

### Критерий завершения
- walkFull.ts + walkFull.test.ts созданы
- Все тесты проходят
- index.ts обновлён

---

## Итерация 3: Миграция captureInitialValues на walkFull

### Цель
Первая миграция реального кода. Выбрана `captureInitialValues` — самая
простая функция (10 строк логики, только onLeaf, без особой логики).

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: переписать captureInitialValues с использованием walkFull.

Контекст: мы создали store/traversal/walkFull.ts — универсальный обход
дерева config. Теперь мигрируем существующие функции обхода на него.

Первая миграция — store/dirtyTracking/captureInitialValues.ts.

Текущий код (прочитай файл):
- Обход Object.keys → CONFIG_PROPS → leaf/group
- Leaf: initialValueMap.set(child, state.value)
- Group: рекурсия
- Пропускает Array (ListNode)

Новый код должен использовать walkFull:

```typescript
import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

export function captureInitialValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
): void {
  walkFull(node, {
    onLeaf(leaf) {
      const state = nodeState.get(leaf);
      if (state) {
        initialValueMap.set(leaf, state.value);
      }
    },
  });
}
```

Сигнатура функции НЕ МЕНЯЕТСЯ. Внутренняя реализация упрощается.

Шаги:
1. Прочитай текущий captureInitialValues.ts
2. Прочитай тест dirtyTracking/dirtyTracking.test.ts — найди тесты
   связанные с captureInitialValues или initialValues
3. Замени реализацию
4. Запусти ВСЕ тесты: npx vitest run
5. Убедись что ничего не сломалось

ВАЖНО: walkFull уже пропускает Array (ListNode) по умолчанию (onList
не определён → skip). Это совпадает с текущим поведением.

ВАЖНО: если тесты не проходят — НЕ МЕНЯЙ walkFull. Вместо этого
разберись, что captureInitialValues делает по-другому, и адаптируй
visitor callbacks.
```

### Критерий завершения
- captureInitialValues использует walkFull
- Все существующие тесты проходят
- Никакие другие файлы не изменены (кроме самого captureInitialValues.ts)

---

## Итерация 4: Миграция collectDefaults и collectInitialSnapshot

### Цель
Мигрировать 2 функции, которые имеют **reset boundary** (останавливаются
на `child.reset`). Это валидирует что visitor.onGroupEnter с return false
работает для реального use-case.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: переписать collectDefaults и collectInitialSnapshot на walkFull.

Контекст: мы мигрируем обходы дерева на walkFull (store/traversal/walkFull.ts).
captureInitialValues уже успешно мигрирован.

Теперь мигрируем две функции с одинаковой особенностью — они останавливаются
на reset boundary (группы с собственным child.reset).

--- Файл 1: store/resetPipeline/collectDefaults.ts ---

Прочитай текущий код. Ключевые особенности:
- Leaf: result[key] = raw value (или "" если function/computed)
- Group: рекурсия, НО skip если typeof child.reset === "function"
- ListNode: пропускается

Новая реализация должна использовать walkFull, но есть нюанс:
collectDefaults строит ВЛОЖЕННЫЙ объект (result[key] = collectDefaults(child)).
walkFull — плоский обход, он не строит вложенный результат автоматически.

Варианты решения:
A) Использовать stack внутри visitor для отслеживания текущего уровня вложенности
B) Оставить рекурсию, но заменить только классификацию узлов через configKeys/isLeaf
C) Не мигрировать на walkFull — использовать только Layer 1 (configKeys, isLeaf)

Выбери вариант B или C — они проще и надёжнее. walkFull лучше подходит для
плоских операций (WeakMap, Set). Для построения вложенных объектов — Layer 1
достаточен.

Если выбрал B, новый код будет примерно таким:
```typescript
import { configKeys, isLeaf, isListNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";

export function collectDefaults(node: AnyConfigNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    if (isListNode(child)) continue;

    if (isLeaf(child)) {
      const raw = child.value;
      result[key] = typeof raw === "function" ? "" : raw;
    } else {
      if (typeof child.reset === "function") continue;
      result[key] = collectDefaults(child);
    }
  }

  return result;
}
```

--- Файл 2: store/dirtyTracking/collectInitialSnapshot.ts ---

Аналогичная структура: leaf → result[key], group → рекурсия (skip reset boundary).
Мигрируй так же — через Layer 1 (configKeys, isLeaf, isListNode).

Шаги:
1. Прочитай оба текущих файла
2. Замени реализацию, используя configKeys/isLeaf/isListNode из traversal
3. Прочитай существующие тесты для этих функций
4. Запусти все тесты: npx vitest run
5. Убедись что тесты проходят

ВАЖНО: сигнатуры функций НЕ МЕНЯЮТСЯ. Только внутренний import и 
замена ручной фильтрации на configKeys/isLeaf.
```

### Критерий завершения
- Обе функции используют Layer 1 (configKeys, isLeaf, isListNode)
- Все тесты проходят
- Удалены прямые импорты CONFIG_PROPS из этих файлов

---

## Итерация 5: Миграция collectLeafStates и setGroupRevalidate

### Цель
Продолжить миграцию. `collectLeafStates` строит вложенный массив (path),
`setGroupRevalidate` — плоская операция Set. Первый → Layer 1, второй →
можно на walkFull.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: мигрировать collectLeafStates и setGroupRevalidate на traversal utilities.

--- Файл 1: store/submitPipeline/collectLeafStates.ts ---

Прочитай текущий код. Он собирает [{path, state}] для submit-валидации.
Используй walkFull:

```typescript
import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

export function collectLeafStates(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
): Array<{ path: string; state: FieldState }> {
  const result: Array<{ path: string; state: FieldState }> = [];

  walkFull(node, {
    onLeaf(leaf, _key, path) {
      const state = nodeState.get(leaf);
      if (state) result.push({ path, state });
    },
  }, parentPath);

  return result;
}
```

--- Файл 2: store/dirtyTracking/setGroupRevalidate.ts ---

Прочитай текущий код. Особенность: обновляет И сам node (до обхода потомков),
И все потомки рекурсивно. Это НЕ подходит для walkFull напрямую, потому
что walkFull не обновляет корневой node — он обходит только children.

Используй Layer 1 (configKeys, isLeaf) и оставь собственную рекурсию.
Замени только `for (const key of Object.keys(node)) { if (CONFIG_PROPS...) }`
на `for (const key of configKeys(node))`.

Шаги:
1. Прочитай оба файла
2. Прочитай тесты для dirtyTracking и submitPipeline
3. Мигрируй
4. Запусти все тесты: npx vitest run
```

### Критерий завершения
- collectLeafStates использует walkFull
- setGroupRevalidate использует configKeys/isLeaf из traversal
- Все тесты проходят

---

## Итерация 6: Миграция buildValuesCache

### Цель
Мигрировать начальное построение кеша значений. Важный файл — используется
при инициализации store.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: мигрировать buildValuesCache на Layer 1 (configKeys, isLeaf, isListNode).

Файл: store/valuesCache/valuesCache.ts, функция buildValuesCache (строки 28-56).

Прочитай текущий код. Особенности:
- Строит ВЛОЖЕННЫЙ объект values + WeakMap nodeSlot
- Для leaf: target[key] = state.value, nodeSlot.set(child, {parent: target, key})
- Для group: создаёт nested object, рекурсия с новым target
- Для ListNode: target[key] = [], nodeSlot.set(child, {parent: target, key})

Это строит вложенную структуру → walkFull не подходит (нужен стек контекста).
Используй Layer 1: замени Object.keys + CONFIG_PROPS на configKeys, 
замени "value" in child на isLeaf, Array.isArray → isListNode.

НЕ МЕНЯЙ сигнатуру функции и тип ValuesCache.
НЕ ТРОГАЙ другие функции в этом файле (updateValuesCacheEntry и т.д.).

Шаги:
1. Прочитай весь файл store/valuesCache/valuesCache.ts
2. Замени только внутреннюю реализацию walk()
3. Запусти все тесты: npx vitest run
```

### Критерий завершения
- buildValuesCache использует configKeys/isLeaf/isListNode
- Все тесты проходят

---

## Итерация 7: Миграция formatPatch, applyPatch, mergeInitialValues

### Цель
Три функции с **параллельным обходом** (config + patch). Все итерируют
по ключам patch, а не config. Мигрируются на Layer 1 только.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: мигрировать 3 функции обхода дерева на Layer 1 (isLeaf из traversal).

Все три функции итерируют по ключам patch (не config), поэтому configKeys()
не подходит — у patch нет CONFIG_PROPS. Но классификация узлов config
(isLeaf/isListNode) — подходит.

--- Файл 1: store/writePipeline/formatPatch.ts ---
Замени `"value" in child` → `isLeaf(child)`.
Сохрани фильтрацию CONFIG_PROPS.has(key) для ключей patch (это корректно —
patch может содержать value/label по ошибке, фильтрация защищает).

--- Файл 2: store/applyPatch/applyPatch.ts ---
Замени `"value" in child` → `isLeaf(child)`.
Замени `Array.isArray(child)` → `isListNode(child)`.
Сохрани CONFIG_PROPS.has(key).

--- Файл 3: store/dirtyTracking/mergeInitialValues.ts ---
Замени `"value" in child` → `isLeaf(child)`.
Сохрани CONFIG_PROPS.has(key).

ВАЖНО: эти файлы итерируют по Object.keys(patch), а configKeys() фильтрует
Object.keys(node). Тут нужны оба: patch ключи + CONFIG_PROPS guard. Поэтому
configKeys() тут НЕ используется — только isLeaf/isListNode.

Шаги:
1. Прочитай все три файла
2. Добавь import { isLeaf } from "../traversal" (или isListNode где нужно)
3. Замени проверки
4. Запусти тесты:
   - npx vitest run store/writePipeline/formatPatch.test.ts
   - npx vitest run store/applyPatch/applyPatch.test.ts
   - npx vitest run store/dirtyTracking/dirtyTracking.test.ts
5. Запусти все тесты: npx vitest run
```

### Критерий завершения
- Все три функции используют isLeaf из traversal
- Все тесты проходят

---

## Итерация 8: Миграция recomputeDirty

### Цель
Мигрировать самую важную runtime-функцию на Layer 1. Это НЕ оптимизация
targeted recompute (это отдельная задача) — просто унификация кода.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: мигрировать recomputeDirty на Layer 1 (configKeys, isLeaf, isListNode).

Файл: store/dirtyTracking/recomputeDirty.ts

Прочитай текущий код. Особенности:
- Leaf: dirty = isDirtyValue(state.value, initial)
- Group: рекурсия, dirty = any child dirty
- ListNode: dirty = !arraysEqual(itemIds, initialItemIds)
- Возвращает { anyDirty, changed } — агрегация через рекурсию

Это НЕ подходит для walkFull из-за:
- Group dirty зависит от результата рекурсии (anyDirty пузырится вверх)
- Нужен onGroupExit с доступом к результату дочерних обходов

Используй только Layer 1: configKeys, isLeaf, isListNode.

Замени:
- `for (const key of Object.keys(node)) { if (CONFIG_PROPS.has(key)) continue;`
  → `for (const key of configKeys(node as Record<string, unknown>))`
- `Array.isArray(child)` → `isListNode(child)`
- `"value" in child` → `isLeaf(child)`

НЕ МЕНЯЙ логику. НЕ МЕНЯЙ сигнатуру. Только замени классификацию.

Шаги:
1. Прочитай текущий recomputeDirty.ts
2. Прочитай dirtyTracking.test.ts — найди тесты recomputeDirty
3. Сделай замены
4. Запусти тесты: npx vitest run store/dirtyTracking/
5. Запусти все тесты: npx vitest run
```

### Критерий завершения
- recomputeDirty использует configKeys/isLeaf/isListNode из traversal
- Все тесты проходят
- Логика идентична

---

## Итерация 9: Миграция entity-методов в palistor.ts

### Цель
Мигрировать 4 entity-метода на Layer 1. Они в одном файле palistor.ts.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: мигрировать entity-методы обхода дерева в store/store/palistor.ts
на Layer 1 (isLeaf из traversal).

В palistor.ts есть 4 метода с обходом дерева:
1. walkAndSyncEntityNode (строки ~665-750) — обход entity node
2. collectEntityLeaves (строки ~753-770) — сбор leaf-нод для delete
3. collectEntityTemplateErrors (строки ~777-838) — валидация по template
4. buildEntityValuesForTemplate (строки ~849-870) — plain values object

Все используют паттерн `"value" in child` для классификации.
Entity-ноды НЕ используют CONFIG_PROPS — у них нет служебных ключей.
Поэтому configKeys() тут НЕ нужен. Только isLeaf().

Для каждого метода:
- Добавь import { isLeaf } from "../traversal" (один раз в начале файла)
- Замени `"value" in child` → `isLeaf(child as object)` (или аналогичная проверка)
- НЕ МЕНЯЙ логику

Внимание: palistor.ts — большой файл, класс с множеством методов.
Меняй ТОЛЬКО указанные 4 метода. Не трогай остальное.

Шаги:
1. Прочитай palistor.ts — найди все 4 метода
2. Сделай замены
3. Запусти тесты: npx vitest run store/entityRegistry/
4. Запусти все тесты: npx vitest run
```

### Критерий завершения
- 4 entity-метода используют isLeaf из traversal
- Все тесты проходят

---

## Итерация 10: Миграция initGroupSubmitting и createGroupDeps

### Цель
Мигрировать оставшиеся init-only функции.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: мигрировать initGroupSubmitting и createGroupDeps на Layer 1.

--- Файл 1: store/init/initGroupSubmitting.ts ---
Прочитай файл. Замени Object.keys + CONFIG_PROPS → configKeys,
"value" in child → isLeaf.

--- Файл 2: store/groupDeps/createGroupDeps.ts ---
Прочитай файл. Замени Object.keys + CONFIG_PROPS → configKeys,
"value" in child → isLeaf.

Шаги:
1. Прочитай оба файла
2. Мигрируй
3. Запусти все тесты: npx vitest run
```

### Критерий завершения
- Обе функции используют configKeys/isLeaf
- Все тесты проходят

---

## Итерация 11: Удаление дублирующего nodeUtils.ts

### Цель
В `store/store/NodeRegistry/nodeUtils.ts` есть старые isLeaf/isGroup/isListNode.
Заменить все импорты на traversal/nodeClassifier.

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: заменить store/store/NodeRegistry/nodeUtils.ts на реэкспорт
из store/traversal/nodeClassifier.ts.

Шаги:
1. Прочитай store/store/NodeRegistry/nodeUtils.ts
2. Найди все файлы, которые импортируют из nodeUtils.ts:
   grep -r "nodeUtils" store/ --include="*.ts"
3. Для каждого файла замени импорт:
   - Было: import { isLeaf } from "../NodeRegistry/nodeUtils"
   - Стало: import { isLeaf } from "../../traversal"
   (или соответствующий путь)
4. Замени nodeUtils.ts на реэкспорт:
   export { isLeaf, isGroup, isListNode } from "../../traversal/nodeClassifier";
   (или удали файл, если все импорты обновлены)
5. Запусти все тесты: npx vitest run

ВАЖНО: убедись что функции совместимы (те же условия проверки).
Если есть расхождения — НЕ удаляй, а сообщи о несовместимости.
```

### Критерий завершения
- nodeUtils.ts удалён или стал реэкспортом
- Все файлы импортируют из traversal
- Все тесты проходят

---

## Итерация 12: Верификация и очистка

### Цель
Финальная проверка: все обходы мигрированы, не осталось прямых `CONFIG_PROPS`
импортов в мигрированных файлах (кроме traversal/nodeClassifier).

### Промпт для Sonnet 4.6

```
Проект: /home/yura/palirent/modules/palistor

Задача: верификация миграции обхода.

1. Найди все оставшиеся прямые использования CONFIG_PROPS для фильтрации
   ключей при обходе:
   grep -rn "CONFIG_PROPS.has" store/ --include="*.ts" | grep -v test | grep -v node_modules

2. Для каждого найденного файла определи:
   a) Это файл, который уже мигрирован? → Ошибка, нужно исправить
   b) Это файл с параллельным обходом (patch keys)? → OK, CONFIG_PROPS нужен
   c) Это traversal/nodeClassifier.ts? → OK, это канонический источник
   d) Это registerNodes.ts? → OK, самый сложный — мигрируется позже

3. Составь отчёт: какие файлы мигрированы, какие нет, какие не нужно.

4. Запусти полный набор тестов: npx vitest run

5. Если есть файлы из категории (a) — исправь их.
```

---

## Резюме порядка итераций

| # | Что | Сложность | Файлов меняется |
|:--|:----|:----------|:----------------|
| 1 | Layer 1: nodeClassifier (новый) | Лёгкая | 0 существующих, 3 новых |
| 2 | Layer 2: walkFull (новый) | Лёгкая | 0 существующих, 2 новых |
| 3 | Миграция captureInitialValues | Лёгкая | 1 |
| 4 | Миграция collectDefaults + collectInitialSnapshot | Лёгкая | 2 |
| 5 | Миграция collectLeafStates + setGroupRevalidate | Средняя | 2 |
| 6 | Миграция buildValuesCache | Средняя | 1 |
| 7 | Миграция formatPatch + applyPatch + mergeInitialValues | Лёгкая | 3 |
| 8 | Миграция recomputeDirty | Средняя | 1 |
| 9 | Миграция entity-методов (palistor.ts) | Средняя | 1 |
| 10 | Миграция initGroupSubmitting + createGroupDeps | Лёгкая | 2 |
| 11 | Удаление дублирующего nodeUtils.ts | Лёгкая | 2-5 |
| 12 | Верификация + очистка | Лёгкая | 0-2 |

## Правила для модели

1. **Одна итерация = один промпт.** Не объединяй итерации.
2. **Каждый промпт начинается с чтения файлов.** Не делай правки вслепую.
3. **Запускай тесты после каждой правки.** `npx vitest run` в конце.
4. **Не трогай файлы вне scope итерации.** Если нашёл проблему в другом файле — запиши, но не правь.
5. **Если тест падает — разберись, не хакай.** Читай тест, понимай ожидание, проверяй diff.
6. **registerNodes — последний.** Самый сложный обход. Не мигрируй до завершения всех остальных.
