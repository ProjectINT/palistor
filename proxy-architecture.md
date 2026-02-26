# Proxy-Based Reactive Architecture

## Обзор

Двухслойная реактивная система для форм: framework-agnostic хранилище (ProxyStore)
и React-интеграция (useForm) с гранулярным трекингом подписок.

```tsx
const store = createProxyStore({ config, initialValues });

function App() {
  const form = useForm(store);
  return (
    <div>
      <PassportSection passport={form.passport} />
      <input
        value={form.email.value}
        onChange={(e) => { form.email.value = e.target.value }}
      />
    </div>
  );
}

// Вариант 1: поддерево через проп (без хука — tracking родителя)
function PassportSection({ passport }) {
  if (!passport.isVisible) return null;
  return <NumberField field={passport.number} />;
}

// Вариант 2: useForm(subtree) — независимый tracking, изолированный re-render
function PassportSection({ passport }) {
  const p = useForm(passport);
  if (!p.isVisible) return null;
  return <NumberField field={p.number} />;
}

// Листовой компонент
function NumberField({ field }) {
  return (
    <input
      value={field.value}
      placeholder={field.placeholder}
      disabled={field.isDisabled}
      onChange={(e) => { field.value = e.target.value }}
    />
  );
}
```

## Архитектура

### Файловая структура

```
proxy/
├── store/
│   ├── store.ts              # ProxyStore — фабрика, подписки, версии
│   ├── buildProxy.ts         # Proxy (GET/SET trap) для узлов конфига
│   ├── compute.ts            # FieldState, computeFieldState, resolveFlag
│   ├── collectValues.ts      # Сбор текущих значений в плоский объект
│   ├── registerNodes.ts      # Инициализация leafNodes + nodeState
│   ├── recomputeAll.ts       # Пересчёт computed-свойств всех полей
│   ├── hasComputedProps.ts   # Проверка computed-свойств у промежуточных узлов
│   └── constants.ts          # Символы (CONFIG_NODE, SOURCE_PROXY, STORE_REF),
│                             # наборы FIELD_STATE_PROPS, CONFIG_PROPS
├── react/
│   ├── useForm.ts            # React-хук с tracking proxy + useSyncExternalStore
│   └── createTrackingProxy.ts # Tracking proxy — записывает прочитанные ноды
└── store.test.ts
```

### Два слоя

| Слой | Что делает | Файлы |
|------|-----------|-------|
| **ProxyStore** (framework-agnostic) | Хранит values + computed state в `WeakMap<configNode, FieldState>`, пересчитывает по конфигу, версионирует ноды, уведомляет подписчиков | `proxy/store/*.ts` |
| **useForm** (React integration) | Tracking proxy + `useSyncExternalStore` — гранулярная подписка: re-render только при изменении прочитанных нод | `proxy/react/*.ts` |

### ProxyStore

```
Config (static)                    State (reactive, per config node)
┌──────────────────────┐           ┌───────────────────────────────────┐
│ passport: {          │           │ WeakMap<configNode, FieldState> { │
│   isVisible: fn,     │ ──read──► │   value: "AB123",                 │
│   number: {          │           │   isVisible: true,    ← computed  │
│     value: "",       │           │   isRequired: true,   ← computed  │
│     isRequired: true,│           │   isDisabled: false,  ← computed  │
│     validate: fn,    │           │   isReadOnly: false,  ← computed  │
│   }                  │           │   error: undefined,   ← computed  │
│ }                    │           │   errorMessage: undef, ← computed │
└──────────────────────┘           │   label: "Passport Number",       │
         │                         │   placeholder: undefined,         │
         │                         │   description: undefined,         │
         └──── Proxy ─────────┐    │ }                                 │
               │              │    └───────────────────────────────────┘
               │  GET .value      → nodeState.get(node).value
               │  GET .isVisible  → nodeState.get(node).isVisible
               │  GET .label      → nodeState.get(node).label
               │  SET .value = X  → formatter → update → recomputeAll → notify
               │  GET .number     → child proxy (cached via proxyCache WeakMap)
```

### Инициализация

```
createProxyStore({ config, initialValues })
  │
  ├─ 1. registerNodes(rootConfig, initialValues, leafNodes, nodeState)
  │     ├─ Рекурсивный обход дерева конфига
  │     ├─ Листовые узлы (есть "value") → leafNodes[], начальный FieldState
  │     ├─ Промежуточные узлы с computed-свойствами → тоже в leafNodes[]
  │     └─ initialValues перекрывают дефолтные значения из конфига
  │
  ├─ 2. recomputeAll()
  │     └─ Вычисляет isVisible, isRequired, validate, label… для всех leafNodes
  │
  └─ 3. buildProxy(rootConfig) → store.proxy (кэшированный, referential equality)
```

### Что происходит при `SET .value`

```
form.passport.number.value = "XY999"
  │
  ├─ 1. formatter?    → config.formatter(value, allValues) → processedValue
  ├─ 2. store value   → nodeState.set(node, { ...state, value: processedValue })
  ├─ 3. recomputeAll():
  │     ├─ collectValues(rootConfig, nodeState) → allValues
  │     └─ for each leafNode:
  │          ├─ computeFieldState(node, currentValue, allValues)
  │          │   ├─ resolveFlag(isVisible, allValues, true)
  │          │   ├─ resolveFlag(isRequired, allValues, false)
  │          │   ├─ resolveFlag(isDisabled, allValues, false)
  │          │   ├─ resolveFlag(isReadOnly, allValues, false)
  │          │   ├─ resolveString(label), resolveString(placeholder), …
  │          │   └─ validate(value, allValues) → error / errorMessage
  │          └─ fieldStateChanged(prev, next) → changed set (shallow compare)
  ├─ 4. changed.add(currentNode) — текущий узел всегда в changed
  ├─ 5. version++ (глобальный счётчик)
  ├─ 6. nodeVersions.set(node, version) — для каждого changed-узла
  ├─ 7. notify per-node listeners (только changed ноды)
  └─ 8. notify global listeners → React useSyncExternalStore → getSnapshot
```

### useForm — React-интеграция с tracking proxy

`useForm` работает в двух режимах:

#### 1. `useForm(store)` — корневой компонент

```
useForm(store)
  │
  ├─ resolveInput(store) → { store, sourceProxy: store.proxy }
  ├─ createTrackingProxy(sourceProxy, refs, store, cache)
  │   └─ Proxy поверх store.proxy, записывает чтения в refs.accessed
  ├─ useSyncExternalStore(subscribe, getSnapshot)
  │   ├─ subscribe → store.subscribeGlobal (подписка на глобальные изменения)
  │   └─ getSnapshot:
  │       ├─ accessed.size === 0 && hasNavigated → стабильный snapshot (Parent-паттерн)
  │       ├─ accessed.size === 0 && !hasNavigated → store.getVersion() (fallback)
  │       └─ accessed.size > 0 → проверяет nodeVersions только tracked нод
  └─ return trackingProxy (типизированный как ConfigProxy<TConfig>)
```

#### 2. `useForm(subtree)` — дочерний компонент с независимой подпиской

```tsx
function Parent() {
  const form = useForm(store);
  return <Child section={form.passport} />;  // передаём tracking proxy поддерево
}

function Child({ section }) {
  const passport = useForm(section);  // ← новый tracking, свой accessed set
  return <span>{passport.number.value}</span>;
}
```

```
useForm(trackingProxy)
  │
  ├─ resolveInput(trackingProxy):
  │   ├─ unwrapTrackingProxy → { sourceProxy, store } (через символы SOURCE_PROXY, STORE_REF)
  │   └─ sourceProxy = оригинальный store.proxy поддерево
  ├─ createTrackingProxy(sourceProxy, NEW refs, store, NEW cache)
  │   └─ Свой tracking — чтения НЕ попадают в родительский accessed set
  └─ useSyncExternalStore → собственный getSnapshot → независимый re-render
```

### Tracking Proxy (createTrackingProxy)

```
Обёртка поверх store.proxy. Перехватывает GET:

  tracking.passport.number.value
       │          │         │
       │          │         └─ key ∈ FIELD_STATE_PROPS → refs.accessed.add(configNode)
       │          │                                      refs.lastVersions.set(node, version)
       │          │                                      return sourceProxy[key]
       │          │
       │          └─ key ∉ FIELD_STATE_PROPS, result is object → refs.hasNavigated = true
       │                                                          return createTrackingProxy(result, refs, …)
       │
       └─ CONFIG_NODE → return target[CONFIG_NODE]  (прозрачно)
          SOURCE_PROXY → return target              (для unwrap)
          STORE_REF    → return store               (для unwrap)

SET: пробрасывается в исходный store.proxy → SET trap buildProxy → recompute → notify
```

### Паттерны подписки в React

| Паттерн | Parent re-render | Child re-render | Когда использовать |
|---------|:---:|:---:|---|
| **Один useForm + пропсы вниз** | При любом чтённом изменении | Каскадно за родителем | Простые формы, мало полей |
| **useForm(subtree) в каждом child** | Только свои чтения | Только свои чтения | Сложные формы, гранулярный контроль |
| **Проп без useForm (листовой)** | Через родительский tracking | Каскадно | UI-компоненты (Input, Select), не нужна изоляция |

### FieldState

```ts
interface FieldState {
  value: unknown;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;   // default: false
  isReadOnly: boolean;   // default: false
  isDisabled: boolean;   // default: false
  isVisible: boolean;    // default: true
  error?: boolean;
  errorMessage?: string;
}
```

### Ключевые решения

- **WeakMap<configNode, FieldState>** — состояние привязано к объектам конфига, а не к строковым путям. GC-friendly.
- **Двойной Proxy** — store proxy (GET/SET из FieldState) + tracking proxy (записывает accessed ноды для React).
- **proxyCache: WeakMap** — один прокси на узел конфига, referential equality между рендерами.
- **recomputeAll()** — при каждом SET пересчитывает все leafNodes, но уведомляет только изменённые (shallow compare через `fieldStateChanged`).
- **Промежуточные узлы** — группы с computed-свойствами (`passport.isVisible`) регистрируются как «виртуальные» листья в leafNodes.
- **Версионирование нод** — `nodeVersions: WeakMap<object, number>`, инкрементируется только для changed-нод. Позволяет `getSnapshot` дёшево проверять: "изменилось ли что-то из того, что я читал?"
- **hasNavigated** — отличает Parent-паттерн (навигирует `form.passport`, но не читает FIELD_STATE_PROPS) от «ничего не делал». Parent не перерендерится при изменении полей, которые читают только его дети.

### Символы (constants.ts)

| Символ | Назначение |
|--------|-----------|
| `CONFIG_NODE` | Доступ к исходному config-узлу из store proxy. Используется tracking proxy для определения tracked ноды. |
| `SOURCE_PROXY` | Извлечение оригинального store.proxy из tracking proxy. Используется `unwrapTrackingProxy` в `useForm(subtree)`. |
| `STORE_REF` | Ссылка на ProxyStore из tracking proxy. Позволяет дочернему `useForm` подписаться на тот же store. |

### Наборы ключей (constants.ts)

| Набор | Ключи | Использование |
|-------|-------|---------------|
| `FIELD_STATE_PROPS` | value, label, placeholder, description, isRequired, isReadOnly, isDisabled, isVisible, error, errorMessage | GET trap: возвращает из FieldState. Tracking: записывает ноду в accessed. |
| `CONFIG_PROPS` | FIELD_STATE_PROPS + validate, formatter, setter, componentProps, types, dependencies | Пропускаются при обходе дерева (registerNodes, collectValues). |

## Типизация

```ts
// Универсальный узел конфига (есть value → поле, нет value → группа)
interface ConfigNode<TValue, TValues> {
  // Поле
  value?: MaybeComputed<TValue, TValues>;
  label?: MaybeComputed<string, TValues>;
  placeholder?: MaybeComputed<string, TValues>;
  description?: MaybeComputed<string, TValues>;
  validate?: (value: TValue, values: TValues) => string | undefined | false;
  formatter?: (value: unknown, values: TValues) => TValue;
  setter?: (value: TValue, values: TValues) => DeepPartialValues<TValues>;
  componentProps?: Record<string, unknown>;
  dependencies?: readonly string[];
  types?: FieldTypeMeta;
  // Общие флаги
  isVisible?: MaybeComputed<boolean, TValues>;
  isRequired?: MaybeComputed<boolean, TValues>;
  isReadOnly?: MaybeComputed<boolean, TValues>;
  isDisabled?: MaybeComputed<boolean, TValues>;
  // Lifecycle
  beforeSubmit?: ((value: TValue, values: TValues) => TValue) | ((values: TValues) => TValues);
  onSubmit?: (values: TValues) => Promise<unknown> | unknown;
  afterSubmit?: (result: unknown, actions: { reset: () => void }) => void | Promise<void>;
  reset?: (defaults: TValues) => TValues;
  onChange?: (info: { ... }) => DeepPartialValues<TValues> | void | Promise<...>;
}

// Автоматическая типизация прокси
type ConfigProxy<TConfig> = {
  [K in keyof TConfig]: ConfigNodeToProxy<TConfig[K]>;
};
// Листовой → FieldProxyNode<TValue> (get/set value, readonly computed props)
// Групповой → GroupProxyNode & { дочерние… }

// Извлечение значений для submit
type ExtractValues<TConfig> = { … }  // рекурсивно: листья → тип value, группы → вложенный объект
```

## Следующие шаги

| # | Шаг | Описание |
|---|-----|----------|
| 1 | **Dependency tracking для compute** | Tracking proxy для `isVisible(values)` — автоматически определяет зависимости. `recomputeAll` → пересчёт только затронутых полей вместо всех. |
| 2 | **setter()** | `setter(value, allValues)` → возвращает патч других полей. Изменение нескольких полей за один SET-цикл. |
| 3 | **Suspense / async** | Асинхронная загрузка данных в поля. |

## API

```ts
// ─── Создание store ──────────────────────────────────────────────────────────

const store = createProxyStore({
  config: {
    email: {
      value: "",
      label: "Email",
      isRequired: true,
      validate: (v) => (!v ? "required" : undefined),
    },
    paymentType: { value: "card", label: "Payment Type" },
    cardNumber: {
      value: "",
      label: "Card Number",
      isVisible: (values) => values.paymentType === "card",
      isRequired: (values) => values.paymentType === "card",
    },
    passport: {
      isVisible: (values) => values.paymentType === "bank",
      number: { value: "", label: "Passport Number", isRequired: true },
      issueDate: { value: "", label: "Issue Date" },
    },
  },
  initialValues: { email: "user@example.com" },
});

// ─── React ───────────────────────────────────────────────────────────────────

const form = useForm(store);

// Чтение (из FieldState, не из конфига)
form.email.value               // → "user@example.com"
form.email.isRequired          // → true (computed)
form.email.error               // → undefined (value не пустой)
form.passport.isVisible        // → false (paymentType ≠ "bank")
form.passport.number.label     // → "Passport Number"

// Запись
form.email.value = "new@test.com";
// → formatter → update nodeState → recomputeAll → notify changed → re-render

// Значения для submit
store.getValues()
// → { email: "new@test.com", paymentType: "card", cardNumber: "", passport: { number: "", issueDate: "" } }

// ─── Подписки (low-level) ────────────────────────────────────────────────────

store.subscribe(configNode, listener)      // per-node
store.subscribeGlobal(listener)            // глобальная
store.getVersion()                         // глобальный snapshot
store.getNodeVersion(configNode)           // версия конкретной ноды
```