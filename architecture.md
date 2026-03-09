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

## Write Pipeline

```
form.email.value = "X"   (SET trap в buildProxy)
  │
  ├─ 1. formatValue()       node.formatter(raw, allValues)
  ├─ 1.5 skip?              Object.is(formatted, current) → skipped (warn)
  ├─ 2. storeValue()        nodeState.set(node, { ...state, value })
  ├─ 3. runSetter()         node.setter(value, allValues, prev) → patch → applyPatch()
  ├─ 4. recomputeAll()      computed values (topo-sort) + computeFieldState для каждого листа
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
  ├─ 2. collectValues()
  ├─ 3. applyLeafBeforeSubmit()   leaf-level beforeSubmit на snapshot
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
  store.ts              главная фабрика createProxyStore
  types.ts              ConfigNode, ProxyStore, ExtractValues и др.
  compute.ts            FieldState, computeFieldState, resolveFlag
  constants.ts          символы CONFIG_NODE / SOURCE_PROXY / STORE_REF,
                        наборы FIELD_STATE_PROPS / CONFIG_PROPS /
                        INTERNAL_CONFIG_KEYS / GROUP_SPREAD_KEYS
  writePipeline.ts      format → skip? → store → setter → recompute
  submitPipeline.ts     submitting → beforeSubmit → validate → onSubmit → afterSubmit
  resetPipeline.ts      collectDefaults / collectInitialSnapshot → applyPatch → recompute
  resolvePipeline.ts    async resolve: init, execute, retry, auto-deps
  recomputeAll.ts       topo-sort computed + computeFieldState для всех листьев
  onChangePipeline.ts   fire-and-forget onChange для предков
  applyPatch.ts         применение патчей к дереву
  collectValues.ts      снапшот значений для computed/validate/resolve
  registerNodes.ts      инициализация leafNodes + nodeState
  dirtyTracking.ts      dirty от initial (captureInitialValues + recomputeDirty)
  nodeMap.ts            nodePaths + nodeParents
  hasComputedProps.ts   проверка: есть ли computed-свойства у группы
  createValuesTrackingProxy.ts  tracking write-proxy для resolver
  buildProxy/
    buildProxy.ts       Proxy слой 1: config → FieldState + resolve trigger
    computeProxyKeys.ts ownKeys для spread (field / group)
    handleLazyResolve.ts  lazy resolve trigger при GET группы
    initProxyCaches.ts    WeakMap-кэши (onValueChange, submit, reset)
    translatableProps.ts  набор {label, placeholder, description}
  init/
    createNotificationHub.ts  версионирование + подписки + dirty + postNotifyHook
    createResolveManager.ts   resolve subsystem: trigger, retrigger, eager launch
    initGroupSubmitting.ts    submitting/dirty/revalidate для групповых узлов
  persist/              персистенция (localStorage, sessionStorage)
react/
  useForm.ts            useSyncExternalStore + tracking proxy
  createTrackingProxy.ts  Proxy слой 2: запись accessed нод
  useTranslator.ts      регистрация функции перевода (i18n)
  useNotifier.ts        регистрация функции уведомлений (toast)
  usePersist.ts         React-хук для подключения persist
```

---

## recomputeAll — анализ рантайма

### Текущее поведение: ВСЕГДА полный пересчёт

`recomputeAll()` = `recomputeGroup(rootConfig)` = пересчёт **ВСЕХ** листьев дерева.
При **каждом** `SET .value` пересчитываются все поля формы — даже те, которые никак не зависят от изменённого.

```
form.email.value = "X"
  └─ writePipeline → recomputeAll()
       └─ recomputeGroup(rootConfig)
            └─ collectGroupLeafNodes(rootConfig) → ВСЕ листья (50 шт.)
                 ├─ Фаза 1: пересчитать computed (topo-sort) — для ВСЕХ computed
                 └─ Фаза 2: computeFieldState() — для КАЖДОГО из 50 листьев
```

### Где вызывается `recomputeAll()` — 8 мест

```
Вот ВСЕ call sites (store.ts оборачивает _recomputeAll в замыкание recomputeAll):

1. store.ts:133           init → полный пересчёт (✓ нужен полный)
2. writePipeline.ts:181   SET .value → ⚠️ МОЖНО ТАРГЕТИРОВАТЬ
3. submitPipeline.ts:119  submit start (revalidate=true) → (✓ нужен полный — валидация)
4. submitPipeline.ts:182  submit end (submitting=false) → (✓ нужен полный)
5. resetPipeline.ts:95    reset → (✓ нужен полный)
6. onChangePipeline.ts:78 onChange patch → ⚠️ МОЖНО ТАРГЕТИРОВАТЬ
7. resolvePipeline.ts:251 optimistic resolve → ⚠️ МОЖНО ТАРГЕТИРОВАТЬ
8. resolvePipeline.ts:316 resolve success → ⚠️ МОЖНО ТАРГЕТИРОВАТЬ
9. resolvePipeline.ts:349 resolve error → ⚠️ МОЖНО ТАРГЕТИРОВАТЬ
10. persistManager.ts:193  persist hydrate → (✓ нужен полный)
11. store.ts:192 (setValuesNode) → (✓ нужен полный — патч может быть любой)
```

### Проблема

```
Конфиг с 5 группами × 10 полей = 50 полей:

SET passport.number = "123456"
  └─ recomputeAll() → пересчёт ВСЕХ 50 полей
       ├─ personal:    name, email, phone              ← НЕ НУЖНО (нет deps на passport.number)
       ├─ address:     country, city, shippingCost     ← НЕ НУЖНО
       ├─ payment:     amount, paymentType             ← НЕ НУЖНО
       ├─ passport:    number, issueDate, expiryDate   ← НУЖНО (та же группа)
       └─ calculator:  price, quantity, total          ← НЕ НУЖНО

Фактически нужно пересчитать 3 поля из 50 — остальные 47 пересчётов впустую.
```

### `dependencies` — ключ к оптимизации (НЕ ИСПОЛЬЗУЕТСЯ для таргетирования)

Поле `dependencies` в конфиге **уже** объявляет, от каких путей зависит это поле:

```ts
// Семантика dependencies:
{ dependencies: undefined }   // wildcard — зависит от ВСЕГО (пересчитывать при любом изменении)
{ dependencies: [] }          // only-self — пересчитывать только при изменении своего value
{ dependencies: ["country"] } // explicit — пересчитывать при изменении country
```

**Но сейчас `dependencies` используется ТОЛЬКО для топологической сортировки computed-узлов!**
Ни одна точка в рантайме не использует `dependencies` для фильтрации пересчёта.

```
node.dependencies → используется ТОЛЬКО в topologicalSortComputed()
                     для определения ПОРЯДКА вычисления computed-значений.

                     НЕ используется для определения, НУЖНО ЛИ пересчитывать поле.
```

---

## Архитектура таргетированного пересчёта (ПЛАН)

### Принцип: от изменённых путей → к затронутым листьям напрямую

Не «перебрать все группы, пропустить ненужные», а **сразу получить** нужные листья
через reverse-индекс зависимостей.

### Фаза 0: Построение reverse dependency index (при init)

При `registerNodes` строим обратный индекс:

```
Структуры:

  reverseDepIndex: Map<string, Set<LeafEntry>>
  │  path → множество листьев, которые зависят от этого пути
  │
  │  "country" → { cityNode, shippingCostNode }
  │  "city"    → { shippingCostNode }
  │  "price"   → { totalNode }
  │  "tax"     → { totalNode }

  wildcardLeaves: Set<LeafEntry>
  │  листья БЕЗ dependencies (зависят от всего)
  │
  │  { emailNode, phoneNode, nameNode, ... }

  selfOnlyLeaves: Set<LeafEntry>
  │  листья с dependencies: [] (зависят только от себя)
  │
  │  { commentNode, paymentTypeNode, ... }
```

Построение (один проход при init):

```ts
for (const { node, path } of leafNodes) {
  const deps = node.dependencies as string[] | undefined;

  if (deps === undefined) {
    wildcardLeaves.add(entry);       // нет dependencies → wildcard
  } else if (deps.length === 0) {
    selfOnlyLeaves.add(entry);       // deps: [] → only-self
  } else {
    for (const dep of deps) {
      reverseDepIndex.get(dep)?.add(entry) ?? reverseDepIndex.set(dep, new Set([entry]));
    }
  }
}
```

### Фаза 1: `recomputeAffected(changedPaths)` — замена `recomputeAll()`

```
SET passport.number = "123456"
  │
  ├─ changedPaths = {"passport.number"}
  │
  └─ recomputeAffected(changedPaths):
       │
       ├─ affected = new Set<LeafEntry>()
       │
       ├─ // 1. Reverse lookup: кто зависит от changedPaths?
       │  for path in changedPaths:
       │    affected ∪= reverseDepIndex.get(path)  → прямые зависимые
       │
       ├─ // 2. Wildcard листья — всегда
       │  affected ∪= wildcardLeaves
       │
       ├─ // 3. Self-only — только если сам изменился
       │  for leaf in selfOnlyLeaves:
       │    if leaf.path ∈ changedPaths → affected.add(leaf)
       │
       ├─ // 4. Topo-sort computed среди affected
       │  computedEntries = affected.filter(node.value === function)
       │  sorted = topologicalSortComputed(computedEntries)
       │  for each sorted: пересчитать value
       │
       └─ // 5. computeFieldState только для affected
          for each leaf in affected:
            computeFieldState(leaf, currentValue, allValues)
```

### Визуально: было vs. станет

```
БЫЛО (recomputeAll):

  SET country = "ru"
    └─ пересчёт ВСЕХ 50 полей
         ├─ personal:  name, email, phone        ← впустую
         ├─ address:   country, city, shipping   ← нужно
         ├─ payment:   amount, type              ← впустую
         ├─ passport:  number, issue, expiry     ← впустую
         └─ calc:      price, qty, total         ← впустую

СТАНЕТ (recomputeAffected):

  SET country = "ru"
    ├─ changedPaths = {"country"}
    ├─ reverseDepIndex["country"] = {city, shippingCost}
    ├─ wildcardLeaves = {name, email, phone, ...}   ← всё ещё пересчитываются
    └─ пересчёт: affected = wildcard ∪ {city, shippingCost}
         (self-only листья вроде comment — пропущены ✓)
```

### Максимальная эффективность: когда ВСЕ поля имеют `dependencies`

```
Конфиг, где каждое поле объявляет dependencies:

  personal:
    name:  { deps: [] }             → self-only
    email: { deps: [] }             → self-only
    phone: { deps: [] }             → self-only

  address:
    country: { deps: [] }           → self-only
    city:    { deps: ["country"] }  → explicit
    shipping:{ deps: ["country","city"] } → explicit

  passport:
    number:    { deps: [] }         → self-only
    issueDate: { deps: [] }         → self-only

SET country = "ru":
  wildcardLeaves = {} (пусто — все объявили deps!)
  reverseDepIndex["country"] = {city, shipping}
  affected = {city, shipping}  ← ТОЛЬКО 2 поля из 8!
  Экономия: 75%
```

### Интеграция в call sites

```
writePipeline.ts — ГОРЯЧИЙ ПУТЬ (каждый keypress):
  БЫЛО:   recomputeAll()
  СТАНЕТ: recomputeAffected(changedPaths)
  changedPaths = {nodePath} ∪ {paths из setter-патча}

onChangePipeline.ts — после onChange-патча:
  БЫЛО:   recomputeAll()
  СТАНЕТ: recomputeAffected(changedPaths из applyPatch)

resolvePipeline.ts — после resolve:
  БЫЛО:   recomputeAll()
  СТАНЕТ: recomputeAffected(changedPaths из applyPatch)

submitPipeline, resetPipeline, persist hydrate, init:
  Остаётся recomputeAll() — нужен полный пересчёт (изменения глобальные).
```

### Сигнатуры (план)

```ts
// Новая функция — замена recomputeAll для горячих путей
export function recomputeAffected(
  changedPaths: Set<string>,
  rootConfig: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  reverseDepIndex: Map<string, Set<LeafEntry>>,
  wildcardLeaves: Set<LeafEntry>,
  selfOnlyLeaves: Set<LeafEntry>,
  translate?: TranslateFn,
): Set<object>;

// recomputeAll остаётся для init/reset/submit
export function recomputeAll(...): Set<object>;

// writePipeline получает changedPaths вместо recomputeAll
export interface WriteDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  recomputeAffected: (changedPaths: Set<string>) => Set<object>;
  // recomputeAll убирается отсюда
}
```

### Построение `changedPaths` в writePipeline

```ts
// writeValue знает какой node изменился → берём его path из nodePaths WeakMap:

function writeValue(node, rawValue, deps):
  // ...format, store, setter...
  const changedPaths = new Set<string>();
  changedPaths.add(nodePaths.get(node)!);
  // setter мог изменить другие поля:
  for (const patchedNode of patchedNodes):
    changedPaths.add(nodePaths.get(patchedNode)!);

  const recomputedNodes = recomputeAffected(changedPaths);
```

### Ограничения и edge cases

| Ситуация | Решение |
|---|---|
| Поле без `dependencies` (wildcard) | Всегда пересчитывается — вставлено в wildcardLeaves |
| `dependencies: []` | Пересчитывается только при изменении своего value |
| Computed зависит от computed | topologicalSort применяется к affected-подмножеству |
| `collectValues` нужен полный | Да, collectValues(rootConfig) всегда читает всё дерево — это дёшево (чтение WeakMap) |
| Новые поля после resolve | reverseDepIndex нужно обновить при resolve applyPatch |
| onChange-патч меняет неожиданные поля | changedPaths из applyPatch содержит все фактически изменённые ноды |

### topologicalSortComputed

`topologicalSortComputed` сохраняется — но применяется к **подмножеству** computed-узлов
среди affected, а не ко всем computed в дереве. Описание алгоритма:

Алгоритм Кана (BFS): отфильтровать зависимости на другие computed → inDegree → очередь.
Гарантирует порядок вычислений в цепочках `subtotal → tax → total`.

Замечание: в текущей реализации есть **мёртвый код** (переменная `inDegree`, строки 41–47) —
она вычисляется, но не используется. Работает только `inDeg`. Можно удалить.

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

`createProxyStore(options)` — фабрика, создаёт ProxyStore с конфигом и начальными значениями.  
`useForm(store | subtree)` — React-хук, подключает компонент к store через tracking proxy.

```ts
// Создание store (вне React)
const store = createProxyStore<Config>({
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
```

**Ключевые решения:**
- Состояние вне React — React подписывается через `useSyncExternalStore`
- i18n / notifications подключаются хуками (`useTranslator`, `useNotifier`), не провайдером
- `useForm(subtree)` принимает tracking proxy поддерево → независимый ре-рендер
- Колбэки submit/reset/onChange задаются в конфиге, не при вызове useForm
- `{...form.email}` — spread-safe: скрывает validate/formatter/setter через ownKeys


