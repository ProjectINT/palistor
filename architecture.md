# Palistor — Архитектура

## Слои системы

```
┌─────────────────────────────────────────────────────────┐
│                     React-компонент                      │
│  const form = useForm(store)                            │
│  <input value={form.email.value} />                     │
└────────────────────┬────────────────────────────────────┘
                     │ GET / SET
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Tracking Proxy  (Слой 2)                   │
│  createTrackingProxy.ts                                  │
│  • GET FIELD_STATE_PROP → пишет config-ноду             │
│    в refs.accessed (tracked set компонента)             │
│  • GET items/map/length/dirty (ListProxy)               │
│    → пишет listNode в refs.accessed                     │
│  • GET дочернего узла → рекурсивный tracking proxy      │
│  • SET → прозрачно в Store Proxy                        │
└────────────────────┬────────────────────────────────────┘
                     │ GET / SET
                     ▼
┌─────────────────────────────────────────────────────────┐
│               Store Proxy  (Слой 1)                     │
│  buildProxy.ts                                          │
│  • GET FIELD_STATE_PROP → читает из nodeState           │
│  • GET CONFIG_NODE → возвращает сам config-узел         │
│  • GET "values" на группе → groupSlot.get(node)         │
│    (live-ссылка на вложенный объект valuesCache)        │
│  • GET дочернего ключа → рекурсивный store proxy        │
│  • GET на группу с resolve (idle) → triggerResolve      │
│  • GET на группу с resolve (pending + suspense)         │
│    → throw promise (React Suspense)                     │
│  • SET "value" → запускает Write Pipeline               │
│  • OWNKEYS / DESC → computeProxyKeys → скрывает         │
│    internal ключи конфига при spread / Object.keys()    │
└────────────────────┬────────────────────────────────────┘
                     │
           ┌─────────┼──────────┐
           ▼         │          ▼
┌──────────────────┐ │ ┌────────────────────────────────────┐
│  Config (static) │ │ │  nodeState: WeakMap<node,FieldState>│
│  Неизменяемое    │ │ │  { value, isVisible, isInvalid,    │
│  дерево узлов    │ │ │    loading, …}                     │
└──────────────────┘ │ └────────────────────────────────────┘
                     ▼
          ┌──────────────────────────────────┐
          │  resolveStates: Map<node, state> │
          │  { status, promise, error,       │
          │    dependencies, attempt }       │
          └──────────────────────────────────┘
```

---

## Palistor — класс-ядро (kernel)

`Palistor` — единственная точка входа. Одновременно реализует `ProxyStore` (публичный API)
и служит DI-контейнером для всех внутренних подсистем.

```
Palistor<TConfig>  (implements ProxyStore)
  │
  ├─ @internal nodes         NodeRegistry   — nodeState, nodePaths, nodeParents,
  │                                           leafNodes, groupLeafMap, proxyCache
  ├─ @internal services      ServiceRegistry — translator, notifier, делегаты
  ├─ @internal dirty         DirtyTracker   — initialValueMap(getter), capture, merge, collectSnapshot
  ├─ @internal values        ValuesCache    — мутабельный снапшот values
  ├─ @internal groupDepsMap  GroupDepsMap   — deps, trackingWrap, isBuilt
  ├─ @internal hub           NotificationHub — версии, подписки, postNotifyHook
  ├─ @internal resolveManager ResolveManager — trigger, retrigger, eager launch
  ├─ @internal entityRegistry  EntityRegistry — нормализованный реестр сущностей + resolved cache
  ├─ @internal entityProjectionObjs  Map<string, Record<string, unknown>> — POJO-зеркала для valuesCache
  │
  ├─ @internal writePipeline    WritePipeline(kernel)
  ├─ @internal resetPipeline    ResetPipeline(kernel)
  ├─ @internal submitPipeline   SubmitPipeline(kernel)
  ├─ @internal onChangePipeline OnChangePipeline(kernel)
  ├─ @internal proxyBuilder     ProxyBuilder(kernel)
  │
  └─ persist               PersistManager  — публичный (ProxyStore), создаётся при init, активируется через enable() из usePersist
```

Все пайплайны принимают `kernel` (Palistor) в конструкторе и читают из него нужные
подсистемы напрямую — без россыпи deps-аргументов.

> **Примечание:** `set()` и `delete()` входят в интерфейс `ProxyStore` (типизированы).
> `rekey()` и `invalidate()` — публичные методы Palistor вне `ProxyStore` interface;
> подробнее в секции «store.set / store.delete / store.rekey / store.invalidate».

### Последовательность конструктора

```
new Palistor(options):
  1. ServiceRegistry               translate/notify делегаты
  2. NodeRegistry                  парсинг конфига, регистрация листьев + ListState
  3. DirtyTracker + buildValuesCache
  4. EntityRegistry + registerList(ls) для всех listStates
  5. GroupDepsMap + первый recompute()   строит карту groupDeps через trackingWrap
     dirty.capture(rootConfig)           snapshot baseline после init
  6. NotificationHub               { leafNodes, nodePaths }
  7. ResolveManager
  8. Pipeline-классы               Write, Reset, Submit, onChange, ProxyBuilder
     proxyBuilder.build(rootConfig)   → this._proxy
  9. PersistManager
 10. hub.setPostNotifyHook(resolveManager.createPostNotifyHook())
 11. resolveManager.launchEager()  запуск eager (lazy: false) resolvers
```

### @internal методы Palistor

| Метод | Описание |
|---|---|
| `recompute(changedNodes?)` | Два режима: с `changedNodes` → таргетированный; без → полный |
| `notifyChanged(changed)` | Вызывает `hub.notifyChanged` с DirtyDeps |
| `setValuesNode(node, patch)` | `formatPatch(writePipeline/formatPatch.ts) → applyPatch → recomputeAndNotify`. `formatPatch` — рекурсивно применяет formatter'ы к патчу перед записью. |
| `triggerEntityTemplateResolve(entityId, templateNode, entityProxy)` | Запустить resolve для entity-template binding (вызывается из `useForm` на mount). Loading flag + resolver + markResolved. |
| `executeEntityTemplateSubmit(entityId, templateNode, entityProxy)` | Submit entity через template: validate → onSubmit → afterSubmit |
| `_setEntitiesRaw(items)` | Upsert entities без recompute/notify (возвращает changedNodes) |
| `_syncListValuesCache(listNode)` | Перестроить массив в valuesCache из `listState.itemIds → entityProjectionObjs` |

---

## Write Pipeline

```
form.email.value = "X"   (SET trap в buildProxy)
  │
  ├─── WritePipeline.execute(node, rawValue) → WriteResult { changed: Set<object>, skipped?: boolean }
  │      ├─ 1.   formatValue()        node.formatter(raw, allValues)
  │      ├─ 1.5  skip?                Object.is(formatted, current)
  │      │                            → return { changed: empty, skipped: true }
  │      ├─ 2.   storeValue()         nodeState.set(node, { ...state, value })
  │      │                            + updateValuesCacheEntry O(1)
  │      ├─ 2.5  runSetter()          node.setter(value, allValues, prev) → patch → applyPatch()
  │      ├─ 3.   recompute(changedNodes)  таргетированный пересчёт групп
  │      └─ 4.   mergeChanged()       → возвращает WriteResult { changed }
  │
  ├─ 5. notifyChanged(result.changed)    ← SET trap, после WritePipeline
  │      ├─ recomputeDirtyTargeted
  │      ├─ nodeVersions[node]++ для changed-нод
  │      ├─ globalListeners → useSyncExternalStore → getSnapshot()
  │      └─ postNotifyHook → findResolvesToRetrigger → resetResolveState → triggerResolve
  └─ 6. onChangePipeline.fire()          ← SET trap, fire-and-forget onChange
```

---

## Submit Pipeline

```
form.submit()                (SubmitPipeline.execute(groupNode))
  ├─ 1. submitting = true, setGroupRevalidate(true) → recompute → notifyChanged
  ├─ 2. getSubValues()             извлечь текущие values поддерева
  ├─ 3. applyLeafBeforeSubmit()    leaf-level beforeSubmit трансформации
  ├─ 4. group beforeSubmit()       group-level beforeSubmit трансформация
  ├─ 5. collectLeafStates() → есть ошибки? → { success: false, errors }
  ├─ 6. onSubmit(values, store) → result
  ├─ 7. afterSubmit(result, { reset })
  ├─ 8. persist.clear()
  └─ finally: submitting = false → recompute → notifyChanged
```

---

## Reset Pipeline

```
form.reset(values?)          (ResetPipeline.execute(groupNode, values?))
  │
  ├─ 1. buildResetPatch(groupNode, initialValueMap, values?)
  │        ├─ values переданы явно → используются как патч напрямую
  │        └─ иначе → collectInitialSnapshot (или collectDefaults как fallback)
  │                   → затем если groupNode.reset() задан → трансформировать базу через него
  │
  ├─ 2. applyPatch(groupNode, patch) → changedNodes
  │
  ├─ 3. если values переданы явно:
  │        captureInitialValues(groupNode) — новая baseline (dirty = false)
  │
  ├─ 4. setGroupRevalidate(groupNode, false) → сбросить режим валидации
  │
  └─ 5. recomputeAndNotify(changedNodes)
```

---

## onChange Pipeline

```
WritePipeline возвращает результат → SET trap вызывает OnChangePipeline.fire(node, newValue, prev):
  │
  ├─ findOnChangeAncestors(node, nodeParents)
  │    обходит родителей вверх — собирает предков у which onChange === Function
  │
  └─ для каждого ancestor:
       ├─ fieldKey = computeFieldKey(nodePath, ancestorPath)
       │    относительный путь изменённого поля от ancestor (e.g. "address.city")
       │
       └─ Promise.resolve(ancestor.onChange({ fieldKey, newValue, previousValue, allValues }))
            .then(patch) → если объект-патч возвращён:
            │               applyPatch(ancestor, patch) + recomputeAndNotify
            .catch()     → ошибки подавляются (fire-and-forget)
```

---

## Resolve Pipeline

```
GET form.car → узел idle → triggerResolve()
  ├─ optimisticResolver → applyPatch, loading: true, notifyChanged
  └─ resolver(trackingProxy)         ← createValuesTrackingProxy (resolvePipeline/, ≠ React tracking proxy)
                                        auto-deps: read → accessedPaths, write → pendingWrites buffer
       ├─ OK  → batch flush: applyPatch(result) + buffered writes, loading: false,
       │        status: resolved, save auto-deps, mergeInitialValues (dirty baseline),
       │        recompute, notifyChanged (1 раз)
       ├─ ERR → retry до attempts раз (delay ms) → при исчерпании:
       │        onError(err, { notify }), loading: false, status: error
       └─ always: recompute + notifyChanged

Deps: явные (config) ∪ auto-deps (из tracking proxy resolver'а)
При изменении dep: notifyChanged → findResolvesToRetrigger → resetResolveState → triggerResolve

Suspense: status === "pending" → throw promise → React <Suspense> ловит
Ошибки: НИКОГДА не бросаются — только реактивно через form.car.isInvalid
```

### List resolve (executeListResolve)

Отличается от group resolve — resolver ListNode'а возвращает `Array<EntityData>`, а не патч:

- Нет trackingProxy: resolver получает plain-снапшот значений
- Нет optimisticResolver, нет retry
- Результат → `setEntitiesRaw(items)` — upsert entities, регистрация leaf-нод
- `listState.itemIds` заполняется из `.id` каждого элемента результата
- `listState.initialItemIds = [...itemIds]` → dirty = false сразу после resolve
- `listState.version++` → React замечает изменение
- `syncListValuesCache(listNode)` → valuesCache синхронизируется

---

## Tracking — гранулярные ре-рендеры

```
Рендер: читаем form.email.value, form.phone.value → accessed = {emailNode, phoneNode}

SET form.city.value → cityNode++ → getSnapshot проверяет только accessed → не изменилось → нет ре-рендера ✓
SET form.email.value → emailNode++ → getSnapshot → изменилось → ре-рендер ✓
```

`useForm(subtree)` в дочернем компоненте создаёт **свой** tracking proxy — независимый ре-рендер.  
`hasNavigated` флаг: Parent, который навигирует `form.passport`, но не читает FIELD_STATE_PROPS, не ре-рендерится при изменении полей внутри passport.

---

## Модули

```
store/
  constants.ts              символы CONFIG_NODE / SOURCE_PROXY / STORE_REF / ENTITY_ID
                            FIELD_STATE_PROPS (12): value, label, placeholder, description,
                              isRequired, isReadOnly, isDisabled, isVisible, isInvalid,
                              errorMessage, dirty, loading
                            SPREADABLE_FIELD_STATE_PROPS (11): FIELD_STATE_PROPS − {dirty, loading} + {onValueChange}
                            CONFIG_PROPS: надмножество FIELD_STATE_PROPS + validate, formatter,
                              setter, componentProps, types, dependencies, onSubmit, beforeSubmit,
                              afterSubmit, reset, onChange, resolve, deps
                            GROUP_SPREAD_KEYS (6): submitting, dirty, revalidate, loading, submit, reset
                            LIST_SPREAD_KEYS (9): items, length, loading, dirty, add, remove,
                              getById, setItems, map
  traversal/
    nodeClassifier.ts       Layer 1: isLeaf, isGroup, isListNode, configKeys
    walkFull.ts             Layer 2: walkFull + TreeVisitor interface
    index.ts                реэкспорт traversal utilities
  applyPatch/
    applyPatch.ts           применение патчей к дереву nodeState + valuesCache
  buildProxy/
    buildProxy.ts                  Proxy слой 1: ProxyBuilder (class)
    buildEntityProjectionProxy.ts  EntityProjectionProxy + leaf proxy (entity через template)
    buildListProxy.ts              ListProxyNode: items, add, remove, setItems, map, ...
    computeProxyKeys.ts            ownKeys для spread: SPREADABLE_FIELD_STATE_PROPS + componentProps для листа,
                                   LIST_SPREAD_KEYS для списка, GROUP_SPREAD_KEYS для группы
    handleLazyResolve.ts           idle → queueMicrotask(triggerResolve) (безопасно во время рендера);
                                   pending + suspense=true → throw promise → React Suspense
    initProxyCaches.ts             WeakMap-кэши (onValueChange, submit, reset, setValues)
  compute/
    computeFieldState.ts    вычисление FieldState одного узла
    fieldStateChanged.ts    сравнение двух FieldState (для skip notify)
    isEmpty.ts              утилита проверки пустоты значения
    resolveFlag.ts          resolve флага (bool | fn → bool)
    resolveString.ts        resolve строки (string | fn → string) + translate
    types.ts                FieldState + вспомогательные типы
    recompute/
      collectGroupLeafNodes.ts  сбор всех листьев поддерева группы (рекурсивно: own + дочерние группы через groupLeafMap)
      recomputeAndNotify.ts     хелпер: recompute → merge → notifyChanged
      recomputeLeaves.ts        пересчёт списка листьев (computed + fieldState)
      recomputeTargeted.ts      таргетированный пересчёт по groupDeps (BFS)
      topologicalSortComputed.ts  алгоритм Кана для computed-узлов
      types.ts                  TrackingWrap + RecomputeTargetedDeps
  dirtyTracking/
    captureInitialValues.ts    снимок initial values для dirty baseline
    collectInitialSnapshot.ts  вложенный снапшот initial values для reset (рекурсивно; граница — дочерние группы с reset())
    isDirtyValue.ts            сравнение value с initial (primitives: ===, objects: JSON.stringify)
    mergeInitialValues.ts      обновление baseline после resolve
    recomputeDirtyTargeted.ts  пересчёт dirty-флага для changed нод + propagation к предкам
    setGroupRevalidate.ts      выставление revalidate=true/false для группы (submit/reset)
  groupDeps/
    createGroupDeps.ts        начальная карта self-зависимостей групп
    createTrackingValues.ts   proxy для перехвата кросс-групповых READ-доступов
    getNodeGroupPath.ts       путь группы для произвольного узла
    getRecipientGroups.ts     реципиенты группы из groupDeps
    pairKey.ts                сериализация пары donor→recipient
    resolveGroupByPath.ts     config-узел группы по строковому пути
  init/
    createNotificationHub.ts  класс NotificationHub: версионирование + подписки + dirty
                              Конструктор: { leafNodes: LeafEntry[], nodePaths: WeakMap }
    createResolveManager.ts   класс ResolveManager: trigger, retrigger, eager launch
    initGroupSubmitting.ts    submitting/dirty/revalidate для групповых узлов
  onChangePipeline/
    computeFieldKey.ts        вычисление fieldKey для onChange
    findOnChangeAncestors.ts  поиск предков с onChange-хэндлером
    onChangePipeline.ts       класс OnChangePipeline
  persist/
    drivers.ts                localStorage / sessionStorage drivers
    persistManager.ts         класс PersistManager: enable, disable, hydrate, flush, clear, isEnabled
    types.ts                  PersistDriver (getItem / setItem / removeItem) +
                              PersistOptions (key, driver, serialize?, deserialize?, debounce?, pick?, omit?)
  resetPipeline/
    buildResetPatch.ts        построение патча сброса из defaults + overrides
    collectDefaults.ts        сбор дефолтных значений дерева
    resetPipeline.ts          класс ResetPipeline
  resolvePipeline/
    applyPendingWrites.ts         сброс буфера write-операций после resolve
    createValuesTrackingProxy.ts  tracking write-proxy для resolver (auto-deps)
    executeListResolve.ts         resolve для ListNode: resolver → Array<EntityData> → upsert entities → itemIds; ListResolveDeps
    executeResolve.ts             основная логика для групп: init → optimistic → trackingProxy → async → retry
    findResolvesToRetrigger.ts    поиск resolve-нод, зависящих от changedPaths
    initResolveStates.ts          рекурсивный обход конфига: ноды с resolve → ResolveState (idle);
                                  обрабатывает группы и ListNode (listConfig.resolve, Phase 2C)
    resetResolveState.ts          сброс статуса resolve-ноды в idle
    types.ts                      Resolve, ResolveDeps, ResolveState, ResolveStatus, ResolveErrorContext
  entityRegistry/
    entityRegistry.ts   класс EntityRegistry: upsert, get, delete, bind/unbind,
                        markResolved/isResolved/clearResolved, rekey, registerList
    generateId.ts       генерация временного ID (`_tmp_<ts_base36>_<rand8>_<seq>`)
    index.ts            реэкспорты
    types.ts            EntityNode, EntityLeafNode, EntityGroupNode, EntityData
  store/
    NodeRegistry/
      nodeRegistry.ts   класс NodeRegistry (listStates: WeakMap, allListStates: ListState[])
      nodeUtils.ts      isLeaf (реэкспорт из traversal), isGroup, isListNode (length 1-2),
                        NodeUtils class — используется в buildProxy / computeProxyKeys
    dirtyTracker.ts           класс DirtyTracker: initialValueMap(getter), capture, merge, collectSnapshot
    groupDepsMap.ts           класс GroupDepsMap: deps (Set<string>), isBuilt, getTrackingWrap(), markBuilt()
    hasComputedProps.ts       проверка: есть ли computed-свойства у группы
    index.ts                  Palistor + реэкспорты публичных типов
    nodeMap.ts                buildNodeMaps: nodePaths + nodeParents
    palistor.ts               класс Palistor: kernel + ProxyStore (главный класс системы)
    registerNodes.ts          инициализация leafNodes + nodeState (ListNode guard → ListState)
    serviceRegistry.ts        класс ServiceRegistry: translator, notifier, делегаты
    types.ts                  ConfigNode, ProxyStore, ListState, ListConfig и др.
  submitPipeline/
    applyLeafBeforeSubmit.ts  leaf-level beforeSubmit на snapshot
    collectLeafStates.ts      сбор состояний листьев (для проверки ошибок)
    getSubValues.ts           извлечение values поддерева
    submitPipeline.ts         класс SubmitPipeline
    types.ts                  SubmitResult: `{ success: true; result? }` | `{ success: false; errors: {path, message}[] }`
  valuesCache/
    valuesCache.ts            buildValuesCache + updateValuesCacheEntry (O(1))
  writePipeline/
    formatPatch.ts            рекурсивное форматирование патча через formatters
    formatValue.ts            форматирование одного значения через node.formatter
    mergeChanged.ts           объединение наборов изменённых узлов
    runSetter.ts              вызов node.setter → applyPatch зависимых полей
    storeValue.ts             запись value в nodeState + updateValuesCacheEntry
    types.ts                  WriteDeps, WriteResult, Setter
    writePipeline.ts          класс WritePipeline
react/
  useForm.ts                  useSyncExternalStore + tracking proxy
  createTrackingProxy.ts      Proxy слой 2: запись accessed нод
  useTranslator.ts            регистрация функции перевода (i18n);
                              setTranslator(t) → hub.bumpLeafVersions() при смене (инкрементирует
                              версии всех leaf-нод → ре-рендер компонентов с переводимыми полями)
  useNotifier.ts              регистрация функции уведомлений (toast)
  usePersist.ts               React-хук для подключения persist
```

---

## Traversal Layer — слоёная архитектура обхода дерева

Конфиг-дерево обходится во многих местах системы (init, reset, dirty, submit, valuesCache и др.).
Чтобы устранить дублирование классификационного паттерна, введён выделенный модуль `store/traversal/`.

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: Actions (конкретные операции)              │
│  recomputeDirtyTargeted, collectDefaults, buildValuesCache,  │
│  captureInitialValues, collectLeafStates, …          │
├─────────────────────────────────────────────────────┤
│  Layer 2: walkFull(node, visitor, path?)             │
│  Универсальный обход дерева с visitor-паттерном      │
├─────────────────────────────────────────────────────┤
│  Layer 1: Node Classifier                            │
│  isLeaf(), isGroup(), isListNode(), configKeys()     │
└─────────────────────────────────────────────────────┘
```

### Layer 1: Node Classifier (`traversal/nodeClassifier.ts`)

| Функция | Описание |
|---|---|
| `isLeaf(node)` | `true` если объект имеет поле `"value"` |
| `isGroup(node)` | `true` если объект не массив и не имеет `"value"` |
| `isListNode(node)` | `true` если `Array.isArray(node)` (любой массив) |
| `configKeys(node)` | `Object.keys(node)` с фильтром `CONFIG_PROPS` — заменяет повторяющийся boilerplate |

> **Различие `isListNode`:** `traversal.isListNode` = любой массив. `nodeUtils.isListNode` = массив длиной 1–2 (строгая проверка для proxy/ownKeys). Используются в разных слоях намеренно.

### Layer 2: walkFull (`traversal/walkFull.ts`)

Универсальный обход полного дерева конфига с visitor-паттерном.
Подходит для операций, которые не строят вложенный результат.

```ts
walkFull(node, visitor, parentPath?)

interface TreeVisitor {
  onLeaf(node, key, path, parent): void;          // обязателен
  onGroupEnter?(node, key, path, parent): boolean | void;  // false → skip subtree
  onGroupExit?(node, key, path, parent): void;    // для агрегации снизу вверх
  onList?(node, key, path, parent): void;         // если не задан — list пропускается
}
```

**Кто использует `walkFull`:** `captureInitialValues`, `collectLeafStates`, `initGroupSubmitting`.

**Кто использует только Layer 1 (`configKeys` / `isLeaf` / `isListNode`):** функции, которые строят вложенный результат (рекурсия + объект-аккумулятор) — `collectDefaults`, `collectInitialSnapshot`, `buildValuesCache`, `recomputeDirtyTargeted`, `setGroupRevalidate`, `createGroupDeps`.

**Параллельный обход (config + patch):** `formatPatch`, `applyPatch`, `mergeInitialValues` — итерируют по ключам patch, поэтому `configKeys()` не используется, только `isLeaf`/`isListNode` из traversal.

---

## DirtyTracking — отслеживание изменений

`DirtyTracker` (`store/store/dirtyTracker.ts`) — класс, инкапсулирующий `initialValueMap: WeakMap<node, unknown>`.
Методы:

| Метод | Описание |
|---|---|
| `capture(node, nodeState)` | Снимок initial values через `walkFull` → записывает `state.value` в `initialValueMap`. Вызывается после init и после reset. |
| `merge(node, nodeState, patch)` | Обновляет baseline по патчу — только узлы из patch. Вызывается после успешного resolve (чтобы resolver-данные не считались «dirty»). |
| `collectSnapshot(node)` | Вложенный снапшот `initialValueMap` для подтерева — используется `buildResetPatch` при сбросе. |
| `initialValueMap` (getter) | Прямой доступ к WeakMap — для модулей, принимающих deps-интерфейс. |

### recomputeDirtyTargeted — алгоритм

```
WritePipeline/onChange возвращает changedNodes
  │
  └─ recomputeDirtyTargeted(changedNodes, ...):
       │
       ├─ 1. Для каждого ЛИСТА из changedNodes:
       │      isDirtyValue(state.value, initialValueMap.get(leaf))
       │      → leaf.dirty изменился → Set changed, запомнить groupPath
       │
       ├─ 2. BFS по affected group paths:
       │      для каждой группы → aggregate anyChildDirty из immediate children
       │      (isLeaf: dirty flag; isListNode: !arraysEqual(itemIds, initialItemIds))
       │      → обновить group.dirty; если изменилось → bubble-up родителю в очередь
       │      (bubble-up: nodeParents.get(groupNode) → parentPath → queue)
       │
       └─ 3. Возвращает { anyDirty: boolean, changed: Set<object> }
              changed → notifyChanged → bumpVersion → React snapshot
```

### isDirtyValue — алгоритм

```ts
isDirtyValue(current, initial):
  === → false
  null == undefined (оба empty) → false
  один null/undefined → true
  разные typeof → true
  typeof === "object" → JSON.stringify comparison (fallback: true при ошибке)
  иначе → true
```

---

## valuesCache — снапшот значений формы

Глобально-актуальный мутабельный объект, зеркалирующий `value` всех листовых узлов.
Читается синхронно за O(1) — вместо обхода дерева при каждом computed/validate.

```
buildValuesCache(rootConfig, nodeState)
  └─ обходит дерево один раз → строит { values, nodeSlot, groupSlot }
       ├─ values     — вложенный объект { email: "…", passport: { number: "…" } }
       │               Мутируется в-месте (in-place) — стабильная ссылка навсегда
       ├─ nodeSlot   — WeakMap<node, { parent, key }> для O(1) обновлений
       │               Заполняется для листовых узлов И для групп (virtual leaves).
       │               Для групп: parent = объект значений родительской группы.
       │               Используется в recomputeLeaves для получения group-scoped values.
       └─ groupSlot  — WeakMap<groupNode, Record<string, unknown>>
                       Маппинг каждого группового узла → соответствующий вложенный
                       объект внутри values. Используется proxy для реализации
                       group.values: proxy.passport.values === groupSlot.get(passportNode).
                       Та же live-ссылка, что обновляется при каждой записи поля.

updateValuesCacheEntry(cache, node, newValue)
  └─ nodeSlot.get(node) → slot.parent[slot.key] = newValue   // O(1)
```

Обновление происходит в `storeValue` при каждой записи. Все computed/validate/setter
получают group-scoped values из `nodeSlot.get(node)?.parent` как `allValues` — значения
родительской группы (для корневых полей совпадает с `valuesCache.values`).

**Списки в valuesCache:** ListNode при обходе дерева получает пустой массив `[]`.
`nodeSlot` регистрируется на объект-массив (а не на leaf-ноду). После каждой
мутации списка (`add`, `remove`, `setItems`) вызывается `_syncListValuesCache` (приватный метод Palistor),
который перестраивает `slot.parent[slot.key]` из `listState.itemIds` → массив
POJO-зеркал (`entityProjectionObjs`). Это позволяет computed-выражениям вида
`isVisible: (values) => values.users.length > 0` работать корректно.

---

## Palistor.recompute() — таргетированный пересчёт

### Два режима одной функции

```ts
// Метод Palistor
recompute(changedNodes?: Set<object>): Set<object> {
  if (changedNodes && changedNodes.size > 0) {
    return recomputeTargeted(changedNodes, deps); // горячий путь
  }
  // Полный путь: собрать все листья и пересчитать
  const leafNodes = collectGroupLeafNodes(rootConfig, groupLeafMap);
  return recomputeLeaves(leafNodes, nodeState, valuesCache, translate, trackingWrap?);
}
```

- **С `changedNodes`** — таргетированный пересчёт (write, onChange, resolve)
- **Без аргументов** — полный пересчёт (init, reset, submit, persist hydrate)

### groupDeps — карта зависимостей между группами

Строится автоматически при первом (init) `recompute()` через трекинг GET-доступов:

```
groupDeps: Set<string>   — пары "донор→реципиент" в формате pairKey(donor, recipient)

  При init: каждый лист вычисляет свои computed/flags через trackingValues-proxy,
  который перехватывает чтения значений из других групп и записывает пару.

  Пример: поле passport.city читает values.address.country
    → donor = "address", recipient = "passport"
    → groupDeps.add("address→passport")

  Self-зависимость добавляется явно при createGroupDeps:
    → groupDeps.add("address→address"), "passport→passport", "→" (root)
```

### `recomputeTargeted` — алгоритм

```
SET passport.number = "123456"
  │
  ├─ changedNodes = {passportNumberNode}
  │
  └─ recomputeTargeted(changedNodes):
       │
       ├─ 1. Source groups: {passportNumberNode} → {"passport"}
       │     (через nodeParents + nodePaths)
       │
       ├─ 2. BFS по groupDeps:
       │     "passport" → все реципиенты → …
       │     orderedGroups = ["passport", "calculator", ...]
       │     (топологический порядок: доноры раньше реципиентов)
       │
       └─ 3. Пересчёт OWN листьев каждой группы:
             recomputeLeaves(groupLeafMap.get(groupNode))
               ├─ Фаза 1: topo-sort computed → пересчёт value
               └─ Фаза 2: computeFieldState для всех листьев группы
```

### Визуально: было vs. стало

```
BYLO (full recompute):

  SET passport.number = "123456"
    └─ пересчёт ВСЕХ 50 полей
         ├─ personal:  name, email, phone    ← впустую
         ├─ address:   country, city         ← впустую
         ├─ payment:   amount, type          ← впустую
         ├─ passport:  number, issue, expiry ← нужно
         └─ calculator: total                ← впустую

STALO (recomputeTargeted via recompute()):

  SET passport.number = "123456"
    ├─ sourceGroup = "passport"
    ├─ groupDeps → никто не зависит от passport
    └─ пересчёт только: passport (3 поля)
         Экономия: 94%
```

### recomputeLeaves — внутреннее устройство

```
recomputeLeaves(leafNodes[]):
  │
  ├─ Фаза 1: computed values
  │   ├─ filter leafNodes: только node.value === Function
  │   ├─ topologicalSortComputed(computedEntries)
  │   │     Алгоритм Кана (BFS по dependencies)
  │   │     Гарантирует порядок: subtotal → tax → total
  │   └─ для каждого в порядке сортировки:
  │       groupValues = nodeSlot.get(node)?.parent ?? valuesCache.values
  │       computedValue = node.value(groupValues)
  │       if changed → nodeState.set(...) + updateValuesCacheEntry O(1)
  │
  └─ Фаза 2: FieldState
      для каждого листа:
        computeFieldState(node, currentValue, allValues, revalidate, translate)
        if fieldStateChanged(prev, next) → nodeState.set(node, next)
      returns Set<object> изменённых узлов
```

### FieldState — полный интерфейс

```ts
interface FieldState {
  value: unknown;          // текущее значение (строка, число, любое)
  label?: string;          // вычисленная метка
  placeholder?: string;
  description?: string;
  isRequired: boolean;     // обязательное поле
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  isInvalid?: boolean;     // ошибка валидации (только если revalidate=true)
  errorMessage?: string;   // текст ошибки
  submitting?: boolean;    // только для групп: идёт submit
  dirty?: boolean;         // лист: ≠ initial; группа: хотя бы один dirty потомок
  revalidate?: boolean;    // группа: показывать ошибки? (false до первого submit)
  loading?: boolean;       // только для групп с resolve: идёт загрузка
}
```

### Call sites `recompute()`

```
1. Palistor constructor (init)    → полный — строит groupDeps через trackingWrap
2. WritePipeline.execute()        → таргетированный (changedNodes)
3. OnChangePipeline.fire()        → полный (onChange-патч может затронуть любые поля)
4. ResolvePipeline/executeResolve → полный (resolve меняет произвольные поля)
5. SubmitPipeline.execute (start) → полный (revalidate=true)
6. SubmitPipeline.execute (end)   → полный
7. ResetPipeline.execute()        → полный
8. PersistManager.enable() / .hydrate()   → полный (через private hydrateFromStorage)
9. Palistor.setValuesNode()       → полный (патч может быть любым)
10. ListProxy.add / remove / setItems     → полный (после каждой мутации списка: _syncListValuesCache → recompute() → notifyChanged)
```

---

## EntityRegistry — нормализованный реестр сущностей

Единственный источник правды для значений всех сущностей. Хранит `EntityNode` — дерево
leaf-нод вида `{ value: unknown }`. Каждая leaf-нода регистрируется в `nodeState`
через `registerDynamicLeaf`, что позволяет использовать стандартную инфраструктуру
(recompute, dirty, notification).

```
EntityRegistry
  ├─ entities: Map<string, EntityNode>          — все сущности по ID
  ├─ bindings: Map<string, Set<object>>         — entity → привязанные template-ноды
  ├─ resolvedCache: Map<string, Set<object>>    — entity+template → уже резолвились
  └─ registeredLists: Array<{ itemIds: string[] }> — для propagation при rekey

EntityNode:
  { id: { value: 'u1' }, name: { value: 'Alice' }, email: { value: '…' } }
  Вложенные группы: { address: { city: { value: '…' }, country: { value: '…' } } }
```

**Методы:**

| Метод | Описание |
|---|---|
| `upsert(data)` | Создать или слить entity по `data.id`. Рекурсивный merge: новые поля добавляются, существующие обновляются, отсутствующие не трогаются. Если `id` не задан — генерируется `_tmp_<ts_base36>_<rand8>_<seq>`. |
| `get(id)` | Получить EntityNode по ID |
| `delete(id)` | Удалить entity + очистить bindings + resolvedCache. Возвращает `boolean`. |
| `has(id)` | Проверить существование |
| `size` | Количество entity в реестре |
| `bind(id, templateNode)` | Зарегистрировать привязку entity↔template (вызывается из `useForm` на mount) |
| `unbind(id, templateNode)` | Снять привязку (вызывается из `useForm` на unmount) |
| `getBindings(id)` | Получить `ReadonlySet<object>` привязанных template-нод для entity |
| `markResolved(id, templateNode)` | Пометить пару entity+template как resolved |
| `isResolved(id, templateNode)` | Проверить resolved cache — skip resolve при повторном открытии |
| `clearResolved(id, templateNode?)` | Сбросить resolved cache |
| `rekey(oldId, newId)` | Переименовать entity: обновляет Map, id.value, bindings, resolvedCache и `itemIds` во всех зарегистрированных списках |
| `registerList(list)` | Зарегистрировать ListState для propagation при `rekey` |

---

## Списки (ListNode / ListState)

### Объявление в конфиге

ListNode — массив длины 1 или 2 (обнаруживается через `isListNode` из `nodeUtils.ts`):

```ts
// Минимальный — только template:
users: [{ id: { value: '' }, name: { value: '' } }]

// С конфигурацией списка:
users: [
  { id: { value: '' }, name: { value: '' } },
  { resolve: { resolver: async (values, store) => { … } } },
]
```

`array[0]` — **template**: обычная group-нода, описывает поля элемента. Все правила
(formatter, setter, validate, isRequired, onChange) работают на листьях template.  
`array[1]` (опционально) — **listConfig**: `ListConfig { resolve?: ListResolveConfig }` — единственное поле.

### ListState

Хранится в `NodeRegistry.listStates: WeakMap<object, ListState>` и `allListStates: ListState[]`.
Создаётся при `registerNodes` — один раз при инициализации store.

```ts
interface ListState {
  template: AnyConfigNode;          // child[0] — поля элемента
  listConfig: ListConfig | undefined; // child[1], опционально
  itemIds: string[];                // текущий состав: массив entity ID
  version: number;                  // инкрементируется при любой мутации
  initialItemIds: string[];         // снапшот при последнем «clean» состоянии (dirty baseline)
}
```

### ListProxy API

`buildProxy` при GET list-ноды возвращает `buildListProxy(listNode, kernel)`.
Proxy открывает ключи из `LIST_SPREAD_KEYS`:

| Ключ | Тип | Поведение |
|---|---|---|
| `items` | `ReadonlyArray<EntityProjectionProxy>` | Маппит `listState.itemIds` → `buildEntityProjectionProxy(…)`. Триггерит lazy resolve. |
| `length` | `number` | `listState.itemIds.length`. Триггерит lazy resolve. |
| `loading` | `boolean` | Из `nodeState` для list-ноды |
| `dirty` | `boolean` | `!arraysEqual(listState.itemIds, listState.initialItemIds)` |
| `add(id \| values)` | `fn` | Строка → добавить существующую entity по ID; объект → `kernel.set(values)` + добавить |
| `remove(id)` | `fn` | Убрать из `itemIds` (entity остаётся в registry) |
| `getById(id)` | `fn` | Найти EntityProjectionProxy в текущем списке |
| `setItems(ids)` | `fn` | Bulk-замена `listState.itemIds` |
| `map(fn)` | `fn` | `(fn: (item, index, id) => R): R[]` — для React-рендера |
| `[Symbol.iterator]` | | Итерация по entity-proxy |

После каждой мутации вызывается `syncListValuesCache` + `kernel.recompute()` + `kernel.notifyChanged()`.

### Lazy resolve для списков

При доступе к `items`, `length` или `map` proxy проверяет: если `listConfig.resolve` задан
и `resolveState.status === "idle"` — вызывает `kernel.resolveManager.triggerResolve(listNode)`.
Стандартный resolve pipeline выполняет `entityRegistry.upsert()` для каждого элемента и
заполняет `listState.itemIds`.

### Dirty списков

`dirty = !arraysEqual(listState.itemIds, listState.initialItemIds)` — только по составу
(порядок важен). Dirty по значениям внутри элементов — это dirty на уровне entity leaf-нод.
При `captureInitialValues` ListNode пропускается; `initialItemIds` обновляется явно
через reset pipeline или после resolve.

---

## EntityProjectionProxy

**EntityProjectionProxy** — proxy поверх `EntityNode` через template. Используется для
элементов списка и для `useForm(entity, templateSelector)`.

### buildEntityProjectionProxy

```
buildEntityProjectionProxy(entityNode, templateNode, kernel, entityProxyCache, leafProxyCache)
  └─ для каждого ключа templateNode → buildEntityLeafProxy(entityNode[key], templateField, …)
```

`buildEntityLeafProxy` строит leaf proxy, где GET-трапы:
- `value` → читает `entityLeaf.value` (или из `nodeState`, если leaf зарегистрирован)
- `label/placeholder/description` → из templateField (строка или функция `(translate, entityValues)` — два аргумента)
- `isRequired/isReadOnly/isDisabled/isVisible` → bool или функция `(entityValues)`
- `isInvalid/errorMessage` → вызывает `templateField.validate(value, entityValues, translate)`
- `dirty` → из `nodeState` (заполняется `recomputeDirtyTargeted`)
- `onValueChange` → fn, вызывающий `writeEntityLeafValue`

`ownKeys` листового proxy: `value, label, placeholder, description, isRequired, isReadOnly, isDisabled, isVisible, isInvalid, errorMessage, dirty, onValueChange`  
(≠ FIELD_STATE_PROPS: включает `onValueChange`, не включает `loading`)

SET trap на `"value"` → `writeEntityLeafValue`:
1. `formatValue(rawValue, templateField, entityValues)` — formatter из template
2. `Object.is(formatted, current)` → skip если не изменилось
3. `storeValue(...)` — записывает в `nodeState` + `updateValuesCacheEntry` через nodeSlot
4. `templateField.setter(value, entityValues, prev)` → applyPatch к sibling-нодам entity
5. `kernel.recompute(changedNodes)` + `kernel.notifyChanged(allChanged)`

**Root entity proxy** (только если `"id" in entityNode`) дополнительно экспортирует через `ownKeys`:
- `id` → значение из nodeState (строка), не через leaf proxy
- `loading` / `submitting` → из `_getEntityBindingState(entityId, templateNode)` (внутренний Map)
- `submit` → `kernel.executeEntityTemplateSubmit(entityId, templateNode, proxy)`

**Вложенные группы:** если поле templateNode — это group-нода (нет `"value"`), proxy рекурсивно
строит `buildEntityProjectionProxy(entityField, templateField, …)` вместо `buildEntityLeafProxy`.  
**Phantom leaves:** если в entityNode поля нет, но в template оно есть — создаётся временный
`{ value: templateField.value }` и оборачивается в leaf proxy (без кэширования).

На entity proxy дополнительно доступны `ENTITY_ID` (symbol → entityId) и
`STORE_REF` (symbol → kernel) — для извлечения в `useForm(entity, templateSelector)`.

---

## store.set() / store.delete() / store.rekey() / store.invalidate()

Публичные методы `Palistor` для управления entity-данными.

### store.set(data | data[])

```
store.set({ id: 'u1', name: 'Alice', email: 'alice@corp.com' })
  │
  ├─ entityRegistry.upsert(item) → EntityNode
  ├─ getOrCreate entityProjectionObj (POJO-зеркало для valuesCache)
  ├─ walkAndSyncEntityNode():
  │    ├─ Новые leaf-ноды → nodes.registerDynamicLeaf(…)
  │    │                    + nodeSlot → projectionObj для O(1) updates
  │    └─ Существующие leaf-ноды → обновить state.value + updateValuesCacheEntry
  └─ batch: один recompute() + notifyChanged() для всего массива
```

Принимает одиночный объект или массив — батчится: один recompute/notify на весь батч.

### store.delete(id)

```
store.delete('u1')
  ├─ collectEntityLeaves(entityNode) → все leaf-ноды entity
  ├─ nodes.unregisterLeaf(leaf) для каждой — предотвращает утечки памяти
  ├─ entityRegistry.delete(id) — удалить + очистить bindings + resolvedCache
  └─ notifyChanged(deletedLeaves)
```

Entity не удаляется из списков автоматически — это ответственность вызывающего кода.

### store.rekey(oldId, newId)

Переименовывает entity (например temp → real ID после сохранения на сервере):
1. `entityRegistry.rekey(oldId, newId)` — обновляет Map, id.value, bindings, resolvedCache,
   `itemIds` во всех зарегистрированных ListState
2. Переносит запись в `entityProjectionObjs`
3. Обновляет `nodeState` для id.value leaf
4. `recompute(changedNodes)` → merge changedNodes в результат
5. `notifyChanged(merged)`

### store.invalidate(id, templateNode?)

Сбрасывает resolved cache для entity (одного template или всех). Следующий `useForm(entity, selector)`
заново запустит resolve. При `store.set()` resolved cache **не** сбрасывается — данные совместимы.

---

## Persist

`PersistManager` создаётся внутри Palistor при инициализации и активируется через `persist.enable(options)` из `usePersist` хука.

### PersistDriver

```ts
interface PersistDriver {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

Встроенные реализации: `localStorageDriver`, `sessionStorageDriver` (экспортируются из root `index.ts`).

### PersistOptions

```ts
interface PersistOptions {
  key: string;           // уникальный ключ хранения
  driver: PersistDriver;
  serialize?: (values) => string;   // по умолчанию JSON.stringify
  deserialize?: (raw) => object;    // по умолчанию JSON.parse
  debounce?: number;                // задержка auto-save в ms (по умолчанию 100)
  pick?: string[];    // персистить только указанные поля верхнего уровня
  omit?: string[];    // исключить указанные поля (игнорируется если задано pick)
}
```

### PersistManager API

| Метод | Описание |
|---|---|
| `enable(options): Promise<void>` | Активировать: гидратация из storage + auto-save при изменениях |
| `disable(): void` | Деактивировать: отписка от store, отмена таймеров |
| `flush(): Promise<void>` | Принудительно сохранить без debounce |
| `hydrate(): Promise<void>` | Принудительно перечитать из storage и применить |
| `clear(): Promise<void>` | Удалить данные по текущему ключу |
| `isEnabled(): boolean` | Активна ли персистенция в данный момент |

Жизненный цикл через `usePersist`:
- **mount** → `store.persist.enable(options)` (hydrate + auto-save subscribe)
- **unmount** → `store.persist.flush()` + `store.persist.disable()`

---

## useForm: режим entity

```ts
// Стандартный режим (без изменений):
const form = useForm(store);
const section = useForm(form.passport);

// Новый: entity + template selector
const u = useForm(entityProxy, (store) => store.editUserForm);
```

`entityProxy` — объект из `list.items[i]` или `list.getById(id)`.
`templateSelector` — функция, возвращающая поддерево store-proxy (групп-нода).

**Поведение:**

```
useForm(entityProxy, (s) => s.editUserForm)
  │
  ├─ Извлечь entityId = entityProxy[ENTITY_ID]
  ├─ Извлечь entityStore = entityProxy[STORE_REF]
  ├─ templateNode = templateSelector(entityStore.proxy)[CONFIG_NODE]
  ├─ entityNode = entityStore.entityRegistry.get(entityId)
  ├─ Построить entityProxy = buildEntityProjectionProxy(entityNode, templateNode, …)
  │
  ├─ useEffect mount:
  │    ├─ entityRegistry.bind(entityId, templateNode)
  │    └─ if !isResolved → triggerEntityTemplateResolve(entityId, templateNode, entityProxy)
  │
  ├─ useEffect cleanup (unmount):
  │    └─ entityRegistry.unbind(entityId, templateNode)
  │       (resolved cache ОСТАЁТСЯ — повторное открытие мгновенно)
  │
  └─ return createTrackingProxy(entityProxy, …) — независимый ре-рендер
```

Resolved cache: `isResolved(entityId, templateNode) → true` при повторном открытии той же
entity+template → resolve пропускается, форма показывает данные мгновенно.

Два `useForm` с одной entity+template одновременно не поддерживаются — второй получит
`loading: true` пока первый pending.

---

## Ключевые инварианты

| Принцип | Реализация |
|---|---|
| Конфиг неизменяем | `rootConfig` никогда не мутируется |
| Один прокси на узел | `proxyCache: WeakMap` |
| Стабильные ссылки | `WeakMap`-кэши для onValueChange / submit / reset / setValues |
| Точечные ре-рендеры | tracking proxy + `nodeVersions` |
| Иммутабельный FieldState | `nodeState.set(node, { ...old, value: new })` |
| Resolve без лишних ре-рендеров | batch: буфер writes + один flush + один notifyChanged |
| Resolve дедупликация | pending status → не запускаем повторно |
| Ошибки resolve без throw | `onError` callback + реактивные `isInvalid`/`errorMessage` |
| Одна entity — одна запись | EntityRegistry: Map<id, EntityNode>, без дублирования данных |
| Shared leaf nodes | Entity leaf — один объект в памяти для всех views и списков |
| ListNode пропускается applyPatch | Arrays: `if (Array.isArray(child)) continue` в applyPatch |
| List dirty — только по составу | `!arraysEqual(itemIds, initialItemIds)` — порядок важен |
| Resolved cache переживает unmount | `unbind` не трогает resolvedCache → повторное открытие мгновенно |

---

## Palistor + useForm

`new Palistor(options)` — создаёт экземпляр формы.  
`useForm(store | subtree)` — React-хук, подключает компонент к store через tracking proxy.  
`useForm(entityProxy, templateSelector)` — привязка entity из списка к template.

```ts
// Создание store (вне React)
const store = new Palistor<Config>({
  config: orderConfig,
  initialValues: { email: "user@example.com" },
});

// Корневой компонент
function App() {
  useTranslator(store, useTranslations());  // i18n
  useNotifier(store, notifyError);          // toast для resolve onError
  usePersist(store, { key: "order", driver: localStorageDriver });

  const form = useForm(store);
  return <PassportSection passport={form.passport} />;
}

// Вложенный компонент — принимает поддерево из пропса
function PassportSection({ passport }) {
  const p = useForm(passport);  // ← независимый tracking proxy
  if (!p.isVisible) return null;
  return <input value={p.number.value} onChange={e => { p.number.value = e.target.value }} />;
}

// Список — итерация через list.map
function UserList({ users }) {
  const form = useForm(store);
  return (
    <ul>
      {form.users.map((user, i) => (
        <UserRow key={form.users.items[i][ENTITY_ID]} user={user} />
      ))}
    </ul>
  );
}

// Форма редактирования — entity mode useForm
function EditUserModal({ userProxy }) {
  // userProxy — из form.users.items[i] или form.users.getById(id)
  const u = useForm(userProxy, (s) => s.editUserForm);
  // u.name.value, u.email.value — entity leaf-ноды через template
  return <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />;
}
```

**Ключевые решения:**
- Состояние вне React — React подписывается через `useSyncExternalStore`
- i18n / notifications подключаются хуками (`useTranslator`, `useNotifier`), не провайдером
- `useForm(subtree)` принимает tracking proxy поддерево → независимый ре-рендер
- Колбэки submit/reset/onChange задаются в конфиге, не при вызове useForm
- `{...form.email}` — spread-safe: скрывает validate/formatter/setter через ownKeys
- Entity mode: `useForm(entityProxy, selector)` — bind на mount, unbind на unmount, resolved cache после unmount сохраняется

---

## Публичный API (импорты)

Palistor не имеет единого barrel-экспорта для всего. Точки входа:

### `@palistor` (root `index.ts`) — типы

```ts
// Типы конфига и proxy
import type {
  FormConfig, TranslateFn, MaybeComputed, DeepPartialValues, FieldTypeMeta,
  ConfigNode, FieldProxyNode, GroupProxyNode, ConfigProxy,
  ExtractValues, ProxyStoreOptions, ProxyStore, Unsubscribe,
} from "@palistor";

// Типы resolve
import type { Resolve, NotifyFn, ResolveErrorContext } from "@palistor";

// Типы persist
import type { PersistDriver, PersistOptions, PersistManager } from "@palistor";

// value-экспорты из root
import { useNotifier } from "@palistor";
import { localStorageDriver, sessionStorageDriver } from "@palistor"; // также доступны из @palistor/store/persist
```

### `@palistor/store/store` — класс Palistor

```ts
import { Palistor } from "@palistor/store/store";
```

### `@palistor/react/*` — React хуки

```ts
import { useForm } from "@palistor/react/useForm";
import { usePersist } from "@palistor/react/usePersist";
import { useTranslator } from "@palistor/react/useTranslator";
```

### `@palistor/store/persist` — persist drivers

```ts
import { localStorageDriver, sessionStorageDriver } from "@palistor/store/persist";
```

> **Примечание:** Использование subpath imports (`/store/store`, `/react/useForm`) вместо barrel
> объясняется тем, что root `index.ts` задумывался как только-типы, а конкретные реализации
> подключаются напрямую по субпути. Символы `ENTITY_ID` и `STORE_REF` импортируются как
> `import { ENTITY_ID, STORE_REF } from "@palistor/store/constants"` при необходимости прямого доступа.


