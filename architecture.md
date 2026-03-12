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
│  • GET дочернего ключа → рекурсивный store proxy        │
│  • GET на группу с resolve (idle) → triggerResolve      │
│  • GET на группу с resolve (pending + suspense)         │
│    → throw promise (React Suspense)                     │
│  • SET "value" → запускает Write Pipeline               │
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
  ├─ @internal dirty         DirtyTracker   — initialValueMap, capture, merge, recompute
  ├─ @internal values        ValuesCache    — мутабельный снапшот values
  ├─ @internal groupDepsMap  GroupDepsMap   — deps, trackingWrap, isBuilt
  ├─ @internal hub           NotificationHub — версии, подписки, postNotifyHook
  ├─ @internal resolveManager ResolveManager — trigger, retrigger, eager launch
  │
  ├─ @internal writePipeline    WritePipeline(kernel)
  ├─ @internal resetPipeline    ResetPipeline(kernel)
  ├─ @internal submitPipeline   SubmitPipeline(kernel)
  ├─ @internal onChangePipeline OnChangePipeline(kernel)
  ├─ @internal proxyBuilder     ProxyBuilder(kernel)
  │
  └─ @internal persist       PersistManager(kernel)  — lazy, не активен до usePersist
```

Все пайплайны принимают `kernel` (Palistor) в конструкторе и читают из него нужные
подсистемы напрямую — без россыпи deps-аргументов.

`createProxyStore(options)` — устаревший алиас → `return new Palistor(options)`.

---

## Write Pipeline

```
form.email.value = "X"   (SET trap в buildProxy)
  │
  ├─ 1. formatValue()       node.formatter(raw, allValues)
  ├─ 1.5 skip?              Object.is(formatted, current) → skipped (warn)
  ├─ 2. storeValue()        nodeState.set(node, { ...state, value })
  │                         + updateValuesCacheEntry O(1)
  ├─ 3. runSetter()         node.setter(value, allValues, prev) → patch → applyPatch()
  ├─ 4. recomputeAll(changedNodes)  таргетированный пересчёт групп
  ├─ 5. notifyChanged()
  │      ├─ recomputeDirty
  │      ├─ nodeVersions[node]++ для changed-нод
  │      ├─ globalListeners → useSyncExternalStore → getSnapshot()
  │      └─ postNotifyHook → findResolvesToRetrigger → resetResolveState → triggerResolve
  └─ 6. onFieldChange()     fire-and-forget onChange (поднимается к предкам)
```

---

## Submit Pipeline

```
form.submit()                (executeSubmit)
  ├─ 1. submitting = true, setGroupRevalidate(true) → recomputeAll → notifyChanged
  ├─ 2. applyLeafBeforeSubmit()   leaf-level beforeSubmit на snapshot
  ├─ 4. group beforeSubmit()      group-level beforeSubmit
  ├─ 5. collectLeafStates() → есть ошибки? → { success: false, errors }
  ├─ 6. onSubmit(values) → result
  ├─ 7. afterSubmit(result, { reset })
  ├─ 8. clearPersist()
  └─ finally: submitting = false → recomputeAll → notifyChanged
```

---

## Resolve Pipeline

```
GET form.car → узел idle → triggerResolve()
  ├─ optimisticResolver → applyPatch, loading: true, notifyChanged
  └─ resolver(trackingProxy)         ← auto-deps: read → accessedPaths, write → buffer
       ├─ OK  → batch flush: applyPatch(result) + buffered writes, loading: false,
       │        status: resolved, save auto-deps, mergeInitialValues (dirty baseline),
       │        recomputeAll, notifyChanged (1 раз)
       ├─ ERR → retry до attempts раз (delay ms) → при исчерпании:
       │        onError(err, { notify }), loading: false, status: error
       └─ always: recomputeAll + notifyChanged

Deps: явные (config) ∪ auto-deps (из tracking proxy resolver'а)
При изменении dep: notifyChanged → findResolvesToRetrigger → resetResolveState → triggerResolve

Suspense: status === "pending" → throw promise → React <Suspense> ловит
Ошибки: НИКОГДА не бросаются — только реактивно через form.car.isInvalid
```

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
  constants.ts              символы CONFIG_NODE / SOURCE_PROXY / STORE_REF,
                            наборы FIELD_STATE_PROPS / CONFIG_PROPS /
                            INTERNAL_CONFIG_KEYS / GROUP_SPREAD_KEYS
  applyPatch/
    applyPatch.ts           применение патчей к дереву nodeState + valuesCache
  buildProxy/
    buildProxy.ts           Proxy слой 1: createBuildProxy (fn) + ProxyBuilder (class)
    computeProxyKeys.ts     ownKeys для spread (field / group)
    handleLazyResolve.ts    lazy resolve trigger при GET группы
    initProxyCaches.ts      WeakMap-кэши (onValueChange, submit, reset)
  compute/
    computeFieldState.ts    вычисление FieldState одного узла
    fieldStateChanged.ts    сравнение двух FieldState (для skip notify)
    isEmpty.ts              утилита проверки пустоты значения
    resolveFlag.ts          resolve флага (bool | fn → bool)
    resolveString.ts        resolve строки (string | fn → string) + translate
    types.ts                FieldState + вспомогательные типы
    recompute/
      collectGroupLeafNodes.ts  сбор OWN листьев группы (не рекурсивно)
      recomputeAll.ts           полный пересчёт всего дерева (делегирует recomputeGroup)
      recomputeAndNotify.ts     хелпер: recomputeAll → merge → notifyChanged
      recomputeGroup.ts         рекурсивный пересчёт поддерева
      recomputeLeaves.ts        пересчёт списка листьев (computed + fieldState)
      recomputeTargeted.ts      таргетированный пересчёт по groupDeps (BFS)
      topologicalSortComputed.ts  алгоритм Кана для computed-узлов
      types.ts                  TrackingWrap + RecomputeTargetedDeps
  dirtyTracking/
    captureInitialValues.ts   снимок initial values для dirty baseline
    collectInitialSnapshot.ts сбор плоского снапшота дерева
    isDirtyValue.ts           сравнение value с initial (dirty check)
    mergeInitialValues.ts     обновление baseline после resolve
    recomputeDirty.ts         пересчёт флага dirty для каждого листа
    setGroupRevalidate.ts     выставление revalidate=true для группы (submit)
  groupDeps/
    createGroupDeps.ts        начальная карта self-зависимостей групп
    createTrackingValues.ts   proxy для перехвата кросс-групповых READ-доступов
    getNodeGroupPath.ts       путь группы для произвольного узла
    getRecipientGroups.ts     реципиенты группы из groupDeps
    pairKey.ts                сериализация пары donor→recipient
    resolveGroupByPath.ts     config-узел группы по строковому пути
  init/
    createNotificationHub.ts  класс NotificationHub: версионирование + подписки + dirty
    createResolveManager.ts   класс ResolveManager: trigger, retrigger, eager launch
    initGroupSubmitting.ts    submitting/dirty/revalidate для групповых узлов
  onChangePipeline/
    computeFieldKey.ts        вычисление fieldKey для onChange
    findOnChangeAncestors.ts  поиск предков с onChange-хэндлером
    onChangePipeline.ts       класс OnChangePipeline + executeOnChange (fn)
  persist/
    drivers.ts                localStorage / sessionStorage drivers
    persistManager.ts         класс PersistManager: hydrate, flush, clear (принимает kernel)
    types.ts                  PersistDriver + PersistOptions
  resetPipeline/
    buildResetPatch.ts        построение патча сброса из defaults + overrides
    collectDefaults.ts        сбор дефолтных значений дерева
    resetPipeline.ts          класс ResetPipeline + executeReset (fn)
  resolvePipeline/
    applyPendingWrites.ts     сброс буфера write-операций после resolve
    createValuesTrackingProxy.ts  tracking write-proxy для resolver (auto-deps)
    executeResolve.ts         основная логика: init → optimistic → async → retry
    findResolvesToRetrigger.ts  поиск resolve-нод, зависящих от changedPaths
    initResolveStates.ts      инициализация resolveStates при старте
    resetResolveState.ts      сброс статуса resolve-ноды в idle
    types.ts                  Resolve, ResolveDeps, ResolveState
  store/
    dirtyTracker.ts           класс DirtyTracker: initialValueMap, capture, merge, recompute
    groupDepsMap.ts           класс GroupDepsMap: deps, trackingWrap, isBuilt
    hasComputedProps.ts       проверка: есть ли computed-свойства у группы
    index.ts                  createProxyStore (deprecated alias → new Palistor) + реэкспорты
    nodeMap.ts                buildNodeMaps: nodePaths + nodeParents
    nodeRegistry.ts           класс NodeRegistry: nodeState, proxyCache, paths, parents, leaves
    palistor.ts               класс Palistor: kernel + ProxyStore (главный класс системы)
    registerNodes.ts          инициализация leafNodes + nodeState
    serviceRegistry.ts        класс ServiceRegistry: translator, notifier, делегаты
    types.ts                  ConfigNode, ProxyStore, ExtractValues и др.
  submitPipeline/
    applyLeafBeforeSubmit.ts  leaf-level beforeSubmit на snapshot
    collectLeafStates.ts      сбор состояний листьев (для проверки ошибок)
    getSubValues.ts           извлечение values поддерева
    submitPipeline.ts         класс SubmitPipeline + executeSubmit (fn)
    types.ts                  SubmitDeps, SubmitResult
  valuesCache/
    valuesCache.ts            buildValuesCache + updateValuesCacheEntry (O(1))
  writePipeline/
    formatPatch.ts            рекурсивное форматирование патча через formatters
    formatValue.ts            форматирование одного значения через node.formatter
    mergeChanged.ts           объединение наборов изменённых узлов
    runSetter.ts              вызов node.setter → applyPatch зависимых полей
    storeValue.ts             запись value в nodeState + updateValuesCacheEntry
    types.ts                  WriteDeps, WriteResult, Setter
    writePipeline.ts          класс WritePipeline + writeValue (fn)
react/
  useForm.ts                  useSyncExternalStore + tracking proxy
  createTrackingProxy.ts      Proxy слой 2: запись accessed нод
  useTranslator.ts            регистрация функции перевода (i18n)
  useNotifier.ts              регистрация функции уведомлений (toast)
  usePersist.ts               React-хук для подключения persist
```

---

## valuesCache — снапшот значений формы

Глобально-актуальный мутабельный объект, зеркалирующий `value` всех листовых узлов.
Читается синхронно за O(1) — вместо обхода дерева при каждом computed/validate.

```
buildValuesCache(rootConfig, nodeState)
  └─ обходит дерево один раз → строит { values, nodeSlot }
       ├─ values    — вложенный объект { email: "…", passport: { number: "…" } }
       │              Мутируется в-месте (in-place) — стабильная ссылка навсегда
       └─ nodeSlot  — WeakMap<node, { parent, key }> для O(1) обновлений

updateValuesCacheEntry(cache, node, newValue)
  └─ nodeSlot.get(node) → slot.parent[slot.key] = newValue   // O(1)
```

Обновление происходит в `storeValue` при каждой записи. Все computed/validate/setter
получают `valuesCache.values` как `allValues` — всегда актуальный снапшот.

---

## recomputeAll — таргетированный пересчёт

### Два режима одной функции

```ts
// Замыкание в store/index.ts
function recomputeAll(changedNodes?: Set<object>): Set<object> {
  if (changedNodes && changedNodes.size > 0) {
    return recomputeTargeted(changedNodes, deps); // горячий путь
  }
  return _recomputeAll(rootConfig, groupLeafMap, nodeState, ...); // полный
}
```

- **С `changedNodes`** — таргетированный пересчёт (write, onChange, resolve)
- **Без аргументов** — полный пересчёт (init, reset, submit, persist hydrate)

### groupDeps — карта зависимостей между группами

Строится автоматически при первом (init) `recomputeAll` через трекинг GET-доступов:

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
БЫЛО (recomputeAll):

  SET passport.number = "123456"
    └─ пересчёт ВСЕХ 50 полей
         ├─ personal:  name, email, phone    ← впустую
         ├─ address:   country, city         ← впустую
         ├─ payment:   amount, type          ← впустую
         ├─ passport:  number, issue, expiry ← нужно
         └─ calculator: total                ← впустую

СТАЛО (recomputeTargeted):

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
  │       computedValue = node.value(valuesCache.values)
  │       if changed → nodeState.set(...) + updateValuesCacheEntry O(1)
  │
  └─ Фаза 2: FieldState
      для каждого листа:
        computeFieldState(node, currentValue, allValues, revalidate, translate)
        if fieldStateChanged(prev, next) → nodeState.set(node, next)
      returns Set<object> изменённых узлов
```

### Call sites `recomputeAll`

```
1. Palistor constructor (init)    → полный — строит groupDeps через trackingWrap
2. WritePipeline.execute()        → таргетированный (changedNodes)
3. OnChangePipeline.fire()        → таргетированный (changedNodes из applyPatch)
4. ResolvePipeline/executeResolve → полный (resolve меняет произвольные поля)
5. SubmitPipeline.execute (start) → полный (revalidate=true)
6. SubmitPipeline.execute (end)   → полный
7. ResetPipeline.execute()        → полный
8. PersistManager.hydrateFromStorage() → полный
9. Palistor.setValuesNode()       → полный (патч может быть любым)
```

---

## Ключевые инварианты

| Принцип | Реализация |
|---|---|
| Конфиг неизменяем | `rootConfig` никогда не мутируется |
| Один прокси на узел | `proxyCache: WeakMap` |
| Стабильные ссылки | `WeakMap`-кэши для onValueChange / submit / reset |
| Точечные ре-рендеры | tracking proxy + `nodeVersions` |
| Иммутабельный FieldState | `nodeState.set(node, { ...old, value: new })` |
| Resolve без лишних ре-рендеров | batch: буфер writes + один flush + один notifyChanged |
| Resolve дедупликация | pending status → не запускаем повторно |
| Ошибки resolve без throw | `onError` callback + реактивные `isInvalid`/`errorMessage` |

---

## createProxyStore + useForm

`new Palistor(options)` — создаёт экземпляр формы. `createProxyStore(options)` — устаревший алиас.  
`useForm(store | subtree)` — React-хук, подключает компонент к store через tracking proxy.

```ts
// Создание store (вне React)
const store = new Palistor<Config>({
  config: orderConfig,
  initialValues: { email: "user@example.com" },
});
// или устаревший вариант:
// const store = createProxyStore({ config: orderConfig });

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
```

**Ключевые решения:**
- Состояние вне React — React подписывается через `useSyncExternalStore`
- i18n / notifications подключаются хуками (`useTranslator`, `useNotifier`), не провайдером
- `useForm(subtree)` принимает tracking proxy поддерево → независимый ре-рендер
- Колбэки submit/reset/onChange задаются в конфиге, не при вызове useForm
- `{...form.email}` — spread-safe: скрывает validate/formatter/setter через ownKeys


