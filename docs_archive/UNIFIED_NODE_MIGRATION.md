# Unified Node Architecture — Migration Plan

## Цель

Сделать все узлы конфига одного типа: **каждый узел имеет `value`**.
- Leaf: `value` = примитив (строка, число, булев)
- Group: `value` = объект-снапшот дочерних значений (readonly)
- List: без изменений (массив, отдельный proxy)

Записать: `leaf.value = "x"` → writePipeline. `group.value = { name: "x" }` → setValuesNode.
Прочитать: `leaf.value` → примитив. `group.value` → снапшот дочерних значений.

---

## Ключевое правило миграции

**`"value" in node` больше не различает leaf и group.** Вместо этого:

```ts
// БЫЛО:
const isLeaf = "value" in node;

// СТАЛО (runtime, O(1)):
const isLeaf = node.__kind === "leaf";
```

---

## Способ различения типов: маркер `__kind`

При `registerNodes` вызываем `hasChildren(node)` один раз и ставим `node.__kind = "leaf" | "group"`.
Entity nodes получают `__kind` при создании в фабриках (`createEntityNode`, `createGroupNode`).

**Единая система узлов:** config nodes (лекала) и entity nodes (экземпляры данных) — структурно одинаковы (leaf = `{ value }`, group = контейнер дочерних). Оба типа живут в `nodeState`, оба проходят одни и те же проверки. `__kind` навешивается на **все** узлы системы.

```ts
function hasChildren(node: AnyConfigNode): boolean {
  return configKeys(node as Record<string, unknown>).some(k => {
    const child = node[k];
    return child && typeof child === "object";
  });
}

// Config nodes — при registerNodes:
(child as any).__kind = hasChildren(child) ? "group" : "leaf";

// Entity nodes — при createEntityNode / createGroupNode:
(leaf as any).__kind = "leaf";
(group as any).__kind = "group";
```

- Runtime-проверка — O(1): `node.__kind === "leaf"`
- `hasChildren` вызывается только при инициализации config-дерева, дальше не нужна
- Entity фабрики ставят маркер напрямую (структура известна на момент создания)
- `__kind` добавлен в `CONFIG_PROPS` → не утекает в proxy keys / traversal / spread
- Аналог `$$typeof` в React — невидим для потребителя

---

## Инвентаризация: все 28 точек ветвления

| # | Файл | Что делает | Сложность миграции |
|---|---|---|---|
| 1 | `traversal/nodeClassifier.ts` | `isLeaf()`, `isGroup()` — канонические определения | **Критичная** — точка входа, меняем реализацию |
| 2 | `store/NodeRegistry/nodeUtils.ts` | Дублирует `isLeaf`, `isGroup` | **Простая** — следует за #1 |
| 3 | `traversal/walkFull.ts` | onLeaf vs onGroupEnter dispatch | **Простая** — использует `isLeaf()` |
| 4 | `buildProxy/buildProxy.ts` | `!("value" in node)` → group branch | **Ключевая** — основная цель рефакторинга |
| 5 | `buildProxy/computeProxyKeys.ts` | leaf keys vs group keys | **Средняя** — нужна новая логика ownKeys |
| 6 | `buildProxy/buildEntityProjectionProxy.ts` | `"value" in field` → leaf vs group entity | **Средняя** — entity nodes тоже получают `__kind` |
| 7 | `onChangePipeline/onChangePipeline.ts` | patch target: leaf→parent, group→self | **Простая** |
| 8 | `dirtyTracking/recomputeDirtyTargeted.ts` | only leaves carry dirty value | **Средняя** — group.value = snapshot, dirty семантика другая |
| 9 | `dirtyTracking/collectInitialSnapshot.ts` | leaf→scalar, group→recurse | **Простая** |
| 10 | `dirtyTracking/mergeInitialValues.ts` | leaf→store value, group→recurse | **Простая** |
| 11 | `groupDeps/createGroupDeps.ts` | skip leaves | **Простая** |
| 12 | `groupDeps/getNodeGroupPath.ts` | group→own path, leaf→parent path | **Простая** |
| 13 | `store/groupDepsMap.ts` | tracking values currentGroupPath | **Простая** |
| 14 | `store/palistor.ts` (registerDynamicLeaf) | entity leaf registration | **Средняя** |
| 15 | `store/palistor.ts` (collectEntityLeaves) | leaf→add, group→recurse | **Простая** |
| 16 | `store/palistor.ts` (template validation) | only validate leaves | **Простая** |
| 17 | `store/palistor.ts` (buildEntityValuesForTemplate) | leaf→value, group→recurse | **Простая** |
| 18 | `store/registerNodes.ts` | leaf registration + virtual leaf | **Ключевая** — группы теперь тоже имеют value |
| 19 | `store/nodeMap.ts` | recurse only into groups | **Простая** |
| 20 | `entityRegistry/entityRegistry.ts` | merge logic (`"value" in existing`) | **Средняя** — фабрики ставят `__kind`, merge переходит на `isLeafNode` |
| 21 | `resolvePipeline/executeEntityFieldResolve.ts` | entity value extraction | **Средняя** |
| 22 | `resolvePipeline/initResolveStates.ts` | template field walk | **Простая** |
| 23 | `submitPipeline/submitPipeline.ts` | 5 branch points | **Сложная** |
| 24 | `submitPipeline/applyLeafBeforeSubmit.ts` | leaf beforeSubmit | **Простая** |
| 25 | `resetPipeline/collectDefaults.ts` | leaf→default, group→recurse | **Простая** |
| 26 | `applyPatch/applyPatch.ts` | leaf→update value, group→recurse | **Средняя** |
| 27 | `valuesCache/valuesCache.ts` | leaf→scalar slot, group→nested object | **Средняя** |
| 28 | `compute/recompute/collectGroupLeafNodes.ts` | skip leaves | **Простая** |

---

## Что меняется для пользователя (API конфига)

**Ничего.** Пользовательский конфиг остаётся тем же:

```ts
const config = {
  name:    { value: "" },           // leaf — как раньше
  address: {                         // group — как раньше, без value в конфиге
    city:    { value: "" },
    country: { value: "" },
  },
};
```

Группа получает `value` **runtime** (в NodeRegistry/valuesCache), а не в конфиге.
Проверка `"value" in configNode` по-прежнему отличает leaf от group в **исходном конфиге**.
Но после registerNodes **обе** имеют `value` в `nodeState`.

---

## Поэтапный план миграции

### Phase 0: Подготовка инфраструктуры (без изменения поведения)

**0.1** Добавить `__kind` в `CONFIG_PROPS` (constants.ts):

```ts
export const CONFIG_PROPS = new Set<string>([
  "value", "label", "placeholder", "description",
  "validate", "formatter", "setter", ...
  "__kind",  // ← NEW
]);
```

**0.2** Добавить helper `hasChildren` в `traversal/nodeClassifier.ts`:

```ts
/** Есть ли у узла дочерние config-ключи (объекты). Вызывается ТОЛЬКО при инициализации. */
export function hasChildren(node: AnyConfigNode): boolean {
  return configKeys(node as Record<string, unknown>).some(k => {
    const child = node[k];
    return child && typeof child === "object";
  });
}
```

**0.3** В `registerNodes`: при обходе дерева ставить маркер на каждый узел:

```ts
// В начале обработки child:
(child as any).__kind = hasChildren(child) ? "group" : "leaf";
```

**0.4** Создать runtime-helper `isLeafNode`:

```ts
export function isLeafNode(node: object): boolean {
  return (node as any).__kind === "leaf";
}
export function isGroupNode(node: object): boolean {
  return (node as any).__kind === "group";
}
```

**0.5** Удалить `isLeaf()` / `isGroup()` из nodeClassifier и `nodeUtils.ts`. Заменить все 28 config-точек + 6 entity-точек на `isLeafNode()` / `isGroupNode()`. Включая:
- `buildEntityProjectionProxy.ts`: `"value" in` → `isLeafNode()`
- `entityRegistry.ts` (`mergeEntityNode`): `"value" in existing` → `isLeafNode(existing)`
- `palistor.ts` (`collectEntityLeaves`, `buildEntityValuesForTemplate`): `isLeaf()` → `isLeafNode()`
- Все остальные точки из таблицы инвентаризации

**0.6** Entity node фабрики — навешивать `__kind` при создании:

Entity nodes структурно идентичны config nodes: leaf = `{ value }`, group = контейнер дочерних.
Они живут в том же `nodeState`, проходят тот же `isLeaf()` — это **одна система**, не отдельная иерархия.

```ts
// entityRegistry.ts → createEntityNode:
export function createEntityNode(data: EntityData, id: string): EntityNode {
  const node: EntityNode = { id: { value: id } };
  (node.id as any).__kind = "leaf";
  for (const key of Object.keys(data)) {
    if (key === "id") continue;
    const val = data[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      node[key] = createGroupNode(val as Record<string, unknown>);
    } else {
      const leaf = { value: val };
      (leaf as any).__kind = "leaf";
      node[key] = leaf;
    }
  }
  // EntityNode корень — это группа (контейнер дочерних)
  (node as any).__kind = "group";
  return node;
}

// entityRegistry.ts → createGroupNode:
function createGroupNode(obj: Record<string, unknown>): EntityGroupNode {
  const group: EntityGroupNode = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      group[key] = createGroupNode(val as Record<string, unknown>);
    } else {
      const leaf = { value: val };
      (leaf as any).__kind = "leaf";
      group[key] = leaf;
    }
  }
  (group as any).__kind = "group";
  return group;
}

// entityRegistry.ts → mergeEntityNode: новые leaf/group тоже получают __kind:
if (!existing) {
  // Новый leaf
  const leaf = { value: val };
  (leaf as any).__kind = "leaf";
  target[key] = leaf;
}
// Новая группа:
const g = createGroupNode(val as Record<string, unknown>);
// __kind уже навешен внутри createGroupNode
target[key] = g;
```

После этого все entity nodes (существующие и новые) имеют `__kind`. Проверки в `buildEntityProjectionProxy`, `collectEntityLeaves`, `buildEntityValuesForTemplate`, `mergeEntityNode` могут использовать `isLeafNode()` / `isGroupNode()` вместо `"value" in`.

**Тесты:** Все существующие тесты проходят. Новый тест: после registerNodes каждый узел имеет `__kind`. Новый тест: после `createEntityNode` каждый entity leaf/group имеет `__kind`.

---

### Phase 1: Группы получают `value` в nodeState

**1.1** В `registerNodes`: для каждого группового узла ставить `value` = ссылка на `groupSlot`:

```ts
// Сейчас (только для "virtual leaves" с computed props):
if (!("value" in child) && hasComputedProps(child)) {
  nodeState.set(child, { value: undefined, ... });
}

// После — для ВСЕХ групп:
if (!("value" in child)) {
  nodeState.set(child, { 
    value: undefined, // заполнится после buildValuesCache
    isVisible: ..., isRequired: ..., ...
  });
}
```

**1.2** В `buildValuesCache`: после построения — обновить `nodeState[group].value` = `groupSlot[group]`:

```ts
// Новый шаг после walk():
for (const [group, obj] of groupSlot.entries()) {
  const state = nodeState.get(group);
  if (state) nodeState.set(group, { ...state, value: obj });
}
```

**Тесты:** Существующие проходят (группы раньше тоже попадали в nodeState как virtual leaves). Добавить тест: `nodeState.get(groupNode).value` === объект значений.

---

### Phase 1.3: Устранение концепции "virtual leaf"

"Virtual leaf" — это workaround: движок recompute работает по массиву `leafNodes`, поэтому группы с computed-свойствами просто засунули в тот же массив и назвали "виртуальными листьями". Это создаёт:
- Ложный инвариант: `leafNodes` содержит не только листья
- Двойную семантику `groupLeafMap`: real leaf хранится под родителем, virtual leaf — под самим собой
- Лишнюю ветку `!("value" in child) && hasComputedProps(child)` — отдельную от основной регистрации

После Phase 1.1 (все группы в nodeState) "virtual leaf" как концепция больше не нужна.

**1.3.1** Переименовать `leafNodes` → `computeNodes` (массив всех узлов, участвующих в recompute):

```ts
// Было:
readonly leafNodes: LeafEntry[] = [];

// Стало:
readonly computeNodes: ComputeEntry[] = [];
```

**1.3.2** Переименовать `groupLeafMap` → `groupComputeMap`:

```ts
// Было:
readonly groupLeafMap: GroupLeafMap = new WeakMap();

// Стало:
readonly groupComputeMap: GroupComputeMap = new WeakMap();
```

**1.3.3** Унифицировать хранение в `groupComputeMap` — ВСЕ entries хранятся под **родительской** группой, без исключений:

```ts
// Было (virtual leaf — под самим собой):
if (!("value" in child) && hasComputedProps(child)) {
  const entry = { node: child, path };
  leafNodes.push(entry);
  getOrCreateLeafList(groupLeafMap, child).push(entry);  // ← под СОБОЙ
}

// Стало (единообразно — под родителем):
if (isGroupNode(child) && hasComputedProps(child)) {
  const entry: ComputeEntry = { node: child, path };
  computeNodes.push(entry);
  getOrCreateList(groupComputeMap, parentNode).push(entry);  // ← под РОДИТЕЛЕМ, как все
}
```

**1.3.4** Упростить `collectGroupLeafNodes` → `collectGroupComputeNodes`:

```ts
export function collectGroupComputeNodes(
  groupNode: AnyConfigNode,
  groupComputeMap: GroupComputeMap,
): ComputeEntry[] {
  const result: ComputeEntry[] = [];
  const ownEntries = groupComputeMap.get(groupNode);
  if (ownEntries) result.push(...ownEntries);

  for (const key of configKeys(groupNode)) {
    const child = groupNode[key];
    if (!child || typeof child !== "object") continue;
    if (isLeafNode(child)) continue;
    result.push(...collectGroupComputeNodes(child, groupComputeMap));
  }
  return result;
}
```

**1.3.5** Удалить термин "virtual leaf" из кода и комментариев. Удалить `hasComputedProps` check как отдельную ветку — теперь это часть единого пути регистрации группы:

```ts
// registerNodes — единый путь для групп:
if (isGroupNode(child)) {
  // nodeState — безусловно (Phase 1.1)
  nodeState.set(child, { value: undefined, isVisible: ..., ... });

  // computeNodes — только если есть что пересчитывать
  if (hasComputedProps(child)) {
    const entry: ComputeEntry = { node: child, path };
    computeNodes.push(entry);
    getOrCreateList(groupComputeMap, parentNode).push(entry);
  }
}
```

`hasComputedProps` остаётся — это валидная проверка "нужен ли этому узлу recompute-цикл". Исчезает только обёртка "virtual leaf".

**1.3.6** Обновить `recomputeTargeted` — использовать `groupComputeMap` с новой семантикой. Группа с `isVisible` теперь в entries своего родителя → при recompute родителя автоматически пересчитываются флаги дочерних групп.

**Тесты:** Все существующие тесты проходят (поведение то же). Переименования — механические. Тест: группа с `isVisible` попадает в `computeNodes` и в `groupComputeMap` родителя.

---

### Phase 2: `buildProxy.ts` — убрать ветвление leaf/group

**2.1** Прокси `get` trap: группа теперь тоже возвращает `value` из nodeState:

```ts
// БЫЛО:
const isGroupNode = !("value" in node);
if (isGroupNode) {
  // group-specific handlers
}
// fieldStateHandlers["value"] = currentNode ? currentNode.value : node.value;

// СТАЛО:
// Все узлы имеют value в nodeState. Различие — только group-specific methods.
const isContainer = (node as any).__kind === "group";

if (isContainer) {
  // reset, setValues, values — только для контейнеров
}

// submit — доступен всем узлам (leaf сабмитит своё значение, group — поддерево)
// fieldStateHandlers["value"] — одинаково для обоих:
"value": currentNode?.value,
```

**2.2** Proxy `set` trap: запись `group.value = {...}` → `kernel.setValuesNode`:

```ts
set(_target, key, newValue) {
  if (key !== "value") return false;
  
  if ((node as any).__kind === "group") {
    // Group write: delegate to setValuesNode
    kernel.setValuesNode(node, newValue as Record<string, unknown>);
    return true;
  }
  
  // Leaf write: existing writePipeline
  // ...
}
```

**2.3** `computeProxyKeys`: заменить `isLeaf(node)` на `(node as any).__kind === "leaf"`.

Никаких проблем с доступом — маркер на самом объекте.

**Тесты:** Все proxy-тесты. Новый тест: `group.value` возвращает объект значений.

---

### Phase 3: Dirty tracking для групп через value

**3.1** `recomputeDirtyTargeted`: **не менять логику для листьев**. Для групп dirty остаётся агрегатом дочерних — это правильная семантика.

Group `value` в dirty tracking **не участвует** как самостоятельная единица. `group.dirty` = "хотя бы один дочерний leaf dirty". Это не меняется.

**3.2** `collectInitialSnapshot` / `mergeInitialValues`: логика остаётся рекурсивной. Группы хранят снапшот value для `reset`, но dirty считается по листьям.

**Без изменений в этой фазе** — dirty tracking работает как раньше.

---

### Phase 4: Submit pipeline — унификация

**4.1** Submit для листа и группы отличается в 5 местах. Полная унификация невозможна без потери семантики. Но можно упростить:

```ts
// Единый вход:
const value = nodeState.get(node)?.value; 
// Для leaf: примитив. Для group: снапшот.

// beforeSubmit одинаков:
if (typeof node.beforeSubmit === "function") {
  value = await node.beforeSubmit(value, parentValues);
}
```

**4.2** Валидация: group собирает ошибки дочерних листьев, leaf проверяет себя. Это **семантически разное** — оставить ветвление, но по `__kind`:

```ts
const isContainer = (node as any).__kind === "group";
```

**4.3** afterSubmit reset scope и persist.clear — тоже остаются с ветвлением по `isContainer`.

---

### Phase 5: Финальная очистка

К этому моменту все замены уже сделаны в Phase 0.5. Phase 5 — это проверка:
- В коде нет ни одного вызова `isLeaf()` / `isGroup()`
- В коде нет ни одного `"value" in node` кроме `registerNodes` (парсинг исходного конфига)
- `nodeClassifier.ts` экспортирует только `isLeafNode()`, `isGroupNode()`, `hasChildren()`
- `nodeUtils.ts` — удалён или очищен от дублей

---

## Риски и митигация

### Риск 1: `group.value` = mutable reference

Group `value` — это ссылка на объект в valuesCache. Если пользователь мутирует `group.value.name = "x"`, это обойдёт writePipeline.

**Решение:** Не замораживать (дорого — `structuredClone` / `Object.freeze` на каждый GET). Возвращаем ссылку как есть. Документируем: `group.value` — readonly snapshot, мутация свойств напрямую не поддерживается. Запись только через `group.value = {...}` (set trap → `setValuesNode`).

### Риск 2: Object.is() сравнение для group.value

В writePipeline: `Object.is(processedValue, currentState.value)` — для объектов всегда `false` (разные ссылки).

**Митигация:** В set trap для группы — вызывать `setValuesNode` напрямую, минуя writePipeline. WritePipeline остаётся только для leaf-writes.

### Риск 3: Entity nodes и `__kind`

Entity nodes структурно идентичны config nodes: `EntityLeafNode` = `{ value }` (leaf), `EntityGroupNode` = контейнер дочерних (group). Они регистрируются в том же `nodeState` через `registerDynamicLeaf`, проходят те же `isLeaf()` проверки в `collectEntityLeaves`, `buildEntityValuesForTemplate`, `mergeEntityNode`.

Это **одна и та же система узлов**, а не "отдельная иерархия типов". Config node — лекало (template), entity node — экземпляр данных по этому лекалу. Оба имеют leaf/group структуру.

**Решение:** Entity nodes получают `__kind` при создании в фабриках (`createEntityNode`, `createGroupNode`, `mergeEntityNode`). Все 5+ точек ветвления в entity-коде (`"value" in entityField`) мигрируют на `isLeafNode()` / `isGroupNode()` в Phase 0.5 наравне с config nodes.

Точки миграции в entity-коде:
- `buildEntityProjectionProxy.ts` L23: `"value" in field` → `isLeafNode(field)`
- `buildEntityProjectionProxy.ts` L446: `"value" in entityField` → `isLeafNode(entityField)`
- `buildEntityProjectionProxy.ts` L468: `"value" in templateField` (template — config node, уже имеет `__kind`)
- `entityRegistry.ts` L72: `!("value" in existing)` в merge → `isGroupNode(existing)`
- `palistor.ts` collectEntityLeaves: `isLeaf(child)` → `isLeafNode(child)`
- `palistor.ts` buildEntityValuesForTemplate: `isLeaf(field)` → `isLeafNode(field)`

### Риск 4: registerNodes — `"value" in child` для начального конфига

На этапе парсинга конфига нужно отличать leaf от group чтобы навесить маркер. Используем `hasChildren()` + наличие `"value"` в конфиге.

**Митигация:** registerNodes — единственное место, где `hasChildren()` / `"value" in child` вызывается. После этого все проверки через `__kind`.

### Риск 5: Virtual leaves (группы с computed props)

Сейчас группы с `isVisible` и т.д. регистрируются как "virtual leaves" в `leafNodes` / `groupLeafMap`. После миграции ВСЕ группы попадают в nodeState — virtual leaf логика **полностью устраняется** в Phase 1.3.

**Митигация:** Концепция "virtual leaf" удаляется. `leafNodes` → `computeNodes`, `groupLeafMap` → `groupComputeMap`. `hasComputedProps` остаётся как критерий попадания в `computeNodes` (нужна для recompute scheduling), но больше не создаёт отдельную сущность. nodeState.set для группы делается безусловно. Хранение в `groupComputeMap` — единообразно под родителем.

### Риск 6: Производительность — nodeState растёт

Сейчас: только листья и virtual leaves в nodeState.
После: все группы тоже. На форме с 100 полями и 20 группами — +20 записей.

**Митигация:** WeakMap, незначительный overhead.

### Риск 7: `__kind` мутирует пользовательский конфиг

`registerNodes` навешивает `__kind` на объекты, переданные пользователем.

**Митигация:**
- `__kind` добавлен в `CONFIG_PROPS` → не утечёт в proxy keys, traversal, spread.
- Это аналогично тому, как React навешивает `$$typeof` на элементы — невидимо для потребителя.
- Если конфиг `Object.freeze()`-нут — registerNodes должен обернуть в `Object.create(node)` перед навешиванием маркера (edge case, документировать).

### Риск 8: group.value в valuesCache sync

При записи в leaf, `valuesCache` обновляет scalar значение. `group.value` (ссылка на тот же объект в valuesCache) обновляется автоматически — это один и тот же объект.

**Митигация:** Не нужна. Работает "бесплатно" благодаря мутабельной reference в groupSlot.

---

## Порядок работы (checklist)

3 фазы, 3 коммита. Каждая фаза — атомарный коммит, тесты проходят после каждой.

### Phase 1: `__kind` маркер + глобальная замена (механическая, без изменения поведения)

- [x] `__kind` в CONFIG_PROPS
- [x] `hasChildren()` helper в nodeClassifier
- [x] `registerNodes` → навешивать `__kind` на каждый config узел
- [x] `isLeafNode()` / `isGroupNode()` runtime-helpers
- [x] Entity фабрики (`createEntityNode`, `createGroupNode`, `mergeEntityNode`) → `__kind`
- [x] Удалить `isLeaf()` / `isGroup()`, заменить все 28+6 точек на `isLeafNode()` / `isGroupNode()`

Суть: после этого коммита `__kind` проставлен на всех узлах, старые функции удалены, все проверки через `isLeafNode`/`isGroupNode`. Поведение идентично — `__kind === "leaf"` эквивалентен `"value" in node` для существующего кода.

### Phase 2: Group nodeState + устранение virtual leaf

- [x] Все группы в nodeState при registerNodes (value: undefined → заполнится)
- [x] `buildValuesCache` → обновить group.value = groupSlot reference
- [x] `leafNodes` → `computeNodes`, `groupLeafMap` → `groupComputeMap`
- [x] Единообразное хранение в `groupComputeMap` — всё под родителем
- [x] `collectGroupLeafNodes` → `collectGroupComputeNodes`
- [x] Удалить термин "virtual leaf", единый путь регистрации групп

Суть: внутренняя реструктуризация. Группы имеют value в nodeState, virtual leaf как концепция убита. Внешний API не меняется.

### Phase 3: Proxy group.value + submit unification

- [x] `buildProxy.ts` get trap → group возвращает value из nodeState
- [x] `buildProxy.ts` set trap → `group.value = {...}` вызывает setValuesNode
- [x] `computeProxyKeys` → ownKeys для групп включает `value`
- [x] Submit pipeline → единый вход через `nodeState.get(node).value`, ветвление по `__kind`

Суть: пользователь получает `group.value` для чтения/записи. Submit использует единый вход.

---

## Итоговый результат

После миграции:

```ts
// Proxy API — одинаковый для leaf и group:
proxy.value          // leaf: "John"  |  group: { name: "John", age: 30 }
proxy.value = x      // leaf: writePipeline  |  group: setValuesNode
proxy.dirty          // leaf: own value changed  |  group: any child dirty
proxy.loading        // leaf: resolver pending  |  group: resolver pending
proxy.submitting     // оба: submit in progress
proxy.submit()       // оба: leaf submits own value, group submits subtree

// Group-only (контейнер):
proxy.reset()        // only groups  
proxy.setValues({})  // only groups (= proxy.value = {})
proxy.values         // alias для proxy.value (обратная совместимость, удалить в следующем major)
```

Различие leaf/group в proxy — минимальное: только наличие `reset`/`setValues` у контейнеров. `submit()` доступен на обоих — leaf сабмитит своё значение, group собирает поддерево. Вся state-логика (value, dirty, loading, labels, flags) — единообразна.
