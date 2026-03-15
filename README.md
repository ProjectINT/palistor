# Palistor

**Реактивный state manager для форм с гранулярным рендерингом**

Palistor — легковесная библиотека управления состоянием форм для React. Построена на двухслойной proxy-архитектуре: framework-agnostic хранилище (`createProxyStore`) и React-интеграция с точечным трекингом подписок (`useForm`).

## Ключевые особенности

- **Точечные обновления** — re-render только при изменении полей, которые компонент реально читал
- **Computed Field State** — `isVisible`, `isRequired`, `error`, `dirty` и другие свойства пересчитываются автоматически при каждом изменении
- **Вложенные структуры** — групповые узлы с computed-свойствами на любом уровне вложенности
- **Proxy API** — нативный синтаксис чтения и записи (`field.value = x`) вместо строковых ключей
- **Submit pipeline** — `beforeSubmit → validate → onSubmit → afterSubmit`, revalidate-семантика
- **Dirty tracking** — per-field и per-group флаг изменений относительно начальных значений
- **Async resolvers** — загрузка начальных данных с auto-deps, retry, optimistic updates и Suspense
- **Persist** — автосохранение в localStorage/sessionStorage или любом кастомном драйвере
- **i18n** — интеграция с любой i18n-библиотекой через `useTranslator`
- **Тестируемость** — framework-agnostic store, тестируется без React

## Установка

**В разработке**

---

## Быстрый старт

### 1. Создайте store

```typescript
import { createProxyStore } from "palistor/store/store";

export const paymentStore = createProxyStore({
  config: { // Это допустим user
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
    passport_id: { value: "" },
    passport: {
      // Групповой узел — computed-свойства на группе
      isVisible: (values) => values.paymentType === "bank",

      number: {
        value: "",
        label: "Passport Number",
        isRequired: (values) => values.paymentType === "bank",
      },
      issueDate: {
        value: "",
        label: "Issue Date",
      },
      resolve: {
        resolver: async (user) => {
          const data = await api.fetchPassportInfo(user.passport_id);
          return { issueDate: data.issueDate };
        },
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

### 2. Подключите компонент

```tsx
import { useForm } from "palistor/react/useForm";

function PaymentForm() {
  const form = useForm(paymentStore);

  return (
    <form onSubmit={() => paymentStore.submit()}>
      <Select
        value={form.paymentType.value}
        onChange={(e) => { form.paymentType.value = e.target.value; }}
        label={form.paymentType.label}
      />

      {form.cardNumber.isVisible && (
        <Input
          value={form.cardNumber.value}
          onChange={(e) => { form.cardNumber.value = e.target.value; }}
          label={form.cardNumber.label}
          placeholder={form.cardNumber.placeholder}
          isRequired={form.cardNumber.isRequired}
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
        isRequired={form.amount.isRequired}
      />

      <button type="submit" disabled={form.submitting}>
        {form.submitting ? "Sending..." : "Submit"}
      </button>
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

Если дочернему компоненту нужен собственный трекинг (независимый re-render), передайте поддерево в `useForm`:

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

| Слой | Файлы | Что делает |
|------|-------|-----------|
| **ProxyStore** (framework-agnostic) | `store/*.ts` | Хранит значения + вычисленное состояние в `WeakMap<configNode, FieldState>`, пересчитывает по конфигу, версионирует ноды, уведомляет подписчиков |
| **React-интеграция** | `react/*.ts` | Tracking proxy + `useSyncExternalStore` — гранулярная подписка: re-render только при изменении прочитанных нод |

### Поток данных при SET

```
form.passport.number.value = "XY999"
  │
  ├─ 1. formatter(value, allValues)         → processedValue
  ├─ 2. storeValue → nodeState.set(node, { ...state, value: processedValue })
  ├─ 3. setter(value, allValues)?           → applyPatch(patch) на другие поля
  ├─ 4. recompute():
  │     ├─ Фаза 1: computed values (функции) в топологическом порядке
  │     └─ Фаза 2: FieldState (isVisible, isRequired, error, dirty…) для всех нод
  ├─ 5. dirtyTracking: сравнение с initialValueMap
  ├─ 6. onChange(fieldKey, newValue, previousValue, allValues) → optional patch
  ├─ 7. version++ + nodeVersions.set(changedNode, version)
  ├─ 8. notify per-node listeners
  └─ 9. notify global listeners → useSyncExternalStore → re-render
```

### Submit pipeline

```
store.submit() / form.groupNode.submit()
  │
  ├─ 1. submitting = true → notify
  ├─ 2. applyLeafBeforeSubmit → transformed snapshot (store не мутируется)
  ├─ 3. groupNode.beforeSubmit(values)?  → transformed values
  ├─ 4. validate all visible leaf nodes → collect errors
  │     └─ если есть ошибки → revalidate = true, submitting = false
  │                         → return { success: false, errors }
  ├─ 5. onSubmit(values)                → Promise (await)
  ├─ 6. afterSubmit(result, { reset })
  └─ 7. submitting = false → return { success: true }
```

### Инициализация store

```
createProxyStore({ config, initialValues? })
  │
  ├─ 1. registerNodes — рекурсивный обход конфига
  │     ├─ Листовые узлы (есть "value") → leafNodes[], начальный FieldState
  │     └─ Групповые узлы с computed-свойствами → тоже в leafNodes[]
  │
  ├─ 2. initGroupSubmitting — submitting/dirty/revalidate для групп
  ├─ 3. recompute() — вычисляет isVisible, isRequired, error… для всех нод
  ├─ 4. captureInitialValues — снимок начальных значений (для dirty tracking)
  ├─ 5. buildNodeMaps — маппинг узел → path, узел → parent
  └─ 6. buildProxy(rootConfig) → store.proxy (кэшированный, referential equality)
```

---

## API Reference

### `createProxyStore`

```typescript
import { createProxyStore } from "palistor/store/store";

const store = createProxyStore({
  config: TConfig,                         // дерево ConfigNode
  initialValues?: DeepPartialValues<...>,  // перекрывают value из конфига
});
```

**Возвращает `ProxyStore<TConfig>`:**

| Свойство / метод | Описание |
|---|---|
| `store.proxy` | Реактивный прокси — структура повторяет конфиг |
| `store.getValues()` | Все текущие значения в виде вложенного объекта |
| `store.submit()` | Submit root: `beforeSubmit → validate → onSubmit → afterSubmit` |
| `store.reset(values?)` | Сброс к defaults из конфига (или к переданным значениям) |
| `store.subscribe(node, fn)` | Подписка на изменения конкретного узла; возвращает unsubscribe |
| `store.subscribeGlobal(fn)` | Подписка на любые изменения; возвращает unsubscribe |
| `store.getVersion()` | Глобальная версия (инкремент при каждом изменении) |
| `store.getNodeVersion(node)` | Версия конкретного узла |
| `store.setTranslator(fn \| null)` | Зарегистрировать i18n-функцию перевода |
| `store.setNotifier(fn \| null)` | Зарегистрировать функцию уведомлений (для resolver `onError`) |
| `store.getNotifier()` | Текущая функция уведомлений |
| `store.persist` | Менеджер персистенции (`enable`, `disable`, `flush`) |

---

### `useForm`

```typescript
import { useForm } from "palistor/react/useForm";

// Корневой — создаёт tracking proxy поверх store.proxy
const form = useForm(store);

// Дочерний — свой tracking поверх переданного поддерева (пропсом)
const section = useForm(form.passport);
```

Возвращает типизированный proxy `ConfigProxy<TConfig>`. Компонент перерендерится только при изменении нод, к которым он обращался через `FIELD_STATE_PROPS` (`value`, `isVisible`, `error` и т.д.). Если компонент только навигировал по дереву (`form.passport`), не читая FIELD_STATE_PROPS — re-render не вызывается.

**Паттерны подписки:**

| Паттерн | Когда использовать |
|---|---|
| Один `useForm(store)` + пропсы вниз | Простые формы, листовые UI-компоненты |
| `useForm(subtree)` в дочернем | Крупные секции с независимым re-render |
| Проп без `useForm` в дочернем | Pure UI-компоненты, рендерятся каскадно за родителем |

---

### Чтение и запись через proxy

#### Листовой узел (`FieldProxyNode<TValue>`)

```typescript
// Чтение (реактивно — tracking)
form.email.value          // → TValue
form.email.label          // → string | undefined
form.email.placeholder    // → string | undefined
form.email.description    // → string | undefined
form.email.isRequired     // → boolean
form.email.isReadOnly     // → boolean
form.email.isDisabled     // → boolean
form.email.isVisible      // → boolean
form.email.isInvalid      // → boolean | undefined
form.email.errorMessage   // → string | undefined
form.email.dirty          // → boolean (отличается от начального значения)

// Запись (триггерит formatter → setter → recompute → onChange → notify)
form.email.value = "new@example.com";

// Альтернатива через onValueChange
form.email.onValueChange("new@example.com");
```

#### Групповой узел (`GroupProxyNode`)

```typescript
form.passport.isVisible     // → boolean
form.passport.isRequired    // → boolean | undefined
form.passport.isReadOnly    // → boolean | undefined
form.passport.isDisabled    // → boolean | undefined
form.passport.isInvalid     // → boolean | undefined
form.passport.errorMessage  // → string | undefined
form.passport.submitting    // → boolean (submit в процессе)
form.passport.loading       // → boolean (async resolver загружается)
form.passport.dirty         // → boolean (хоть одно поле изменилось)
form.passport.revalidate    // → boolean (true после первого неудачного submit)

await form.passport.submit();         // submit поддерева → SubmitResult
form.passport.reset({ number: "" });  // сброс поддерева
```

---

## ConfigNode — конфигурация поля/группы

Тип узла определяется наличием свойства `value`:
- Есть `value` → **листовой узел** (поле формы)
- Нет `value`  → **групповой узел** (контейнер)

```typescript
interface ConfigNode<TValue, TValues> {
  // ─── Только листовые узлы ─────────────────────────────────────────────
  value?: TValue | ((values: TValues) => TValue);
  validate?: (value: TValue, values: TValues) => string | undefined | false;
  formatter?: (value: unknown, values: TValues) => TValue;
  setter?: (value: TValue, values: TValues) => DeepPartialValues<TValues>;
  componentProps?: Record<string, unknown>;
  types?: FieldTypeMeta;
  dependencies?: readonly string[];   // порядок топосортировки computed values

  // ─── Общие (лист и группа) ────────────────────────────────────────────
  label?: string | ((values: TValues) => string);
  placeholder?: string | ((values: TValues) => string);
  description?: string | ((values: TValues) => string);
  isVisible?: boolean | ((values: TValues) => boolean);   // default: true
  isRequired?: boolean | ((values: TValues) => boolean);  // default: false
  isDisabled?: boolean | ((values: TValues) => boolean);  // default: false
  isReadOnly?: boolean | ((values: TValues) => boolean);  // default: false

  // ─── Lifecycle ────────────────────────────────────────────────────────
  beforeSubmit?: (value: TValue, values: TValues) => TValue;   // лист
                 (values: TValues) => TValues;                 // группа
  onSubmit?: (values: TValues) => Promise<unknown> | unknown;
  afterSubmit?: (result: unknown, actions: { reset: () => void }) => void | Promise<void>;
  reset?: (defaults: TValues) => TValues;
  onChange?: (info: {
    fieldKey: string;
    newValue: unknown;
    previousValue: unknown;
    allValues: TValues;
  }) => DeepPartialValues<TValues> | void | Promise<DeepPartialValues<TValues> | void>;

  // ─── Async resolver (только групповые узлы) ───────────────────────────
  resolve?: Resolve<...>;

  // ─── Дочерние узлы (только групповые) ────────────────────────────────
  [key: string]: ConfigNode | any;
}
```

---

## FieldState (runtime)

Вычисленное состояние узла, хранится внутри `WeakMap<configNode, FieldState>`:

```typescript
interface FieldState {
  value: unknown;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  isInvalid?: boolean;
  errorMessage?: string;
  dirty?: boolean;        // лист: значение ≠ initial; группа: хоть одно поле dirty
  submitting?: boolean;   // только групповые узлы
  revalidate?: boolean;   // true после первого неудачного submit
  loading?: boolean;      // только узлы с resolve
}
```

---

## Async Resolver (`resolve`)

Конфигурируется на групповом узле. Загружает данные асинхронно, с поддержкой auto-deps, retry и React Suspense.

```typescript
const store = createProxyStore({
  config: {
    userInfo: {
      resolve: {
        /**
         * values — tracking proxy: чтения автоматически отслеживаются как зависимости.
         * Записи буферизуются и применяются пакетом после резолва.
         */
        resolver: async (values) => {
          const data = await api.getUser(values.userId);
          return { name: data.name, email: data.email };
        },

        // Мгновенный placeholder до завершения resolver
        optimisticResolver: (values) => ({ name: "Loading..." }),

        // Явные зависимости (дополняют auto-deps)
        deps: ["userId"],

        onError: (error, ctx) => {
          ctx.notify("Failed to load user", "USER_LOAD_ERROR");
        },

        options: {
          lazy: true,      // ждать первого обращения к узлу (default: true)
          suspense: false, // бросать Promise для React Suspense (default: false)
          retry: {
            attempts: 3,
            delay: 1000,   // ms
          },
        },
      },

      name:  { value: "" },
      email: { value: "" },
    },
  },
});

// В компоненте
const form = useForm(store);
if (form.userInfo.loading) return <Spinner />;
```

---

## Persist

Автосохранение состояния формы в любом хранилище.

### Встроенные драйверы

```typescript
import { localStorageDriver, sessionStorageDriver } from "palistor/store/persist";
```

### Кастомный драйвер

```typescript
import type { PersistDriver } from "palistor/store/persist";

const myDriver: PersistDriver = {
  getItem:    (key)        => myStorage.get(key),
  setItem:    (key, value) => myStorage.set(key, value),
  removeItem: (key)        => myStorage.delete(key),
};
```

### React-хук (`usePersist`)

```tsx
import { usePersist } from "palistor/react/usePersist";

function PaymentPage({ orderId }: { orderId: string }) {
  usePersist(paymentStore, {
    key: `payment-${orderId}`,      // ключ может зависеть от пропсов
    driver: localStorageDriver,
    debounce: 500,                  // ms (default: 100)
    pick: ["cardNumber", "amount"], // персистировать только эти top-level поля
    // omit: ["sensitiveField"],    // или исключить
  });

  const form = useForm(paymentStore);
  // ...
}
```

### Вне React

```typescript
paymentStore.persist.enable({
  key: "payment",
  driver: localStorageDriver,
});

await paymentStore.persist.flush(); // принудительное сохранение
paymentStore.persist.disable();
```

**`PersistOptions`:**

| Поле | Тип | Описание |
|---|---|---|
| `key` | `string` | Ключ хранения |
| `driver` | `PersistDriver` | Реализация хранилища |
| `debounce` | `number` | Задержка записи в ms (default: 100) |
| `serialize` | `fn` | Кастомный сериализатор (default: `JSON.stringify`) |
| `deserialize` | `fn` | Кастомный десериализатор (default: `JSON.parse`) |
| `pick` | `string[]` | Персистировать только эти top-level ключи |
| `omit` | `string[]` | Исключить эти top-level ключи (игнорируется если задан `pick`) |

---

## i18n (`useTranslator`)

Регистрирует функцию перевода один раз (в layout/провайдере). Все компоненты с `useForm` получат переведённые `label`, `placeholder`, `description` автоматически. При смене локали — все компоненты перерендерятся.

```tsx
import { useTranslations } from "next-intl";
import { useTranslator } from "palistor/react/useTranslator";

function Layout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  useTranslator(paymentStore, t);
  return <>{children}</>;
}
```

В конфиге label/placeholder задаются как функции перевода:

```typescript
label: (t) => t("fields.cardNumber"),
```

Без translator — возвращаются ключи как есть (удобно для тестов).

---

## Уведомления (`useNotifier`)

Регистрирует функцию уведомлений для использования в `resolve.onError`:

```tsx
import { useNotifier } from "palistor/react/useNotifier";

function Layout({ children }: { children: React.ReactNode }) {
  const notifyError = useCallback((error: any, code?: string) => {
    addToast({ title: code ?? "Unknown error", color: "danger" });
  }, []);

  useNotifier(paymentStore, notifyError);
  return <>{children}</>;
}
```

---

## Примеры

### Computed value

```typescript
const store = createProxyStore({
  config: {
    price:    { value: 0 },
    quantity: { value: 1 },
    total: {
      value: (v) => v.price * v.quantity,
      isReadOnly: true,
    },
  },
});
```

### Цепочка computed (топологическая сортировка)

```typescript
const store = createProxyStore({
  config: {
    price:    { value: 100 },
    tax:      { value: (v) => v.price * 0.2,          dependencies: ["price"] },
    total:    { value: (v) => v.price + v.tax,         dependencies: ["price", "tax"] },
  },
});
```

### setter — каскадное изменение нескольких полей

```typescript
country: {
  value: "US",
  setter: (value) => ({ city: "" }), // сбрасываем city при смене country
},
city: { value: "" },
```

### formatter — нормализация при записи

```typescript
email: {
  value: "",
  formatter: (v) => String(v).trim().toLowerCase(),
},
```

### beforeSubmit — трансформация значения перед отправкой

```typescript
phone: {
  value: "",
  // Убираем форматирование (не мутирует store)
  beforeSubmit: (value) => value.replace(/\D/g, ""),
},
```

### Групповой узел с submit/reset

```typescript
const store = createProxyStore({
  config: {
    accountType: { value: "personal" },
    company: {
      isVisible: (v) => v.accountType === "business",
      onSubmit: async (values) => {
        await api.saveCompany(values.company);
      },
      afterSubmit: (_result, { reset }) => {
        showSuccessToast();
        reset();
      },
      name:  { value: "", isRequired: (v) => v.accountType === "business" },
      taxId: { value: "" },
    },
  },
});

const result = await store.proxy.company.submit();
if (!result.success) {
  console.log(result.errors); // [{ path: "company.name", message: "Required" }]
}
```

### Получение значений для отправки

```typescript
const values = store.getValues();
// → { paymentType: "bank", passport: { number: "AB123", issueDate: "2020-01-01" } }
await api.submit(values);
```

---

## Submit Result

```typescript
type SubmitResult =
  | { success: true; result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };
```

---

## Структура модуля

```
palistor/
├── index.ts                           # Публичный API
├── store/
│   ├── store.ts                       # createProxyStore — фабрика, подписки, версии
│   ├── types.ts                       # ConfigNode, FieldProxyNode, GroupProxyNode, ProxyStore…
│   ├── compute.ts                     # FieldState, computeFieldState, resolveFlag
│   ├── valuesCache.ts                 # Постоянно-актуальный кеш значений (O(1) вместо обхода дерева)
│   ├── registerNodes.ts               # Инициализация leafNodes + nodeState
│   ├── hasComputedProps.ts            # Проверка computed-свойств у группы
│   ├── constants.ts                   # Символы + FIELD_STATE_PROPS, CONFIG_PROPS
│   ├── writePipeline.ts               # formatter → storeValue → setter
│   ├── submitPipeline.ts              # beforeSubmit → validate → onSubmit → afterSubmit
│   ├── resetPipeline.ts               # reset к defaults
│   ├── onChangePipeline.ts            # onChange callback
│   ├── resolvePipeline.ts             # Async resolver: deps, retry, optimistic, suspense
│   ├── applyPatch.ts                  # Применение патча значений
│   ├── dirtyTracking.ts               # captureInitialValues, recomputeDirty
│   ├── nodeMap.ts                     # path и parent маппинги
│   ├── createValuesTrackingProxy.ts   # Auto-deps для async resolver
│   ├── buildProxy/
│   │   ├── buildProxy.ts              # Proxy GET/SET traps
│   │   ├── computeProxyKeys.ts        # Ключи proxy (Object.keys / in)
│   │   ├── handleLazyResolve.ts       # Ленивый запуск resolver при первом доступе
│   │   ├── initProxyCaches.ts         # Кэш submitting/loading в nodeState
│   │   ├── translatableProps.ts       # Свойства, проходящие через translator
│   │   └── internalConfigKeys.ts      # Ключи, скрытые в proxy
│   ├── init/
│   │   ├── createNotificationHub.ts   # Версии нод, уведомления, dirty
│   │   ├── createResolveManager.ts    # Запуск и перезапуск resolver-ов
│   │   └── initGroupSubmitting.ts     # Инициализация submitting/dirty/revalidate
│   └── persist/
│       ├── persistManager.ts          # enable / disable / flush
│       ├── drivers.ts                 # localStorageDriver, sessionStorageDriver
│       └── types.ts                   # PersistDriver, PersistOptions
└── react/
    ├── useForm.ts                     # React-хук: tracking proxy + useSyncExternalStore
    ├── createTrackingProxy.ts         # Tracking proxy — записывает прочитанные ноды
    ├── useTranslator.ts               # Регистрация i18n-функции
    ├── useNotifier.ts                 # Регистрация функции уведомлений
    └── usePersist.ts                  # React-интеграция persist
```

---

## Лицензия

MIT
