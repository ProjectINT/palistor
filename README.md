# Palistor

> Реактивный state manager для форм с гранулярным рендерингом

Palistor — библиотека управления состоянием форм для React. Построена на двухслойной proxy-архитектуре: framework-agnostic ядро и React-интеграция с точечным трекингом подписок. Компонент перерендеривается **только** при изменении тех полей, которые он реально читал.

---

## Содержание

- [Возможности](#возможности)
- [Быстрый старт](#быстрый-старт)
- [Концепции](#концепции)
- [API Reference](#api-reference)
- [Рецепты](#рецепты)
- [Async Resolver](#async-resolver)
- [Списки и сущности](#списки-и-сущности)
- [Persist](#persist)
- [i18n](#i18n)
- [Уведомления](#уведомления)
- [Структура модуля](#структура-модуля)

---

## Возможности

| | |
|---|---|
| **Гранулярные ре-рендеры** | Компонент подписывается только на те поля, которые он читал — больше ничего не триггерит ре-рендер |
| **Computed Field State** | `isVisible`, `isRequired`, `error`, `dirty` пересчитываются автоматически по конфигу |
| **Proxy API** | Нативный синтаксис: `field.value = x` вместо `dispatch({ type: "SET", field: "...", value: x })` |
| **Submit pipeline** | `beforeSubmit → validate → onSubmit → afterSubmit` с revalidate-семантикой |
| **Dirty tracking** | Per-field и per-group флаг изменений; baseline обновляется после resolve и reset |
| **Async resolvers** | Загрузка данных с auto-deps, retry, optimistic updates и React Suspense |
| **Списки / Entities** | Нормализованный реестр сущностей, list proxy с `add / remove / setItems` |
| **Persist** | Автосохранение в `localStorage`, `sessionStorage` или любом кастомном драйвере |
| **i18n** | Одна строка в layout — `label`, `placeholder`, `description` переводятся везде |
| **Тестируемость** | Framework-agnostic ядро — тестируется без React |

---

## Быстрый старт

### 1. Создайте store

```typescript
import { createProxyStore } from "palistor/store/store";

export const paymentStore = createProxyStore({
  config: {
    paymentType: {
      value: "card",
      label: "Способ оплаты",
    },
    cardNumber: {
      value: "",
      label: "Номер карты",
      placeholder: "0000 0000 0000 0000",
      isVisible: (v) => v.paymentType === "card",
      isRequired: (v) => v.paymentType === "card",
      validate: (value, v) =>
        v.paymentType === "card" && value.length < 16
          ? "Введите 16 цифр"
          : undefined,
    },
    passport: {
      isVisible: (v) => v.paymentType === "bank",
      number:    { value: "", label: "Серия и номер", isRequired: true },
      issueDate: { value: "", label: "Дата выдачи" },
    },
    amount: { value: 0, label: "Сумма", isRequired: true },
  },
  initialValues: { paymentType: "card" },
});
```

### 2. Используйте в компоненте

```tsx
import { useForm } from "palistor/react/useForm";

function PaymentForm() {
  const form = useForm(paymentStore);

  return (
    <form onSubmit={() => paymentStore.submit()}>
      <Select
        value={form.paymentType.value}
        onChange={(e) => (form.paymentType.value = e.target.value)}
        label={form.paymentType.label}
      />

      {form.cardNumber.isVisible && (
        <Input
          value={form.cardNumber.value}
          onChange={(e) => (form.cardNumber.value = e.target.value)}
          label={form.cardNumber.label}
          isRequired={form.cardNumber.isRequired}
          isInvalid={form.cardNumber.isInvalid}
          errorMessage={form.cardNumber.errorMessage}
        />
      )}

      {form.passport.isVisible && <PassportSection passport={form.passport} />}

      <Button type="submit" isLoading={form.submitting}>
        Оплатить
      </Button>
    </form>
  );
}
```

### 3. Изолированный ре-рендер дочернего компонента

Если дочернему компоненту нужен **независимый** трекинг, передайте поддерево в `useForm`:

```tsx
function PassportSection({ passport }) {
  // Собственный tracking proxy — ре-рендер только при изменении полей passport
  const p = useForm(passport);

  return (
    <>
      <Input value={p.number.value} onChange={(e) => (p.number.value = e.target.value)} label={p.number.label} />
      <Input value={p.issueDate.value} onChange={(e) => (p.issueDate.value = e.target.value)} label={p.issueDate.label} />
    </>
  );
}
```

> **Без `useForm` в дочернем** — компонент рендерится каскадно вместе с родителем. Подходит для простых листовых компонентов.

---

## Концепции

### Два узла: лист и группа

Тип узла определяется наличием свойства `value`:

```
Есть "value"  →  листовой узел (поле формы)
Нет "value"   →  групповой узел (контейнер или секция)
```

```typescript
const config = {
  // Листовой узел — управляет значением
  email: { value: "", isRequired: true },

  // Групповой узел — контейнер с вычисленными свойствами
  address: {
    isVisible: (v) => v.showAddress,
    city:    { value: "" },
    country: { value: "RU" },
  },
};
```

### Как работает трекинг

```
Рендер: читаем form.email.value, form.phone.value
        → accessed = { emailNode, phoneNode }

SET form.city.value   → cityNode++  → snapshot не изменился → нет ре-рендера ✓
SET form.email.value  → emailNode++ → snapshot изменился    → ре-рендер       ✓
```

Родитель, который только навигирует (`form.passport`), но не читает поля — **не ре-рендерится** при изменении полей внутри `passport`.

### Поток данных при SET

```
form.email.value = "user@example.com"
  │
  ├─ 1. formatter(rawValue, allValues)    → нормализованное значение
  ├─ 2. storeValue()                      → nodeState обновлён, valuesCache O(1)
  ├─ 3. setter(value, allValues)?         → patch → applyPatch() смежных полей
  ├─ 4. recompute(changedNodes)           → таргетированный пересчёт FieldState
  ├─ 5. recomputeDirtyTargeted()          → dirty флаги вверх по дереву
  ├─ 6. notifyChanged()                   → version++ → useSyncExternalStore → ре-рендер
  └─ 7. onChangePipeline.fire()           → onChange callback (fire-and-forget)
```

---

## API Reference

### `createProxyStore(options)`

```typescript
import { createProxyStore } from "palistor/store/store";

const store = createProxyStore({
  config: { /* дерево ConfigNode */ },
  initialValues?: { /* перекрывают значения из конфига */ },
});
```

**`ProxyStore<TConfig>` — возвращаемое значение:**

| Свойство / метод | Тип | Описание |
|---|---|---|
| `store.proxy` | `ConfigProxy<TConfig>` | Реактивный прокси — структура повторяет конфиг |
| `store.getValues()` | `DeepValues<TConfig>` | Все текущие значения вложенным объектом |
| `store.submit()` | `Promise<SubmitResult>` | Submit root-группы |
| `store.reset(values?)` | `void` | Сброс к defaults (или к переданным значениям) |
| `store.set(data)` | `string` | Upsert entity; возвращает `id` |
| `store.delete(id)` | `boolean` | Удалить entity из реестра |
| `store.rekey(oldId, newId)` | `void` | Переименовать entity во всех списках |
| `store.subscribe(node, fn)` | `() => void` | Подписка на изменения узла; возвращает unsubscribe |
| `store.subscribeGlobal(fn)` | `() => void` | Подписка на любые изменения |
| `store.getVersion()` | `number` | Глобальная версия (инкремент при каждом изменении) |
| `store.getNodeVersion(node)` | `number` | Версия конкретного узла |
| `store.setTranslator(fn \| null)` | `void` | Зарегистрировать i18n-функцию |
| `store.setNotifier(fn \| null)` | `void` | Зарегистрировать функцию уведомлений |
| `store.persist` | `PersistManager` | Менеджер персистенции |

---

### `useForm(source)`

```typescript
import { useForm } from "palistor/react/useForm";

const form = useForm(store);           // tracking поверх корневого proxy
const section = useForm(form.address); // свой tracking для поддерева
```

Возвращает типизированный `ConfigProxy<TConfig>`. Ре-рендер только при изменении нод, к которым компонент обращался через `FIELD_STATE_PROPS`.

**Паттерны подписки:**

| Паттерн | Когда использовать |
|---|---|
| `useForm(store)` + пропсы вниз | Простые формы, листовые UI-компоненты |
| `useForm(subtree)` в дочернем | Крупные секции с независимым ре-рендером |
| Проп без `useForm` | Pure UI-компоненты, рендерятся каскадно за родителем |

---

### Листовой узел — доступные свойства

```typescript
// Чтение (реактивно — добавляет ноду в tracking set)
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
form.email.dirty          // → boolean

// Запись — триггерит formatter → setter → recompute → notify
form.email.value = "new@example.com";
form.email.onValueChange("new@example.com"); // эквивалентно
```

### Групповой узел — доступные свойства

```typescript
form.passport.isVisible     // → boolean
form.passport.isRequired    // → boolean | undefined
form.passport.isReadOnly    // → boolean | undefined
form.passport.isDisabled    // → boolean | undefined
form.passport.isInvalid     // → boolean | undefined
form.passport.errorMessage  // → string | undefined
form.passport.submitting    // → boolean
form.passport.loading       // → boolean (async resolver)
form.passport.dirty         // → boolean (хотя бы одно поле изменилось)
form.passport.revalidate    // → boolean (true после первого неудачного submit)
form.passport.values        // → Record<string, unknown> — live-снапшот значений группы

await form.passport.submit();         // → SubmitResult
form.passport.reset({ number: "" });  // сброс поддерева
```

`values` — живая ссылка на вложенный объект `valuesCache`, отражающий текущие значения всех листовых полей группы (рекурсивно). Обновляется in-place при каждой записи — стабильная ссылка, безопасна для передачи в API:

```typescript
const vals = form.passport.values;
// → { number: "AB1234", issueDate: "2020-01-01" }

await api.submit(vals); // стабильная ссылка, всегда актуальна
```

---

### `ConfigNode` — схема поля

```typescript
// Листовой узел (есть "value")
interface LeafNode<TValue, TValues> {
  value?: TValue | ((values: TValues) => TValue);
  validate?:     (value: TValue, values: TValues) => string | undefined | false;
  formatter?:    (value: unknown, values: TValues) => TValue;
  setter?:       (value: TValue, values: TValues) => DeepPartialValues<TValues>;
  beforeSubmit?: (value: TValue, values: TValues) => TValue;
  dependencies?: readonly string[];  // для топологической сортировки computed
  componentProps?: Record<string, unknown>;

  label?:       string | ((values: TValues) => string);
  placeholder?: string | ((values: TValues) => string);
  description?: string | ((values: TValues) => string);
  isVisible?:   boolean | ((values: TValues) => boolean);  // default: true
  isRequired?:  boolean | ((values: TValues) => boolean);  // default: false
  isDisabled?:  boolean | ((values: TValues) => boolean);  // default: false
  isReadOnly?:  boolean | ((values: TValues) => boolean);  // default: false
}

// Групповой узел (нет "value")
interface GroupNode<TValues> {
  beforeSubmit?: (values: TValues) => TValues;
  onSubmit?:     (values: TValues) => Promise<unknown> | unknown;
  afterSubmit?:  (result: unknown, actions: { reset: () => void }) => void | Promise<void>;
  reset?:        (defaults: TValues) => TValues;
  onChange?:     (info: OnChangeInfo<TValues>) => DeepPartialValues<TValues> | void | Promise<...>;
  resolve?:      ResolveConfig<TValues>;

  isVisible?:   boolean | ((values: TValues) => boolean);
  isRequired?:  boolean | ((values: TValues) => boolean);
  isDisabled?:  boolean | ((values: TValues) => boolean);
  isReadOnly?:  boolean | ((values: TValues) => boolean);

  [key: string]: LeafNode | GroupNode | ListNode | any;
}

// Список (массив длиной 1 или 2)
type ListNode = [TemplateGroupNode] | [TemplateGroupNode, ListConfig];
```

---

### `SubmitResult`

```typescript
type SubmitResult =
  | { success: true;  result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };
```

---

## Рецепты

### Computed value

```typescript
createProxyStore({
  config: {
    price:    { value: 100 },
    quantity: { value: 2 },
    total:    { value: (v) => v.price * v.quantity, isReadOnly: true },
  },
});
```

### Цепочка computed (топологическая сортировка)

```typescript
config: {
  price: { value: 100 },
  tax:   { value: (v) => v.price * 0.2,       dependencies: ["price"] },
  total: { value: (v) => v.price + v.tax,      dependencies: ["price", "tax"] },
}
```

### formatter — нормализация при записи

```typescript
email: {
  value: "",
  formatter: (v) => String(v).trim().toLowerCase(),
},
```

### setter — каскадное изменение нескольких полей

```typescript
country: {
  value: "RU",
  setter: (value) => ({ city: "" }), // сбрасываем city при смене country
},
```

### onChange — реакция на изменение поля

```typescript
passport: {
  onChange: ({ fieldKey, newValue, allValues }) => {
    if (fieldKey === "number") return { issueDate: "" };
  },
  number:    { value: "" },
  issueDate: { value: "" },
},
```

### beforeSubmit — трансформация перед отправкой

```typescript
phone: {
  value: "",
  beforeSubmit: (value) => value.replace(/\D/g, ""), // не мутирует store
},
```

### Групповой submit с валидацией

```typescript
const store = createProxyStore({
  config: {
    company: {
      onSubmit: async (values) => api.saveCompany(values.company),
      afterSubmit: (_result, { reset }) => {
        showSuccessToast();
        reset();
      },
      name:  { value: "", isRequired: true },
      taxId: { value: "" },
    },
  },
});

const result = await store.proxy.company.submit();
if (!result.success) {
  console.log(result.errors);
  // [{ path: "company.name", message: "Обязательное поле" }]
}
```

### Получение значений для отправки

```typescript
const values = store.getValues();
// → { paymentType: "bank", passport: { number: "AB123", issueDate: "2020-01-01" } }
await api.submit(values);
```

---

## Async Resolver

Конфигурируется на групповом узле. Загружает данные асинхронно — с авто-трекингом зависимостей, retry и поддержкой React Suspense.

```typescript
const store = createProxyStore({
  config: {
    userId: { value: "" },

    userInfo: {
      resolve: {
        // values — tracking proxy: GET-доступы автоматически становятся зависимостями.
        // При изменении userId resolver перезапустится.
        resolver: async (values) => {
          const data = await api.getUser(values.userId);
          return { name: data.name, email: data.email };
        },

        // Мгновенный placeholder до завершения resolver
        optimisticResolver: (values) => ({ name: "Загрузка..." }),

        onError: (error, ctx) => {
          ctx.notify("Не удалось загрузить данные", "USER_LOAD_ERROR");
        },

        options: {
          lazy: true,      // ждать первого обращения к узлу (default: true)
          suspense: false, // throw promise для React Suspense (default: false)
          retry: { attempts: 3, delay: 1000 },
        },
      },

      name:  { value: "" },
      email: { value: "" },
    },
  },
});
```

```tsx
const form = useForm(store);

// Без Suspense — ручная проверка loading
if (form.userInfo.loading) return <Spinner />;

// С Suspense — автоматически
<Suspense fallback={<Spinner />}>
  <UserInfoSection />
</Suspense>
```

**Поведение при изменении зависимости:**

```
userId меняется
  → notifyChanged → findResolvesToRetrigger
  → resetResolveState(idle) → triggerResolve()
  → optimisticResolver применяется мгновенно
  → resolver запускается заново
```

---

## Списки и сущности

Списки объявляются как массив длиной 1 или 2, где `[0]` — шаблон элемента:

```typescript
const store = createProxyStore({
  config: {
    users: [
      // Шаблон — описывает поля каждого элемента
      {
        id:    { value: "" },
        name:  { value: "", isRequired: true },
        email: { value: "" },
      },
      // Опциональный конфиг списка
      {
        resolve: {
          resolver: async () => {
            const data = await api.getUsers();
            return data; // Array<{ id, name, email }>
          },
        },
      },
    ],
  },
});
```

### List Proxy API

```typescript
const form = useForm(store);

// Чтение
form.users.items    // ReadonlyArray<EntityProjectionProxy>
form.users.length   // number
form.users.loading  // boolean
form.users.dirty    // boolean — состав списка изменился vs. baseline

// Итерация
form.users.map((item, index, id) => <Row key={id} item={item} />)
for (const item of form.users) { ... }

// Мутации
form.users.add({ name: "Alice", email: "alice@example.com" }); // объект → upsert + добавить
form.users.add("existing-id");                                  // строка → добавить существующую
form.users.remove("user-id");
form.users.setItems(["id1", "id2", "id3"]);  // bulk замена
form.users.getById("user-id");               // → EntityProjectionProxy | undefined
```

### EntityProjectionProxy — свойства элемента списка

Каждый элемент `form.users.items` — это `EntityProjectionProxy`. Доступные свойства:

```typescript
const item = form.users.items[0];

item.id           // string — идентификатор entity
item.name.value   // значение поля через template (с formatter/validate/isRequired)
item.name.label   // computed label из template
item.name.isRequired  // computed isRequired из template
// ... все leaf props: value, label, placeholder, isRequired, isReadOnly, isDisabled,
//     isVisible, isInvalid, errorMessage, dirty, onValueChange

item.loading      // boolean — идёт ли resolve для этого entity
item.submitting   // boolean — идёт ли submit для этого entity
item.values       // Record<string, unknown> — plain объект значений entity
await item.submit(); // → SubmitResult — submit этого entity через template
```

`item.values` — plain объект с текущими значениями полей entity, пригодный для передачи в API:

```typescript
form.users.map((item) => {
  console.log(item.values); // → { name: "Alice", email: "alice@example.com" }
});
```

### Работа с entity

```typescript
// Создать / обновить entity — возвращает id
const id = store.set({ name: "Bob", email: "bob@example.com" });

// Если id не передан — генерируется временный (_tmp_...)
// После сохранения на сервере переименуйте:
store.rekey(tmpId, serverAssignedId);

// Удалить entity
store.delete(id);
```

---

## Persist

Автосохранение состояния формы в любом хранилище.

### React-хук (рекомендуется)

```tsx
import { usePersist } from "palistor/react/usePersist";

function PaymentPage({ orderId }: { orderId: string }) {
  usePersist(paymentStore, {
    key: `payment-${orderId}`,   // ключ может зависеть от пропсов
    driver: localStorageDriver,
    debounce: 500,               // ms, default: 100
    pick: ["cardNumber"],        // персистировать только эти top-level поля
    // omit: ["cvv"],            // или исключить чувствительные поля
  });

  const form = useForm(paymentStore);
  // ...
}
```

### Вне React

```typescript
import { localStorageDriver, sessionStorageDriver } from "palistor/store/persist";

paymentStore.persist.enable({
  key: "payment",
  driver: localStorageDriver,
});

await paymentStore.persist.flush();  // принудительное сохранение
paymentStore.persist.disable();
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

**`PersistOptions`:**

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| `key` | `string` | — | Ключ хранения |
| `driver` | `PersistDriver` | — | Реализация хранилища |
| `debounce` | `number` | `100` | Задержка записи, ms |
| `serialize` | `fn` | `JSON.stringify` | Кастомный сериализатор |
| `deserialize` | `fn` | `JSON.parse` | Кастомный десериализатор |
| `pick` | `string[]` | — | Персистировать только эти top-level ключи |
| `omit` | `string[]` | — | Исключить эти ключи (игнорируется если задан `pick`) |

---

## i18n

Регистрируйте функцию перевода один раз — в layout или провайдере. Все компоненты с `useForm` получат переведённые `label`, `placeholder`, `description` автоматически. При смене локали все компоненты перерендерятся.

```tsx
import { useTranslations } from "next-intl";
import { useTranslator } from "palistor/react/useTranslator";

function RootLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  useTranslator(paymentStore, t);
  return <>{children}</>;
}
```

В конфиге `label` / `placeholder` задаются как функции-переводчики:

```typescript
cardNumber: {
  value: "",
  label:       (t) => t("fields.cardNumber"),
  placeholder: (t) => t("fields.cardNumber.placeholder"),
},
```

> Без translator функции возвращают свой результат вызова как есть — удобно для тестов без i18n-окружения.

---

## Уведомления

Регистрирует функцию toast-уведомлений для использования внутри `resolve.onError`:

```tsx
import { useNotifier } from "palistor/react/useNotifier";

function RootLayout({ children }: { children: React.ReactNode }) {
  const notifyError = useCallback((error: unknown, code?: string) => {
    addToast({ title: code ?? "Ошибка", color: "danger" });
  }, []);

  useNotifier(paymentStore, notifyError);
  return <>{children}</>;
}
```

---

## Структура модуля

```
palistor/
├── index.ts                        # Публичный API
├── store/
│   ├── store/
│   │   ├── palistor.ts             # Palistor — ядро системы (kernel + ProxyStore)
│   │   ├── registerNodes.ts        # Инициализация leafNodes + nodeState
│   │   └── types.ts                # ConfigNode, ProxyStore, ListState и др.
│   ├── buildProxy/
│   │   ├── buildProxy.ts           # Proxy слой 1: GET/SET traps
│   │   ├── buildListProxy.ts       # List proxy: items, add, remove, map…
│   │   └── buildEntityProjectionProxy.ts  # Entity proxy через template
│   ├── compute/
│   │   └── recompute/              # recomputeLeaves, recomputeTargeted, topologicalSort
│   ├── writePipeline/              # formatter → storeValue → setter
│   ├── submitPipeline/             # beforeSubmit → validate → onSubmit → afterSubmit
│   ├── resetPipeline/              # Сброс к defaults
│   ├── onChangePipeline/           # onChange callback
│   ├── resolvePipeline/            # Async resolver: deps, retry, optimistic, suspense
│   ├── dirtyTracking/              # captureInitialValues, recomputeDirtyTargeted
│   ├── entityRegistry/             # Нормализованный реестр сущностей
│   ├── groupDeps/                  # Карта зависимостей между группами
│   ├── traversal/                  # isLeaf / isGroup / isListNode / walkFull
│   ├── valuesCache/                # buildValuesCache + O(1) updateValuesCacheEntry
│   ├── init/                       # NotificationHub, ResolveManager, initGroupSubmitting
│   └── persist/
│       ├── persistManager.ts       # enable / disable / flush
│       ├── drivers.ts              # localStorageDriver, sessionStorageDriver
│       └── types.ts                # PersistDriver, PersistOptions
└── react/
    ├── useForm.ts                  # useSyncExternalStore + tracking proxy
    ├── createTrackingProxy.ts      # Proxy слой 2: запись accessed нод
    ├── useTranslator.ts            # Регистрация i18n-функции
    ├── useNotifier.ts              # Регистрация функции уведомлений
    └── usePersist.ts               # React-интеграция persist
```

---

## Лицензия

MIT

