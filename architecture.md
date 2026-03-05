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
│  Неизменяемое    │ │ │  { value, isVisible, error,        │
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
form.email.value = "X"
  │
  ├─ 1. formatValue()       node.formatter(raw, allValues)
  ├─ 2. storeValue()        nodeState.set(node, { ...state, value })
  ├─ 3. runSetter()         node.setter(value, allValues) → patch → applyPatch()
  ├─ 4. recomputeAll()      resolveFlag + validate для каждого листа → changed: Set<node>
  └─ 5. notifyChanged()
         ├─ recomputeDirty
         ├─ nodeVersions[node]++ для changed-нод
         ├─ globalListeners → useSyncExternalStore → getSnapshot()
         ├─ onChange pipeline (fire-and-forget, поднимается к предкам)
         └─ findResolvesToRetrigger → resetResolveState → triggerResolve
```

---

## Submit Pipeline

```
form.submit()
  ├─ setGroupRevalidate(true) + recomputeAll() + notifyChanged()
  ├─ collectLeafStates() → есть ошибки? → { success: false, errors }
  └─ applyBeforeSubmit() → node.onSubmit(values) → afterSubmit() → { success: true }
```

---

## Resolve Pipeline

```
GET form.car → узел idle → triggerResolve()
  ├─ optimisticResolver → applyPatch, loading: true, notifyChanged
  └─ resolver(trackingProxy)         ← auto-deps: read → accessedPaths, write → buffer
       ├─ OK  → batch flush: applyPatch(result) + buffered writes, loading: false,
       │        status: resolved, save auto-deps, recomputeAll, notifyChanged (1 раз)
       └─ ERR → onError(err, { notify }), loading: false, status: error

Deps: явные (config) ∪ auto-deps (из tracking proxy resolver'а)
При изменении dep: notifyChanged → findResolvesToRetrigger → resetResolveState → triggerResolve

Suspense: status === "pending" → throw promise → React <Suspense> ловит
Ошибки: НИКОГДА не бросаются — только реактивно через form.car.error
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
  buildProxy.ts         Proxy слой 1: config → FieldState + resolve trigger
  writePipeline.ts      format → store → setter → recompute
  resolvePipeline.ts    async resolve: init, execute, retry, auto-deps
  submitPipeline.ts     validate → beforeSubmit → onSubmit → afterSubmit
  recomputeAll.ts       пересчёт всех листьев после изменения
  onChangePipeline.ts   fire-and-forget onChange для предков
  applyPatch.ts         применение патчей к дереву
  collectValues.ts      снапшот значений для computed/validate/resolve
  registerNodes.ts      инициализация leafNodes + nodeState
  dirtyTracking.ts      dirty от initial
  nodeMap.ts            nodePaths + nodeParents
  createValuesTrackingProxy.ts  tracking write-proxy для resolver
  constants.ts          символы CONFIG_NODE / SOURCE_PROXY / STORE_REF,
                        наборы FIELD_STATE_PROPS / CONFIG_PROPS
  persist/              персистенция (localStorage и др.)
react/
  useForm.ts            useSyncExternalStore + tracking proxy
  createTrackingProxy.ts  Proxy слой 2: запись accessed нод
  usePersist.ts / useTranslator.ts / useNotifier.ts
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
| Ошибки resolve без throw | `onError` callback + реактивные `error`/`errorMessage` |

---

## createForm + useForm(id)

`createForm` — модульный уровень, статичная конфигурация, возвращает типизированный `useForm`.  
`useForm(id)` — React-хук, находит или создаёт store в registry по `type:id`, вызывает `translateFunction()`.

```ts
export const { useForm } = createForm<OrderValues>({
  config: orderConfig,
  defaults: orderDefaults,
  translateFunction: useTranslations, // ссылка на хук, вызовется внутри useForm
  type: "Order",                      // registry key: "Order:NewOrder", "Order:abc-123"
});

// Корневой компонент
const { getFieldProps, submit } = useForm(order?.id ?? "NewOrder", {
  initial: order,       // мержится в non-dirty поля при смене ссылки
  onSubmit, afterSubmit, onChange, beforeSubmit,
});

// Вложенный компонент — только id
const { getFieldProps } = useForm(orderId);
```

**Ключевые решения:**
- Состояние вне React — React подписывается через `useSyncExternalStore`
- Нет PalistorProvider — `translateFunction` вызывается внутри `useForm` (уже в React-дереве)
- `initial` мержится только в non-dirty поля, сравнение по ссылке (`Object.is`)
- Колбэки (`onSubmit`, `onChange`) хранятся в `useRef` → всегда актуальная версия
- `getFieldProps` — фактически хук (внутри `useSyncExternalStore`), не вызывать в условиях/циклах


