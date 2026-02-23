# Proxy-Based Reactive Architecture

## Что хотим

```tsx
// ✅ Создаём store один раз (вне React)
const store = createProxyStore({ config, initialValues });

// ✅ Подключаем в React через useForm
const form = useForm(store);

// ✅ Передаём поддерево в компонент — никаких хуков внутри
<Component passport={form.passport} />

// В компоненте
function Component({ passport }) {
  if (!passport.isVisible) return null;
  return <NumberField field={passport.number} />;
}

// ✅ Листовой компонент читает всё через точку
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

// ✅ Зависимости для вычисляемых полей — пока через recomputeAll
// (автоматический dependency tracking — следующий шаг)
cardNumber: {
  isVisible: (values) => values.paymentType === "card",
}
```

## Текущая архитектура

### Два слоя

| Слой | Что делает | Файл |
|------|-----------|------|
| **ProxyStore** (framework-agnostic) | Хранит values + computed state, пересчитывает по конфигу, уведомляет | `proxy/store.ts` |
| **useForm** (React integration) | Подключает компонент к store через `useSyncExternalStore` | `proxy/react/useForm.ts` |

### ProxyStore

```
Config (static)                    State (reactive, per config node)
┌──────────────────────┐           ┌───────────────────────────────┐
│ passport: {          │           │ WeakMap<configNode, {         │
│   isVisible: fn,     │ ──read──► │   value: "AB123",             │
│   number: {          │           │   isVisible: true,  ← computed│
│     value: "",       │           │   isRequired: true, ← computed│
│     isRequired: true,│           │   error: null,      ← computed│
│     validate: fn,    │           │   label: "Passport Number",   │
│   }                  │           │ }>                             │
│ }                    │           └───────────────────────────────┘
└──────────────────────┘                       │
         │                                     │
         └──── Proxy ──────────────────────────┘
               │
               │  GET .value      → state.value
               │  GET .isVisible  → state.isVisible (computed!)
               │  SET .value = X  → formatter → validate → recompute → notify
               │  GET .number     → child proxy (cached)
```

### Что происходит при `SET .value`

```
form.passport.number.value = "XY999"
  │
  ├─ 1. formatter?  → config.passport.number.formatter(value, allValues)
  ├─ 2. store value → nodeState.set(node, { ...state, value: formatted })
  ├─ 3. recomputeAll():
  │     for each leaf node:
  │       - isVisible(allValues), isRequired(allValues), ...
  │       - validate(value, allValues) → error / errorMessage
  │       - shallow compare prev vs next → changed set
  ├─ 4. version++
  ├─ 5. notify per-node listeners (changed nodes only)
  └─ 6. notify global listeners → React re-renders
```

### useForm

```ts
function useForm<TConfig>(store: ProxyStore<TConfig>): ConfigProxy<TConfig> {
  useSyncExternalStore(
    store.subscribeGlobal,  // подписка на любое изменение
    store.getVersion,       // snapshot = глобальный счётчик
  );
  return store.proxy;       // кэшированный Proxy (referential equality)
}
```

Компонент перерендерится при **любом** изменении в store (глобальная подписка).
Это корректно и достаточно для большинства форм (< 100 полей).

### Ключевые решения

- **WeakMap<configNode, FieldState>** — состояние привязано к объектам конфига, а не к строковым путям
- **Proxy кэшируется** — `proxyCache: WeakMap`, один прокси на узел конфига
- **recomputeAll()** — при каждом SET пересчитывает все поля, но уведомляет только изменённые (shallow compare)
- **Промежуточные узлы** — группы с computed-свойствами (`passport.isVisible`) тоже регистрируются и вычисляются

## Реализовано

- [x] **Ядро: computed state** — `nodeState` хранит `{ value, isVisible, isRequired, error, ... }`. Функции из конфига вычисляются при init и после каждого SET.
- [x] **SET + recompute** — запись `.value` → `formatter` → `validate` → `recomputeAll` → notify изменённых.
- [x] **React integration** — `useForm` через `useSyncExternalStore` с глобальной подпиской.
- [x] **Передача поддерева** — `<Component passport={form.passport} />` работает, вложенный компонент читает из того же прокси.

## Следующие шаги

| # | Шаг | Описание |
|---|-----|----------|
| 1 | **Dependency tracking** | Tracking proxy для `isVisible(values)` — автоматически определяет зависимости. `recomputeAll` → пересчёт только затронутых полей. |
| 2 | **Granular React subscription** | Tracking proxy в `useForm` — записывает прочитанные пути, re-render только при изменении прочитанного. |
| 3 | **setter()** | `setter(value, allValues, setValues)` — изменение нескольких полей за один проход. |
| 4 | **Suspense / async** | `await passport` → резольвер заполняет состояние, React включает Suspense. |

## API

```ts
// Создание store
const store = createProxyStore({
  config: passportConfig,
  initialValues: { number: "AB123" },
});

// React
const form = useForm(store);

// Чтение (из FieldState, не из конфига)
form.passport.number.value       // → "AB123"
form.passport.number.isRequired  // → true (вычислено)
form.passport.number.error       // → "required" | undefined
form.passport.isVisible          // → true (вычислено из функции)

// Запись
form.passport.number.value = "XY999";
// → formatter → validate → recompute → notify → re-render

// Значения для submit
store.getValues()  // → { passport: { number: "XY999" } }

// Подписка (low-level)
store.subscribe(configNode, listener)
store.subscribeGlobal(listener)
```