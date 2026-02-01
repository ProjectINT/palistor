# Palistor

**Реактивный state manager для форм с оптимизированным рендерингом**

Palistor — это легковесная библиотека для управления состоянием форм в React приложениях. Построена на принципах минимальных ре-рендеров и декларативной конфигурации полей.

## Ключевые особенности

- 🎯 **Точечные обновления** — компонент перерендерится только когда изменится его поле
- 📦 **Computed Field State** — вычисляемые свойства (isVisible, isDisabled) хранятся в store
- 🔗 **Система зависимостей** — оптимизация через явное указание зависимостей между полями
- 🌍 **i18n поддержка** — встроенная интеграция с next-intl
- 💾 **Persistence** — автосохранение черновиков в localStorage
- 🧪 **Тестируемость** — чистые функции для всех операций с состоянием

## Установка
 - **В разработке**

---

## Быстрый старт

### 1. Определите конфигурацию формы

```typescript
import type { FormConfig } from "@/modules/palistor";

interface PaymentForm {
  paymentType: "card" | "bank" | "crypto";
  cardNumber: string;
  bankAccount: string;
  amount: number;
}

const paymentConfig: FormConfig<PaymentForm> = {
  paymentType: {
    value: "card",
    label: (t) => t("form.paymentType"),
  },

  cardNumber: {
    value: "",
    label: (t) => t("form.cardNumber"),
    placeholder: (t) => t("form.cardNumberPlaceholder"),
    // Видимость зависит от paymentType
    isVisible: (values) => values.paymentType === "card",
    isRequired: (values) => values.paymentType === "card",
    // Явно указываем зависимость для оптимизации
    dependencies: ["paymentType"],
    // Валидация
    validate: (value, values) => {
      if (values.paymentType === "card" && value.length < 16) {
        return "validation.cardNumberInvalid";
      }
    },
  },

  bankAccount: {
    value: "",
    label: (t) => t("form.bankAccount"),
    isVisible: (values) => values.paymentType === "bank",
    isRequired: (values) => values.paymentType === "bank",
    dependencies: ["paymentType"],
  },

  amount: {
    value: 0,
    label: (t) => t("form.amount"),
    isRequired: true,
    // Статическое поле — пересчёт только при изменении себя
    dependencies: [],
  },
};
```

### 2. Используйте в компоненте

```tsx
import { useFormStore } from "@/modules/palistor";

function PaymentForm() {
  const form = useFormStore<PaymentForm>("payment-form", {
    config: paymentConfig,
    defaults: {
      paymentType: "card",
      cardNumber: "",
      bankAccount: "",
      amount: 0,
    },
    onSubmit: async (values) => {
      await api.processPayment(values);
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.submit(); }}>
      <Select {...form.getFieldProps("paymentType")}>
        <Option value="card">Card</Option>
        <Option value="bank">Bank</Option>
      </Select>

      {/* Поля автоматически скрываются/показываются */}
      {form.fields.cardNumber.isVisible && (
        <Input {...form.getFieldProps("cardNumber")} />
      )}

      {form.fields.bankAccount.isVisible && (
        <Input {...form.getFieldProps("bankAccount")} />
      )}

      <Input {...form.getFieldProps("amount")} type="number" />

      <Button type="submit" isLoading={form.submitting}>
        Pay
      </Button>
    </form>
  );
}
```

---

## Архитектура

### Структура FormState

```typescript
interface FormState<TValues> {
  // Плоский объект значений (для обратной совместимости)
  values: TValues;

  // Вычисленное состояние каждого поля
  fields: {
    [K in keyof TValues]: {
      value: TValues[K];
      isVisible: boolean;
      isDisabled: boolean;
      isReadOnly: boolean;
      isRequired: boolean;
      label?: string;
      placeholder?: string;
      description?: string;
      error?: string;
    };
  };

  // Ошибки валидации
  errors: Partial<Record<keyof TValues, string>>;

  // Метаданные
  submitting: boolean;
  dirty: boolean;
  showErrors: boolean;
  locale: string;
}
```

### Поток данных

```
setValue('paymentType', 'bank')
    │
    ▼
┌─────────────────────────────────────────┐
│ setFieldValueAction (чистая функция)    │
│  ├── formatter(value)                   │
│  ├── newValues = { ...values, [key] }   │
│  └── recomputeFieldStates()             │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ recomputeFieldStates                    │
│  for each field:                        │
│    ├── shouldRecalculateField()?        │
│    │     └── check dependencies         │
│    └── computeFieldState() if needed    │
└─────────────────────────────────────────┘
    │
    ▼
store.setState(newState)
    │
    ▼
React: useSyncExternalStore → selective re-render
```

---

## Система зависимостей (dependencies)

Массив `dependencies` в конфигурации поля определяет, при изменении каких полей нужно пересчитать его состояние.

| dependencies | Поведение |
|--------------|-----------|
| `undefined` (не указан) | Пересчёт при изменении **любого** поля |
| `['field1', 'field2']` | Пересчёт при изменении field1, field2 **или себя** |
| `[]` (пустой массив) | Пересчёт **только** при изменении себя или init/reset |

### Пример оптимизации

```typescript
const config: FormConfig<MyForm> = {
  // Поле-триггер — без зависимостей
  country: { value: "US" },

  // Зависит от country
  city: {
    value: "",
    isVisible: (v) => v.country !== "",
    dependencies: ["country"],
  },

  // Статическое поле — никогда не пересчитывается
  comment: {
    value: "",
    label: (t) => t("form.comment"),
    dependencies: [], // ← только при init/reset
  },

  // Сложная зависимость
  shippingCost: {
    value: 0,
    isVisible: (v) => v.country !== "" && v.city !== "",
    dependencies: ["country", "city"],
  },
};
```

---

## API Reference

### useFormStore

```typescript
function useFormStore<TValues>(
  id: string,
  options: {
    config: FormConfig<TValues>;
    defaults: TValues;
    initial?: Partial<TValues>;
    locale?: string;
    persistId?: string;
    onChange?: (params) => void | Partial<TValues>;
    beforeSubmit?: (values) => TValues;
    onSubmit?: (values) => Promise<any>;
    afterSubmit?: (data, reset) => void;
    autoUnregister?: boolean;
  }
): FormStoreApi<TValues>;
```

**Возвращает:**

| Свойство | Тип | Описание |
|----------|-----|----------|
| `values` | `TValues` | Текущие значения полей |
| `fields` | `FieldStates<TValues>` | Вычисленное состояние каждого поля |
| `errors` | `Record<string, string>` | Ошибки валидации |
| `dirty` | `boolean` | Форма изменена |
| `submitting` | `boolean` | Идёт отправка |
| `setValue(key, value)` | `function` | Установить значение |
| `reset(values?)` | `function` | Сбросить форму |
| `setLocale(locale)` | `function` | Сменить локаль |
| `submit()` | `function` | Отправить форму |
| `validateForm()` | `function` | Валидировать всю форму |
| `getFieldProps(key)` | `function` | Получить пропсы для UI компонента |
| `getVisibleFields()` | `function` | Список видимых полей |

### Хуки для отдельных полей

```typescript
// Полное состояние поля (все свойства)
const field = useFieldState<string>("form-id", "fieldName");
// → { value, isVisible, isDisabled, isRequired, label, error, ... }

// Только значение
const value = useFieldValue<string>("form-id", "fieldName");

// Только видимость
const isVisible = useFieldVisible("form-id", "fieldName");

// Только ошибка
const error = useFieldError("form-id", "fieldName");

// Только setter (без подписки)
const setValue = useSetFieldValue<string>("form-id", "fieldName");
```

---

## FieldConfig

```typescript
interface FieldConfig<TValue, TValues> {
  // Значение
  value?: TValue | ((values: TValues) => TValue);

  // Строковые свойства (поддерживают i18n)
  label?: string | ((translate, settings?) => string);
  placeholder?: string | ((translate, settings?) => string);
  description?: string | ((translate, settings?) => string);

  // Boolean свойства (могут быть функциями)
  isVisible?: boolean | ((values: TValues) => boolean);
  isDisabled?: boolean | ((values: TValues) => boolean);
  isReadOnly?: boolean | ((values: TValues) => boolean);
  isRequired?: boolean | string | ((values: TValues) => boolean | string);

  // Валидация
  validate?: (value: TValue, values: TValues) => string | undefined;

  // Форматирование
  formatter?: (value: TValue, values: TValues) => TValue;

  // Связанные изменения
  setter?: (value, values, setValues) => void;

  // Оптимизация
  dependencies?: Array<keyof TValues>;
}
```

---

## Интеграция с HeroUI

`getFieldProps()` возвращает объект, совместимый с компонентами HeroUI:

```tsx
const props = form.getFieldProps("email");
// {
//   value: "test@example.com",
//   onValueChange: (v) => setValue("email", v),
//   isDisabled: false,
//   isReadOnly: false,
//   isRequired: true,
//   isInvalid: false,
//   errorMessage: undefined,
//   label: "Email",
//   placeholder: "Enter email",
//   description: "We'll never share your email",
// }

<Input {...props} />
```

---

## Структура модуля

```
palistor/
├── core/
│   ├── types.ts          # Типы
│   ├── createStore.ts    # Базовый store
│   ├── computeFields.ts  # Вычисление fieldStates
│   ├── actions.ts        # Чистые функции
│   └── registry.ts       # Глобальный реестр
├── react/
│   ├── useFormStore.ts   # Главный хук
│   ├── useField.ts       # Хуки для полей
│   └── useSelector.ts    # Универсальный селектор
├── utils/
│   ├── materialize.ts    # mergeState, difference
│   ├── helpers.ts        # Работа с путями
│   └── persistence.ts    # localStorage
└── index.ts              # Публичный API
```

---

## Примеры

### Связанные поля (setter)

```typescript
const config: FormConfig<PriceForm> = {
  price: { value: 0 },
  quantity: { value: 1 },
  total: {
    // Computed value
    value: (v) => v.price * v.quantity,
    isReadOnly: true,
    dependencies: ["price", "quantity"],
  },
};
```

### Условная валидация

```typescript
const config: FormConfig<UserForm> = {
  accountType: { value: "personal" },
  companyName: {
    value: "",
    isVisible: (v) => v.accountType === "business",
    isRequired: (v) => v.accountType === "business"
      ? "validation.companyRequired"
      : false,
    dependencies: ["accountType"],
  },
};
```

### Persistence (черновики)

```typescript
const form = useFormStore("long-form", {
  config,
  defaults,
  persistId: "draft-long-form", // ← сохраняет в localStorage
});

// При перезагрузке страницы данные восстановятся
```

---

## Лицензия

MIT