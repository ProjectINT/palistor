# План: Targeted recomputeDirty + завершение внедрения traversal layer

## Контекст

Сейчас `recomputeDirty` выполняет **полный обход** дерева конфига при **каждом** вызове `notifyChanged`. Это единственный full-tree walk на runtime hot-path. Все остальные полные обходы происходят только при init/reset.

`recomputeTargeted` (для compute) уже реализован в `store/compute/recompute/recomputeTargeted.ts` — он использует `groupDeps` (карту зависимостей между группами) для BFS по affected groups. Нужно применить аналогичный подход для dirty tracking.

---

## Задача 1: Targeted `recomputeDirty` (ВЫСОКИЙ ПРИОРИТЕТ)

### Суть проблемы

`NotificationHub.notifyChanged()` вызывает `recomputeDirty(rootConfig, ...)` — это O(allNodes).
При каждом SET одного поля пересчитываются dirty-флаги **всех** узлов дерева.

### Подход: Scoped subtrees

Для каждого изменённого узла определяем его группу, пересчитываем dirty только для affected группы, затем bubble-up dirty к предкам.

### Шаг 1.1: Создать `recomputeDirtyTargeted` в `store/dirtyTracking/recomputeDirtyTargeted.ts`

**Новый файл.** Алгоритм:

```
recomputeDirtyTargeted(changedNodes, rootConfig, nodeState, initialValueMap, nodeParents, nodePaths, listStates?)
  → RecomputeDirtyResult { anyDirty, changed }
```

**Алгоритм:**

```
1. Определить affected groups:
   Для каждого node из changedNodes → getNodeGroupPath(node, nodeParents, nodePaths) → Set<string>

2. Для каждой affected group (по groupPath):
   a. resolveGroupByPath(rootConfig, groupPath) → groupNode
   b. Если groupNode === undefined (entity-пути "_entity_.*") → пропустить
   c. Пересчитать dirty ТОЛЬКО для immediate children этой группы:
      - Пройти configKeys(groupNode) 
      - Для leaf: isDirtyValue(state.value, initialValue), обновить state.dirty если изменился
      - Для list: arraysEqual check (как в текущем recomputeDirty)
      - Для sub-group: НЕ рекурсивно — прочитать ТЕКУЩИЙ state.dirty из nodeState (уже закеширован)
      - Вычислить anyChildDirty = OR(children.dirty)
   d. Обновить dirty на самой groupNode если изменился
   e. Если groupNode.dirty изменился → добавить PARENT group в очередь (bubble-up)

3. Bubble-up до root:
   - Для каждой group, чей dirty изменился, найти parent через nodeParents
   - Добавить parent group в очередь пересчёта
   - Повторять пока очередь не пуста

4. Обновить rootConfig dirty и вернуть { anyDirty, changed }
```

**Важный момент:** Для sub-groups внутри affected group мы НЕ рекурсируем вглубь — мы читаем их dirty прямо из `nodeState` (он уже закеширован с прошлого вызова). Пересчитываем dirty только для leaf-нод affected group + aggegируем вверх.

**Зависимости (всё уже существует):**
- `getNodeGroupPath` из `store/groupDeps/getNodeGroupPath.ts`
- `resolveGroupByPath` из `store/groupDeps/resolveGroupByPath.ts`
- `configKeys`, `isLeaf`, `isListNode` из `store/traversal`
- `isDirtyValue` из `store/dirtyTracking/isDirtyValue.ts`

**НЕ нужны** `groupDeps` (карта compute-зависимостей между группами) — dirty не зависит от кросс-групповых computed; dirty полностью определяется текущим value vs initial.

**Skeleton реализации:**

```typescript
import { configKeys, isLeaf, isListNode } from "../traversal";
import { resolveGroupByPath } from "../groupDeps/resolveGroupByPath";
import { getNodeGroupPath } from "../groupDeps/getNodeGroupPath";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { isDirtyValue } from "./isDirtyValue";
import type { RecomputeDirtyResult } from "./recomputeDirty";

/** arraysEqual — скопировать из recomputeDirty.ts (или вынести в shared) */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Scoped recompute dirty: пересчитывает dirty только для групп,
 * содержащих изменённые узлы, и bubble-up к предкам.
 *
 * Сложность: O(affectedGroups × childrenPerGroup) вместо O(allNodes).
 */
export function recomputeDirtyTargeted(
  changedNodes: Set<object>,
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
  nodeParents: WeakMap<object, object>,
  nodePaths: WeakMap<object, string>,
  listStates?: WeakMap<object, { itemIds: string[]; initialItemIds: string[] }>,
): RecomputeDirtyResult {
  const changed = new Set<object>();

  // 1. Пересчитать dirty только для ЛИСТЬЕВ из changedNodes
  const affectedGroupPaths = new Set<string>();
  for (const node of changedNodes) {
    if (isLeaf(node as object)) {
      const state = nodeState.get(node);
      if (state) {
        const initial = initialValueMap.get(node);
        const dirty = isDirtyValue(state.value, initial);
        if (state.dirty !== dirty) {
          nodeState.set(node, { ...state, dirty });
          changed.add(node);
        }
      }
    }
    affectedGroupPaths.add(getNodeGroupPath(node, nodeParents, nodePaths));
  }

  // 2. Для каждой affected group — агрегировать dirty из immediate children
  //    и bubble-up к предкам
  const processed = new Set<string>();
  const queue = [...affectedGroupPaths];

  while (queue.length > 0) {
    const groupPath = queue.shift()!;
    if (processed.has(groupPath)) continue;
    processed.add(groupPath);

    const groupNode = resolveGroupByPath(rootConfig, groupPath);
    if (!groupNode) continue; // entity-пути — пропускаем

    // Агрегировать dirty из immediate children
    let anyChildDirty = false;
    for (const key of configKeys(groupNode as Record<string, unknown>)) {
      const child = groupNode[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;

      if (isListNode(child)) {
        if (listStates) {
          const ls = listStates.get(child);
          if (ls && !arraysEqual(ls.itemIds, ls.initialItemIds)) {
            anyChildDirty = true;
          }
        }
        continue;
      }

      const childState = nodeState.get(child);
      if (childState?.dirty) anyChildDirty = true;
    }

    // Обновить dirty на самой group-ноде
    const groupState = nodeState.get(groupNode);
    if (groupState && groupState.dirty !== anyChildDirty) {
      nodeState.set(groupNode, { ...groupState, dirty: anyChildDirty });
      changed.add(groupNode);

      // Bubble-up: добавить parent group в очередь
      const parent = nodeParents.get(groupNode);
      if (parent) {
        const parentPath = nodePaths.get(parent) ?? "";
        queue.push(parentPath);
      }
    }
  }

  // 3. Определить anyDirty по root
  const rootState = nodeState.get(rootConfig);
  const anyDirty = rootState?.dirty ?? false;

  return { anyDirty, changed };
}
```

**Тесты:** Написать unit-тесты в `store/dirtyTracking/recomputeDirtyTargeted.test.ts`:
- Изменение одного leaf → dirty пересчитывается только для его группы
- Group dirty = OR(children dirty) корректно агрегируется  
- Bubble-up до root работает
- Entity-paths (_entity_.*) пропускаются без ошибки
- List dirty корректно обрабатывается

### Шаг 1.2: Заменить `DirtyDeps` в `store/init/createNotificationHub.ts`

Добавить **обязательные** поля `nodeParents` и `nodePaths` (старый `recomputeDirty` удаляем полностью — он нигде больше не нужен):

```typescript
// БЫЛО:
export interface DirtyDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  initialValueMap: WeakMap<object, unknown>;
  listStates?: WeakMap<object, { itemIds: string[]; initialItemIds: string[] }>;
}

// СТАЛО:
export interface DirtyDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  initialValueMap: WeakMap<object, unknown>;
  listStates?: WeakMap<object, { itemIds: string[]; initialItemIds: string[] }>;
  nodeParents: WeakMap<object, object>;
  nodePaths: WeakMap<object, string>;
}
```

### Шаг 1.3: Заменить `recomputeDirty` → `recomputeDirtyTargeted` в `NotificationHub.notifyChanged()`

В файле `store/init/createNotificationHub.ts`:

```typescript
// БЫЛО:
import { recomputeDirty } from "../dirtyTracking";

// СТАЛО:
import { recomputeDirtyTargeted } from "../dirtyTracking/recomputeDirtyTargeted";
```

В методе `notifyChanged`:

```typescript
// БЫЛО:
notifyChanged(changed: Set<object>, dirtyDeps: DirtyDeps): void {
    if (changed.size === 0) return;

    const { rootConfig, nodeState, initialValueMap, listStates } = dirtyDeps;
    const dirtyResult = recomputeDirty(rootConfig, nodeState, initialValueMap, listStates);
    for (const n of dirtyResult.changed) changed.add(n);

// СТАЛО:
notifyChanged(changed: Set<object>, dirtyDeps: DirtyDeps): void {
    if (changed.size === 0) return;

    const { rootConfig, nodeState, initialValueMap, listStates, nodeParents, nodePaths } = dirtyDeps;
    const dirtyResult = recomputeDirtyTargeted(changed, rootConfig, nodeState, initialValueMap, nodeParents, nodePaths, listStates);
    for (const n of dirtyResult.changed) changed.add(n);
```

### Шаг 1.4: Прокинуть `nodeParents` и `nodePaths` в `Palistor.notifyChanged()`

В файле `store/store/palistor.ts`:

```typescript
// БЫЛО:
notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed, {
      rootConfig: this.rootConfig,
      nodeState: this.nodes.nodeState,
      initialValueMap: this.dirty.initialValueMap,
      listStates: this.nodes.listStates,
    });
  }

// СТАЛО:
notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed, {
      rootConfig: this.rootConfig,
      nodeState: this.nodes.nodeState,
      initialValueMap: this.dirty.initialValueMap,
      listStates: this.nodes.listStates,
      nodeParents: this.nodes.nodeParents,
      nodePaths: this.nodes.nodePaths,
    });
  }
```

### Шаг 1.5: Обновить экспорты в `store/dirtyTracking/index.ts`

```typescript
// Убрать:
export { recomputeDirty } from "./recomputeDirty";
export type { RecomputeDirtyResult } from "./recomputeDirty";

// Добавить:
export { recomputeDirtyTargeted } from "./recomputeDirtyTargeted";
export type { RecomputeDirtyResult } from "./recomputeDirtyTargeted";
```

### Шаг 1.6: Удалить мёртвый код

1. **Удалить** `store/dirtyTracking/recomputeDirty.ts` — полностью заменён targeted-версией
2. **Удалить метод `recompute()`** из `store/store/dirtyTracker.ts` — нигде не вызывается (проверено grep'ом: `dirty.recompute` — 0 matches). Оставить `capture`, `merge`, `collectSnapshot`, `initialValueMap`
3. **Убрать импорт** `recomputeDirty` из `dirtyTracker.ts` если он там есть

`RecomputeDirtyResult` перенести (или переэкспортировать) из `recomputeDirtyTargeted.ts`.

### Шаг 1.7: Проверка

Запустить ВСЕ существующие тесты — поведение не должно измениться:
```bash
npx vitest run
```

Ключевые тестовые файлы, которые покрывают dirty:
- `store/dirtyTracking/dirtyTracking.test.ts`
- `react/useForm.test.tsx`
- `react/phase4.test.tsx`

---

## Задача 2: Завершить внедрение Node Classifier (СРЕДНИЙ ПРИОРИТЕТ)

Заменить остатки `CONFIG_PROPS.has(key)` и `"value" in child` на утилиты из `store/traversal/`.

### 2.1. `store/compute/recompute/collectGroupLeafNodes.ts`

**Текущий код (строки 2, 24, 30):**
```typescript
import { CONFIG_PROPS } from "../../constants";
// ...
    if (CONFIG_PROPS.has(key)) continue;
// ...
    if ("value" in child) continue;
```

**Заменить на:**
```typescript
import { configKeys, isLeaf } from "../../traversal";
// ...
  for (const key of configKeys(groupNode as Record<string, unknown>)) {
// ...
    if (isLeaf(child)) continue;
```

Убрать `import { CONFIG_PROPS } from "../../constants";` если больше не используется.

### 2.2. `store/store/registerNodes.ts`

Тут `CONFIG_PROPS.has` используется в цикле `registerNodes`:
```typescript
    if (CONFIG_PROPS.has(key)) continue;
```

**Заменить на:**
```typescript
  for (const key of configKeys(node as Record<string, unknown>)) {
```

Добавить импорт `configKeys` из `"../traversal"`. Убрать `CONFIG_PROPS` из импортов если больше не нужен (проверить, нет ли других мест использования в файле).

### 2.3. `store/submitPipeline/applyLeafBeforeSubmit.ts`

**Текущий код:**
```typescript
import { CONFIG_PROPS } from "../constants";
// ...
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;
// ...
    if ("value" in child) {
```

**Заменить на:**
```typescript
import { configKeys, isLeaf } from "../traversal";
// ...
  for (const key of configKeys(node as Record<string, unknown>)) {
// ...
    if (isLeaf(child)) {
```

### 2.4. `store/dirtyTracking/mergeInitialValues.ts`

**Текущий код (строка 1, 20):**
```typescript
import { CONFIG_PROPS } from "../constants";
// ...
  for (const key of Object.keys(patch)) {
    if (CONFIG_PROPS.has(key)) continue;
```

**ВАЖНО:** Эта функция итерирует по ключам **patch**, а не config. Но `CONFIG_PROPS.has(key)` всё равно фильтрует правильно — это защита от служебных ключей. Однако `configKeys()` ожидает node, а не patch. Тут замена не прямолинейная:
- Если patch может содержать ключи типа "value", "label" и т.д., то фильтрация нужна
- Но `configKeys` работает с объектом, а не с patch

**Решение:** Оставить `CONFIG_PROPS.has(key)` — это параллельный обход (config + patch), `configKeys()` здесь не подходит. Удалить из плана.

### 2.5. `store/applyPatch/applyPatch.ts`

**Аналогично mergeInitialValues** — итерация по ключам patch. `CONFIG_PROPS.has(key)` здесь корректен.

**Решение:** Оставить `CONFIG_PROPS.has(key)` — это защитная фильтрация при обходе patch, а не config.

### 2.6. `store/writePipeline/formatPatch.ts`

**Аналогично** — итерация по patch.

**Решение:** Оставить `CONFIG_PROPS.has(key)`.

### Итого по задаче 2

**Менять:**
1. `collectGroupLeafNodes.ts` → `configKeys` + `isLeaf`
2. `registerNodes.ts` → `configKeys`
3. `applyLeafBeforeSubmit.ts` → `configKeys` + `isLeaf`

**НЕ менять** (обход по ключам patch, а не config):
- `mergeInitialValues.ts`
- `applyPatch.ts`
- `formatPatch.ts`

---

## Задача 3: Расширить walkFull adoption (НИЗКИЙ ПРИОРИТЕТ)

### 3.1. `store/init/initGroupSubmitting.ts` → walkFull

**Текущий код** — ручная рекурсия по groups.

**Переписать через walkFull:**

```typescript
import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

const DEFAULT_GROUP_STATE: Partial<FieldState> = {
  submitting: false,
  dirty: false,
  revalidate: false,
};

export function initGroupSubmitting(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
) {
  // Инициализировать сам корневой узел
  initGroupNode(node, nodeState);

  walkFull(node, {
    onLeaf() {}, // листья пропускаем
    onGroupEnter(groupNode) {
      initGroupNode(groupNode as AnyConfigNode, nodeState);
    },
  });
}

function initGroupNode(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>) {
  const existing = nodeState.get(node);
  if (existing) {
    nodeState.set(node, {
      ...existing,
      submitting: existing.submitting ?? false,
      dirty: existing.dirty ?? false,
      revalidate: existing.revalidate ?? false,
    });
  } else {
    nodeState.set(node, {
      value: undefined,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      ...DEFAULT_GROUP_STATE,
    });
  }
}
```

**Нюанс:** `walkFull` вызывает `onGroupEnter` для ДОЧЕРНИХ групп, но не для самого корневого `node`. Нужно инициализировать корневой узел отдельно перед walkFull (как в текущем коде). Проверь это — посмотри, вызывает ли walkFull visitor для самого `node` или только для его children.

### 3.2. `store/dirtyTracking/setGroupRevalidate.ts` → walkFull

**Текущий код** — ручная рекурсия по leaf + groups.

**Переписать через walkFull:**

```typescript
import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

export function setGroupRevalidate(
  node: AnyConfigNode,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  const changed = new Set<object>();

  // Обновить сам корневой узел (walkFull его не посещает)
  updateRevalidate(node, revalidate, nodeState, changed);

  walkFull(node, {
    onLeaf(leafNode) {
      updateRevalidate(leafNode, revalidate, nodeState, changed);
    },
    onGroupEnter(groupNode) {
      updateRevalidate(groupNode, revalidate, nodeState, changed);
    },
  });

  return changed;
}

function updateRevalidate(
  node: object,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
  changed: Set<object>,
) {
  const state = nodeState.get(node);
  if (state && state.revalidate !== revalidate) {
    nodeState.set(node, { ...state, revalidate });
    changed.add(node);
  }
}
```

---

## Задача 4: walkScoped — НЕ ДЕЛАТЬ

`walkScoped` не нужен. `recomputeTargeted` уже решает scoped-обход для compute. Targeted `recomputeDirty` тоже scoped. Создание отдельной абстракции не окупается.

---

## Порядок выполнения

1. **Задача 2** (Node Classifier cleanup) — самая простая, механическая замена
2. **Задача 3** (walkFull adoption) — тоже рефакторинг, проверяется существующими тестами  
3. **Задача 1** (targeted recomputeDirty) — главная оптимизация, требует нового кода + тестов

После каждой задачи запускать `npx vitest run` — все тесты должны проходить.

---

## Файлы для изменения (сводка)

### Задача 1 — Targeted recomputeDirty
| Действие | Файл |
|:---------|:-----|
| **СОЗДАТЬ** | `store/dirtyTracking/recomputeDirtyTargeted.ts` |
| **СОЗДАТЬ** | `store/dirtyTracking/recomputeDirtyTargeted.test.ts` |
| ИЗМЕНИТЬ | `store/init/createNotificationHub.ts` — DirtyDeps + notifyChanged |
| ИЗМЕНИТЬ | `store/store/palistor.ts` — `notifyChanged()` прокидывает nodeParents/nodePaths |
| ИЗМЕНИТЬ | `store/dirtyTracking/index.ts` — экспорт |
| ИЗМЕНИТЬ | `store/store/dirtyTracker.ts` — удалить метод `recompute()` и импорт `recomputeDirty` |
| **УДАЛИТЬ** | `store/dirtyTracking/recomputeDirty.ts` |

### Задача 2 — Node Classifier
| Действие | Файл |
|:---------|:-----|
| ИЗМЕНИТЬ | `store/compute/recompute/collectGroupLeafNodes.ts` |
| ИЗМЕНИТЬ | `store/store/registerNodes.ts` |
| ИЗМЕНИТЬ | `store/submitPipeline/applyLeafBeforeSubmit.ts` |

### Задача 3 — walkFull adoption
| Действие | Файл |
|:---------|:-----|
| ИЗМЕНИТЬ | `store/init/initGroupSubmitting.ts` |
| ИЗМЕНИТЬ | `store/dirtyTracking/setGroupRevalidate.ts` |

---

## Справка: Существующая инфраструктура

### Как работает `recomputeTargeted` (паттерн для подражания)

Файл: `store/compute/recompute/recomputeTargeted.ts`

1. `getNodeGroupPath(node, nodeParents, nodePaths)` — определяет group-path узла
2. BFS по `groupDeps` через `getRecipientGroups()` — собирает affected groups
3. `resolveGroupByPath(rootConfig, groupPath)` — получает config-ноду группы
4. `groupLeafMap.get(groupNode)` — берёт только OWN leaves
5. `recomputeLeaves(ownLeaves, ...)` — пересчитывает

Для dirty BFS по groupDeps НЕ нужен (dirty не зависит от кросс-групповых зависимостей). Вместо этого — bubble-up через nodeParents.

### Где nodeParents/nodePaths доступны

- `this.nodes.nodeParents` — WeakMap<object, object>
- `this.nodes.nodePaths` — WeakMap<object, string>
- Оба заполняются при `registerNodes` на init, доступны на всём протяжении жизни store

### Текущие call sites `notifyChanged` в palistor.ts

Все вызовы `this.notifyChanged(changed)` получат targeted dirty автоматически после задачи 1.4 — мы добавляем `nodeParents` и `nodePaths` в один метод.

### Старый `recomputeDirty` — УДАЛЯЕМ

`DirtyTracker.recompute()` **нигде не вызывается** (проверено grep'ом). Единственный потребитель `recomputeDirty` — `NotificationHub.notifyChanged()`, который всегда имеет `changed` set и доступ к `nodeParents`/`nodePaths`. Поэтому:
- `recomputeDirty.ts` удаляется полностью
- Метод `DirtyTracker.recompute()` удаляется как мёртвый код
- `DirtyDeps.nodeParents` и `nodePaths` становятся обязательными (не optional)
