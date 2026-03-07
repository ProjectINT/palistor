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


