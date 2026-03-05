# Palistor — Архитектурная схема

## Общая картина

Palistor — библиотека реактивных форм для React. Идея: **конфиг формы статичен**,
а живое состояние хранится отдельно. Два Proxy-слоя делают форму реактивной без
лишних ре-рендеров.

---

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
│  • при GET FIELD_STATE_PROP → пишет config-ноду         │
│    в refs.accessed (tracked set компонента)             │
│  • при GET дочернего узла → рекурсивный tracking proxy  │
│  • передаёт SET напрямую в Store Proxy                  │
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
│  • GET "loading" → nodeState.loading (группы с resolve) │
│  • SET "value" → запускает Write Pipeline               │
└────────────────────┬────────────────────────────────────┘
                     │
           ┌─────────┼──────────┐
           ▼         │          ▼
┌──────────────────┐ │ ┌────────────────────────────────────┐
│  Config (static) │ │ │  nodeState: WeakMap<node,FieldState>│
│  config.ts       │ │ │  store.ts                          │
│  Неизменяемое    │ │ │  { value, isVisible, error,        │
│  дерево узлов    │ │ │    loading, …}                     │
└──────────────────┘ │ │  Живое вычисленное состояние        │
                     │ └────────────────────────────────────┘
                     │
                     ▼
          ┌──────────────────────────────────┐
          │  resolveStates: Map<node, state> │
          │  resolvePipeline.ts              │
          │  { status, promise, error,       │
          │    dependencies, attempt }       │
          │  Состояние async-резольверов      │
          └──────────────────────────────────┘
```

---

## Write Pipeline — что происходит при `form.email.value = "X"`

```
form.email.value = "X"
         │
         ▼
  Tracking Proxy SET
  (прозрачно, пробрасывает)
         │
         ▼
  Store Proxy SET trap  (buildProxy.ts)
  сохранить previousValue из nodeState
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                   Write Pipeline                        │
│  writePipeline.ts                                       │
│                                                         │
│  1. formatValue()                                       │
│     node.formatter(rawValue, allValues)                 │
│     например: trim, toNumber, uppercase                 │
│         │                                               │
│         ▼                                               │
│  2. storeValue()                                        │
│     nodeState.set(node, { ...state, value: formatted }) │
│         │                                               │
│         ▼                                               │
│  3. runSetter()                                         │
│     node.setter(value, allValues) → patch               │
│     applyPatch(patch, rootConfig, nodeState)            │
│     → обновляет другие поля (например, city при стране) │
│         │                                               │
│         ▼                                               │
│  4. recomputeAll()               (recomputeAll.ts)      │
│     для каждого листового узла:                         │
│       resolveFlag(isVisible, allValues)                 │
│       resolveFlag(isRequired, …)                        │
│       validate(value, allValues)                        │
│       → новый FieldState                                │
│     → Set<узлов, чьё состояние изменилось>              │
└─────────────────┬───────────────────────────────────────┘
                  │ changed: Set<node>
                  ▼
         notifyChanged(changed)
         ├── recomputeDirty (dirty tracking)
         ├── инкрементирует nodeVersions для каждого
         ├── инкрементирует глобальный version
         ├── вызывает globalListeners
         └── retrigger resolves (auto-deps)
              │  findResolvesToRetrigger(changedPaths)
              │  для каждого resolve: deps ∩ changedPaths?
              │  → resetResolveState + triggerResolve
                  │
                  ▼
         useSyncExternalStore → getSnapshot()
         сравнивает nodeVersions[node] для tracked нод
         если изменилась хотя бы одна → re-render
                  │
                  ▼
         ┌────────────────────┐
         │  (параллельно)     │
         │  onChange Pipeline │
         │  onChangePipeline  │
         │  fire-and-forget:  │
         │  поднимается к     │
         │  предкам с onChange│
         │  → патч обратно    │
         └────────────────────┘
```

---

## Submit Pipeline — `form.submit()`

```
form.submit()
     │
     ▼
 setGroupRevalidate(true)   ← включает показ ошибок
 recomputeAll()
 notifyChanged()
     │
     ▼
 collectLeafStates()        ← все листья в поддереве
     │
     ▼
 Есть ошибки?
  ├─ YES → return { success: false, errors: [...] }
  └─ NO  ─▶  applyLeafBeforeSubmit()
               applyGroupBeforeSubmit()     ← трансформация значений
                    │
                    ▼
             node.onSubmit(values)          ← пользовательский обработчик
                    │
                    ▼
             node.afterSubmit(result, { reset })
                    │
                    ▼
             return { success: true, result }
```

---

## Resolve Pipeline — async-загрузка данных для группового узла

Групповой узел может иметь `resolve` — конфигурацию async-загрузки.
Resolver возвращает данные для **своего поддерева**. Побочные эффекты
(запись в другие ветки) буферизуются и применяются одним flush.

```
Компонент обращается к form.car.brand
              │
              ▼
   Store Proxy GET "car" (buildProxy.ts)
   Узел имеет resolve? → ДА
   status === "idle"? → ДА (lazy trigger)
              │
    ┌─────────┴───────────────┐
    ▼                         ▼
optimisticResolver          resolver (async)
  │                            │
  ▼                         ┌──┴──────────────────┐
applyPatch               OK │                     │ FAIL (после retry)
loading: true               ▼                     ▼
nodeState updated      batch flush:             onError(err, { notify })
recomputeAll             applyPatch(result)     loading: false
notifyChanged            applyPatch(buffered    status: "error"
                           side-effects)        recomputeAll
                         loading: false         notifyChanged
                         status: "resolved"
                         save auto-deps
                         recomputeAll (1 раз)
                         notifyChanged (1 раз)
```

### Зависимости (deps + auto-deps)

```
┌──────────────────────────────────────────────────────┐
│                  Resolve Dependencies                 │
│                                                      │
│  Явные deps: string[]       Auto-deps (tracking)     │
│  ─────────────────────      ──────────────────────    │
│  Задаются в конфиге.        Собираются после первого  │
│  Работают СРАЗУ,            запуска resolver через     │
│  до первого запуска.        createValuesTrackingProxy. │
│                                                      │
│  После первого запуска: итоговые deps =              │
│                         deps ∪ accessedPaths          │
│                                                      │
│  При изменении dep-пути:                             │
│    notifyChanged → findResolvesToRetrigger            │
│    → resetResolveState → triggerResolve               │
└──────────────────────────────────────────────────────┘
```

### Values Tracking Proxy (createValuesTrackingProxy.ts)

```
resolver получает tracking write-proxy вместо сырых values:

async (values) => {
  const id = values.user.id    // READ → accessedPaths.add("user.id")
  values.user.flag = true      // WRITE → pendingWrites.push({path, value})
  return { brand: "Toyota" }   // → applyPatch в поддерево
}
```

### Suspense (опционально)

```
options.suspense: true
  └─ status === "pending" → throw resolveState.promise
     → React <Suspense fallback={...}> подхватывает
     → resolver завершился → promise resolved → retry render

Ошибки НИКОГДА не бросаются через throw.
Ошибки всегда реактивно через form.car.error / form.car.errorMessage.
```

### Notifier (useNotifier)

```
Layout:                             Config:
  useNotifier(store, notifyFn)        onError: (err, { notify }) => {
  │                                     notify(err, 'CODE')
  └→ store.setNotifier(notifyFn)      }
     → notify в resolveDeps
     → ctx.notify в onError callback
```

---

## Tracking — почему нет лишних ре-рендеров

```
Рендер компонента:
  form.passport.isVisible  → accessed.add(passportNode)
  form.email.value         → accessed.add(emailNode)
  form.phone.value         → accessed.add(phoneNode)

Изменили form.city.value:
  nodeVersions[cityNode]++

getSnapshot():
  проверяет только { passportNode, emailNode, phoneNode }
  cityNode — не в списке → версия не совпала НЕ для tracked нод
  → snapshot не изменился → ре-рендера НЕТ ✓

Изменили form.email.value:
  nodeVersions[emailNode]++

getSnapshot():
  emailNode есть в accessed, версия изменилась
  → новый snapshot → ре-рендер ✓
```

---

## Структура модулей

```
palistor/
│
├── store/
│   ├── store.ts              createProxyStore — главная фабрика
│   ├── buildProxy.ts         Proxy слой 1: config → FieldState + resolve trigger
│   ├── compute.ts            FieldState (value, loading, …), resolveFlag, resolveString
│   ├── recomputeAll.ts       Пересчёт всех листьев после изменения
│   ├── writePipeline.ts      format → store → setter → recompute
│   ├── resolvePipeline.ts    Async resolve: типы, init, execute, retry, auto-deps
│   ├── createValuesTrackingProxy.ts  Tracking write-proxy для resolver (read→deps, write→batch)
│   ├── submitPipeline.ts     validate → beforeSubmit → onSubmit → afterSubmit
│   ├── resetPipeline.ts      Сброс значений к defaults
│   ├── onChangePipeline.ts   fire-and-forget onChange для предков
│   ├── applyPatch.ts         Применение патчей setter/onChange/resolve к дереву
│   ├── collectValues.ts      Снапшот всех значений (для computed/validate/resolve)
│   ├── registerNodes.ts      Обход конфига, заполнение nodeState при инит
│   ├── nodeMap.ts            nodePaths + nodeParents (для onChange/resolve deps)
│   ├── dirtyTracking.ts      Отслеживание dirty (изменено от initial)
│   ├── hasComputedProps.ts   Оптимизация recompute (пропуск статичных узлов)
│   ├── constants.ts          Символы, FIELD_STATE_PROPS, CONFIG_PROPS
│   └── persist/              Персистенция (localStorage и др.)
│
├── react/
│   ├── useForm.ts            React хук: useSyncExternalStore + tracking proxy
│   ├── createTrackingProxy.ts Proxy слой 2: запись tracked нод
│   ├── usePersist.ts         Хук для персистенции
│   ├── useTranslator.ts      Хук регистрации функции перевода
│   └── useNotifier.ts        Хук регистрации функции уведомления (для resolve onError)
│
└── core/
    └── types.ts              Общие типы (TranslateFn и др.)
```

---

## Ключевые инварианты

| Принцип | Реализация |
|---|---|
| Конфиг неизменяем | `rootConfig` никогда не мутируется |
| Один прокси на узел | `proxyCache: WeakMap` в buildProxy |
| Стабильные ссылки на функции | `onValueChangeCache`, `submitCache`, `resetCache` WeakMap'ы |
| Точечные ре-рендеры | tracking proxy + nodeVersions |
| Symbol как скрытый backdoor | `CONFIG_NODE` недоступен через `Object.keys` / spread |
| Иммутабельные обновления FieldState | `nodeState.set(node, { ...old, value: new })` |
| Resolve без промежуточных ре-рендеров | batch: buffered writes + один flush + один notifyChanged |
| Resolve дедупликация | pending status + тот же promise → без повторных запусков |
| Resolve scope — только своё поддерево | `applyPatch(node, ...)` а не `applyPatch(rootConfig, ...)` |
| Родитель перезатирает потомков | Атомарность модулей: вложенный resolve перезапустится по deps |
| Ошибки resolver — без throw | `onError` callback + реактивные `error`/`errorMessage` через proxy |
