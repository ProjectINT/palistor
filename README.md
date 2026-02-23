# Palistor

**Реактивный state manager для форм с оптимизированным рендерингом**

Palistor — это легковесная библиотека для управления состоянием форм в React приложениях. Построена на двухслойной proxy-архитектуре: framework-agnostic хранилище и React-интеграция с гранулярным трекингом подписок.

## Ключевые особенности

- 🎯 **Точечные обновления** — re-render только при изменении полей, которые компонент реально читал
- 📦 **Computed Field State** — `isVisible`, `isRequired`, `error` и другие свойства пересчитываются автоматически
- 🌲 **Вложенные структуры** — поддержка групповых узлов (`passport.number.value`) с computed-свойствами на любом уровне
- 🔗 **Proxy API** — нативный синтаксис чтения и записи (`field.value = x`) вместо строковых ключей
- 🧪 **Тестируемость** — framework-agnostic store, тестируется без React

## Установка

**В разработке**

---

## Быстрый старт

### 1. Определите конфигурацию

```typescript
import { createProxyStore } from "@/modules/palistor";

const store = createProxyStore({
  config: {
    paymentType: {
      value: "card",
      label: "Payment Type",
    },

    cardNumber: {
      value: "",
      label: "Card Number",
      placeholder: "0000 0000 0000 0000",
      isVisible: (values) => values.paymentType === "card",
      isRequired: (values) => values.paymentType === "card",
      validate: (value, values) => {
        if (values.paymentType === "card" && value.length < 16) {
          return "Card number must be 16 digits";
        }
      },
    },

    passport: {
      // Групповой узел — может иметь computed-свойства
      isVisible: (values) => values.paymentType === "bank",
      number: {
        value: "",
        label: "Passport Number",
        isRequired: true,
      },
      issueDate: {
        value: "",
        label: "Issue Date",
      },
    },

    amount: {
      value: 0,
      label: "Amount",
      isRequired: true,
    },
  },
  initialValues: {
    paymentType: "card",
  },
});
```

### 2. Используйте в компоненте

```tsx
import { useForm } from "@/modules/palistor";

function PaymentForm() {
  const form = useForm(store);

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(store.getValues()); }}>
      <Select
        value={form.paymentType.value}
        onChange={(e) => { form.paymentType.value = e.target.value; }}
        label={form.paymentType.label}
      />

      {/* Поля автоматически скрываются/показываются */}
      {form.cardNumber.isVisible && (
        <Input
          value={form.cardNumber.value}
          onChange={(e) => { form.cardNumber.value = e.target.value; }}
          label={form.cardNumber.label}
          placeholder={form.cardNumber.placeholder}
          required={form.cardNumber.isRequired}
          errorMessage={form.cardNumber.errorMessage}
        />
      )}

      {form.passport.isVisible && (
        <PassportSection passport={form.passport} />
      )}

      <Input
        value={form.amount.value}
        onChange={(e) => { form.amount.value = Number(e.target.value); }}
        type="number"
        label={form.amount.label}
        required={form.amount.isRequired}
      />
    </form>
  );
}

// Дочерний компонент — передаём поддерево через проп (tracking родителя)
function PassportSection({ passport }) {
  return (
    <>
      <Input
        value={passport.number.value}
        onChange={(e) => { passport.number.value = e.target.value; }}
        label={passport.number.label}
      />
      <Input
        value={passport.issueDate.value}
        onChange={(e) => { passport.issueDate.value = e.target.value; }}
        label={passport.issueDate.label}
      />
    </>
  );
}
```

### Изолированный re-render дочернего компонента

Если дочерний компонент должен ре-рендериться независимо от родителя, используйте `useForm(subtree)`:

```tsx
function PassportSection({ passport }) {
  const p = useForm(passport); // свой tracking, изолированный re-render
  if (!p.isVisible) return null;
  return (
    <Input
      value={p.number.value}
      onChange={(e) => { p.number.value = e.target.value; }}
      label={p.number.label}
    />
  );
}
```

---

## Архитектура

### Два слоя

| Слой | Что делает | Файлы |
|------|-----------|-------|
| **ProxyStore** (framework-agnostic) | Хранит values + computed state в `WeakMap<configNode, FieldState>`, пересчитывает по конфигу, версионирует ноды, уведомляет подписчиков | `store/*.ts` |
| **useForm** (React integration) | Tracking proxy + `useSyncExternalStore` — гранулярная подписка: re-render только при изменении прочитанных нод | `react/*.ts` |

### Поток данных при SET

```
form.passport.number.value = "XY999"
  │
  ├─ 1. formatter?   → config.formatter(value, allValues) → processedValue
  ├─ 2. store value  → nodeState.set(node, { ...state, value: processedValue })
  ├─ 3. recomputeAll():
  │     ├─ collectValues(rootConfig, nodeState) → allValues
  │     └─ for each leafNode:
  │          ├─ computeFieldState(node, currentValue, allValues)
  │          └─ fieldStateChanged(prev, next) → changed set (shallow compare)
  ├─ 4. changed.add(currentNode) — текущий узел всегда в changed
  ├─ 5. version++ (глобальный счётчик)
  ├─ 6. nodeVersions.set(node, version) — только для changed-нод
  ├─ 7. notify per-node listeners
  └─ 8. notify global listeners → React useSyncExternalStore → re-render
```

### Инициализация store

```
createProxyStore({ config, initialValues })
  │
  ├─ 1. registerNodes — рекурсивный обход дерева конфига
  │     ├─ Листовые узлы (есть "value") → leafNodes[], начальный FieldState
  │     ├─ Промежуточные узлы с computed-свойствами → тоже в leafNodes[]
  │     └─ initialValues перекрывают дефолтные значения из конфига
  │
  ├─ 2. recomputeAll() — вычисляет isVisible, isRequired, label… для всех leafNodes
  │
  └─ 3. buildProxy(rootConfig) → store.proxy (кэшированный, referential equality)
```

### Паттерны подписки в React

| Паттерн | Parent re-render | Child re-render | Когда использовать |
|---------|:---:|:---:|---|
| **Один `useForm` + пропсы вниз** | При любом прочитанном изменении | Каскадно за родителем | Простые формы |
| **`useForm(subtree)` в child** | Только свои чтения | Только свои чтения | Сложные формы, гранулярный контроль |
| **Проп без `useForm` (листовой)** | Через родительский tracking | Каскадно | UI-компоненты без изолированного re-render |

---

## API Reference

### `createProxyStore`

```typescript
const store = createProxyStore({
  config: Config,           // дерево FieldConfigNode / GroupConfigNode
  initialValues?: object,   // перекрывают value из конфига
});
```

**Методы store:**

| Метод | Описание |
|-------|----------|
| `store.proxy` | Корневой proxy для чтения/записи значений |
| `store.getValues()` | Собрать все текущие значения в плоский/вложенный объект |
| `store.getVersion()` | Глобальный счётчик версий (для snapshot) |
| `store.getNodeVersion(node)` | Версия конкретной ноды |
| `store.subscribe(node, listener)` | Подписка на изменения конкретной ноды |
| `store.subscribeGlobal(listener)` | Подписка на любые изменения |

### `useForm`

```typescript
// Корневой — создаёт tracking proxy поверх store.proxy
const form = useForm(store);

// Дочерний — свой tracking поверх переданного поддерева
const section = useForm(form.passport);
```

Возвращает typing proxy, типизированный как `ConfigProxy<TConfig>`:
- Листовой узел → `FieldProxyNode<TValue>` (чтение/запись всех `FieldState`-свойств)
- Групповой узел → `GroupProxyNode` с дочерними узлами

### Чтение и запись через proxy

```typescript
// Чтение (из FieldState, реактивно через tracking)
form.email.value          // → "user@example.com"
form.email.isRequired     // → true
form.email.error          // → true / undefined
form.email.errorMessage   // → "required" / undefined
form.email.isVisible      // → true
form.email.label          // → "Email"
form.email.placeholder    // → "Enter email"
form.email.description    // → "..."

form.passport.isVisible   // → false (computed на групповом узле)
form.passport.number.value // → ""

// Запись (триггерит formatter → recomputeAll → notify)
form.email.value = "new@test.com";
form.passport.number.value = "AB123";
```

---

## FieldConfig

### Листовой узел (`FieldConfigNode`)

```typescript
interface FieldConfigNode<TValue, TValues> {
  value: TValue | ((values: TValues) => TValue); // обязателен

  label?: string | ((values: TValues) => string);
  placeholder?: string | ((values: TValues) => string);
  description?: string | ((values: TValues) => string);

  isVisible?: boolean | ((values: TValues) => boolean);   // default: true
  isRequired?: boolean | ((values: TValues) => boolean);  // default: false
  isDisabled?: boolean | ((values: TValues) => boolean);  // default: false
  isReadOnly?: boolean | ((values: TValues) => boolean);  // default: false

  validate?: (value: TValue, values: TValues) => string | undefined | false;
  formatter?: (value: unknown, values: TValues) => TValue;
  setter?: (value: TValue, values: TValues) => DeepPartialValues<TValues>;

  componentProps?: Record<string, unknown>;
  dependencies?: readonly string[]; // зарезервировано для будущей оптимизации
}
```

### Групповой узел (`GroupConfigNode`)

```typescript
interface GroupConfigNode<TValues> {
  // computed-свойства на группу (дочерние поля не затрагивают)
  isVisible?: boolean | ((values: TValues) => boolean);
  isRequired?: boolean | ((values: TValues) => boolean);
  isReadOnly?: boolean | ((values: TValues) => boolean);
  isDisabled?: boolean | ((values: TValues) => boolean);

  // далее — дочерние узлы
  [key: string]: FieldConfigNode<any, TValues> | GroupConfigNode<TValues> | any;
}
```

### FieldState (runtime)

```typescript
interface FieldState {
  value: unknown;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;    // default: false
  isReadOnly: boolean;    // default: false
  isDisabled: boolean;    // default: false
  isVisible: boolean;     // default: true
  error?: boolean;
  errorMessage?: string;
}
```

---

## Структура модуля

```
palistor/
├── store/
│   ├── store.ts              # ProxyStore — фабрика, подписки, версии
│   ├── buildProxy.ts         # Proxy (GET/SET trap) для узлов конфига
│   ├── compute.ts            # FieldState, computeFieldState, resolveFlag
│   ├── collectValues.ts      # Сбор текущих значений в плоский объект
│   ├── registerNodes.ts      # Инициализация leafNodes + nodeState
│   ├── recomputeAll.ts       # Пересчёт computed-свойств всех полей
│   ├── hasComputedProps.ts   # Проверка computed-свойств у промежуточных узлов
│   └── constants.ts          # Символы + наборы FIELD_STATE_PROPS, CONFIG_PROPS
├── react/
│   ├── useForm.ts            # React-хук с tracking proxy + useSyncExternalStore
│   └── createTrackingProxy.ts # Tracking proxy — записывает прочитанные ноды
└── index.ts                  # Публичный API
```

---

## Примеры

### Computed value (вычисляемое поле)

```typescript
const store = createProxyStore({
  config: {
    price: { value: 0 },
    quantity: { value: 1 },
    total: {
      value: (v) => v.price * v.quantity,
      isReadOnly: true,
    },
  },
});
```

### Вложенная структура с групповым узлом

```typescript
const store = createProxyStore({
  config: {
    accountType: { value: "personal" },

    company: {
      // computed видимость всей группы
      isVisible: (v) => v.accountType === "business",

      name: {
        value: "",
        label: "Company Name",
        isRequired: (v) => v.accountType === "business",
      },
      taxId: {
        value: "",
        label: "Tax ID",
      },
    },
  },
});

// Использование
const form = useForm(store);
form.company.isVisible       // → false
form.company.name.isRequired // → false
form.accountType.value = "business";
form.company.isVisible       // → true
form.company.name.isRequired // → true
```

### setter — каскадное изменение нескольких полей

```typescript
// setter возвращает патч других полей (планируется)
const config = {
  country: {
    value: "US",
    setter: (value) => ({ city: "" }), // сброс city при смене country
  },
  city: { value: "" },
};
```

### Получение значений для отправки

```typescript
const onSubmit = () => {
  const values = store.getValues();
  // → { accountType: "business", company: { name: "Acme", taxId: "123" } }
  await api.submit(values);
};
```

---

## Лицензия

MIT