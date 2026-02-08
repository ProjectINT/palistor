# Palistor — Архитектура

## Принятые решения

- **Клиентская форма** (`"use client"`), возможность засетить начальные данные с сервера через `initial`
- **ID формы = ID сущности** (`user.id`, `order.id`, `"NewOrder"`, `"NewClient"`)
- **Состояние вне React**, React только подписывается через хуки
- **`translate`** — функция с интерфейсом `(key: string, params?) => string`, не привязана к конкретной i18n библиотеке
- **Один хук `getFieldProps(key)`** для получения пропсов с подпиской (вместо россыпи `useFieldValue`, `useFieldError` и т.д.)
- **`onSubmit`, `onChange`** — передаются в `useForm`, не в конфиг на уровне модуля
- **Стабильный контракт** — `useForm` всегда возвращает один и тот же API, не меняет поведение
- **Нет PalistorProvider** — `translate` решается через `translateFunction` в `createForm`

---

## Выбранная архитектура: createForm + useForm(id)

### Идея

`createForm` вызывается на уровне модуля — задаёт **статическую конфигурацию** формы (поля, дефолты, валидации, зависимости). Возвращает типизированный `useForm` хук.

`useForm(id)` вызывается в React-компоненте — привязывает конфигурацию к **конкретному экземпляру** (по ID сущности). Внутри хука вызывается `translateFunction()` для получения строк. Хук сам находит или создаёт store в registry.

```
createForm()                 ← модульный уровень (config/orderForm.ts)
  ├── config, defaults       ← статика: поля, валидации, зависимости
  ├── translateFunction      ← ссылка на хук i18n (вызовется внутри useForm)
  ├── type                   ← "Order", "Client" — для registry key и persist
  │
  └── useForm(id)            ← React-хук (типизированный, привязан к config)
      ├── id → registry key  ← "NewOrder" | order.id
      ├── translate()        ← translateFunction вызывается здесь, внутри React
      └── возвращает API     ← { getFieldProps, setValue, submit, ... }
```

### Почему не нужен PalistorProvider

`createForm` принимает `translateFunction` — **ссылку на хук** (например `useTranslations`). Хук вызывается внутри `useForm`, то есть уже в React-контексте, где доступны все провайдеры.

```ts
// createForm принимает ссылку на хук (не вызов!)
createForm({
  translateFunction: useTranslations,
});

// useForm внутри делает:
const t = translateFunction(); // ← вызов внутри React, NextIntlClientProvider доступен
```

Провайдер не нужен — `useForm` сам является хуком и имеет доступ ко всем контекстам выше по дереву.

---

## API

### Конфигурация (модульный уровень)

```ts
// config/orderForm.ts
import { createForm } from 'palistor';
import { useTranslations } from 'next-intl';
import { orderConfig, orderDefaults } from './orderConfig';

export const { useForm } = createForm<OrderValues>({
  config: orderConfig,
  defaults: orderDefaults,
  translateFunction: useTranslations,
  type: "Order",               // ← registry key: "Order:NewOrder", "Order:abc-123"
});
```

`type` + `id` дают уникальный ключ в registry и localStorage:
- `"Order:NewOrder"` — черновик нового заказа
- `"Order:abc-123"` — редактирование существующего

### useForm — сигнатура

```ts
interface UseFormOptions<TValues> {
  /** Данные с сервера — мержатся в store при каждом изменении ссылки */
  initial?: Partial<TValues>;

  /** Отправка формы */
  onSubmit?: (values: TValues) => Promise<SubmitResult>;

  /** Трансформация перед валидацией и отправкой */
  beforeSubmit?: (values: TValues) => Promise<TValues> | TValues;

  /** Сайд-эффекты после успешного submit */
  afterSubmit?: (result: SubmitResult, reset: () => void) => Promise<void> | void;

  /**
   * Вызывается при изменении любого поля ПОСЛЕ пересчёта computed
   * Можно вернуть Partial для мержа в values
   */
  onChange?: (params: OnChangeParams<TValues>) => Partial<TValues> | void | Promise<Partial<TValues> | void>;

  /** Переопределить авто-persist key (по умолчанию type:id) */
  persistId?: string;
}

// Корневой компонент — передаёт initial данные и колбэки
const api = useForm(id, options?: UseFormOptions<TValues>);

// Вложенный компонент — подключается к существующему store
const api = useForm(id);
```

Контракт стабильный: `useForm` **всегда** возвращает одинаковый API. Разница — корневой компонент передаёт `options`, вложенные — нет. Но API один и тот же.

### useForm — возвращаемый API

```ts
interface UseFormReturn<TValues> {
  // Поля
  getFieldProps: <K extends keyof TValues>(key: K) => FieldProps<TValues[K]>;

  // Actions
  setValue:  <K extends keyof TValues>(key: K, value: TValues[K]) => void;
  setValues: (values: Partial<TValues>) => void;
  reset:     (next?: Partial<TValues>) => void;
  submit:    () => Promise<void>;

  // Состояние формы (подписка)
  dirty:      boolean;
  submitting: boolean;
  isValid:    boolean;

  // Утилиты
  getVisibleFields: () => Array<keyof TValues & string>;
}
```

### FieldProps — пропсы поля

```ts
interface FieldProps<TValue> {
  value:         TValue;
  label?:        string;
  placeholder?:  string;
  description?:  string;
  error?:        string;
  isVisible:     boolean;
  isDisabled:    boolean;
  isReadOnly:    boolean;
  isRequired:    boolean;
  isInvalid:     boolean;
  errorMessage?: string;
  onValueChange: (value: InputValueType<TValue>) => void;
}
```

---

## Примеры использования

### Корневой компонент (инициализация с серверными данными)

```tsx
import { useForm } from '@/config/orderForm';

export function OrderPage({ order }: { order?: Order }) {
  const { getFieldProps, submit } = useForm(order?.id ?? "NewOrder", {
    initial: order,
    onSubmit: async (values) => {
      const saved = await api.saveOrder(values);
      router.push(`/orders/${saved.id}`);
    },
  });

  return <Input {...getFieldProps("name")} />;
}
```

### Вложенный компонент (подключение по ID)

```tsx
import { useForm } from '@/config/orderForm';

export function OrderNameSection({ orderId }: { orderId: string }) {
  const { getFieldProps } = useForm(orderId);

  return <Input {...getFieldProps("name")} />;
}
```

### Два экземпляра одной формы на странице

```tsx
// Работает из коробки — разные ID = разные stores
<OrderForm orderId="order-1" />
<OrderForm orderId="order-2" />
```

---

## Инициализация и жизненный цикл store

### Когда создаётся store?

При первом вызове `useForm(id)` с данным `id`. Store инициализируется из `defaults` конфига (из `createForm`). Если в `options` есть `initial` — он мержится поверх defaults.

### Что если `initial` приходит позже?

Типичный сценарий — данные грузятся асинхронно:

```tsx
export function OrderPage({ orderId }: { orderId: string }) {
  const { data: order, isLoading } = useQuery(['order', orderId], fetchOrder);

  const { getFieldProps, submit } = useForm(orderId, {
    initial: order,          // ← undefined на первом рендере, объект на втором
    onSubmit: handleSubmit,
  });

  if (isLoading) return <Skeleton />;
  return <Input {...getFieldProps("name")} />;
}
```

**Как это работает под капотом:**

```
Рендер 1: useForm("order-123", { initial: undefined })
  │
  ├── Store не существует → создаём из defaults
  ├── initial === undefined → ничего не мержим
  └── Store: { name: "", email: "", ... }  ← чистые defaults

Рендер 2: useForm("order-123", { initial: { name: "Иван", email: "ivan@..." } })
  │
  ├── Store уже существует
  ├── initial изменился (новая ссылка) → мержим в store
  ├── НО: мержим только поля, которые пользователь НЕ менял (dirty check по полям)
  └── Store: { name: "Иван", email: "ivan@...", ... }  ← серверные данные

Рендер 3: useForm("order-123", { initial: { name: "Иван", email: "ivan@..." } })
  │
  ├── initial та же ссылка → ничего не делаем (Object.is check)
  └── Store без изменений
```

`useForm` внутри отслеживает ссылку на `initial` через `useRef`. При изменении ссылки — мержит новые данные в store. Это работает как `useEffect` с `[initial]` в зависимостях, но через синхронное сравнение.

### Что если пользователь уже начал заполнять?

Если `initial` приходит **после** того как пользователь начал вводить — нельзя затереть его ввод. Правило:

> **Серверные данные не перезаписывают dirty-поля**

```
Пользователь ввёл name = "Пётр" (поле стало dirty)
  ↓
initial приходит с name = "Иван"
  ↓
name остаётся "Пётр" (dirty), email берётся из initial (не dirty)
```

Реализация — при мерже `initial` проверяем каждое поле:
```ts
for (const key of Object.keys(initial)) {
  const isDirty = !Object.is(currentValues[key], initialValues[key]);
  if (!isDirty) {
    // Поле не трогали → берём из initial
    newValues[key] = initial[key];
  }
  // Поле dirty → оставляем как есть
}
```

### Колбэки (onSubmit, onChange) — тоже реактивны

Колбэки могут меняться между рендерами (замыкания на свежие данные). `useForm` всегда использует **последнюю версию** колбэка через `useRef`:

```tsx
// Это безопасно — onSubmit всегда вызовет актуальную версию
const { submit } = useForm(orderId, {
  onSubmit: async (values) => {
    // router, queryClient и т.д. — всегда актуальные из замыкания
    await api.save(values);
    queryClient.invalidateQueries(['orders']);
    router.push('/orders');
  },
});
```

Под капотом:
```ts
// Внутри useForm
const onSubmitRef = useRef(options?.onSubmit);
onSubmitRef.current = options?.onSubmit; // ← обновляем каждый рендер

const submit = useCallback(async () => {
  // ...
  await onSubmitRef.current?.(values); // ← вызываем актуальную версию
}, []);
```

### Полный жизненный цикл

```
1. createForm({ config, defaults, type })       ← модульный уровень, один раз
   └── Сохраняет config и defaults в замыкании

2. useForm(id, { initial, onSubmit })            ← первый рендер компонента
   ├── translateFunction() → получаем t          ← вызов хука i18n
   ├── registry.getOrCreate(type:id, defaults)   ← создаём store если нет
   ├── initial? → merge в store                  ← серверные данные
   ├── onSubmit → сохраняем в ref                ← колбэк
   └── return { getFieldProps, setValue, ... }    ← API

3. initial изменился (данные загрузились)         ← ре-рендер
   ├── useForm видит новую ссылку initial
   ├── merge non-dirty fields                    ← безопасный мерж
   └── store.setState → подписчики обновляются

4. Пользователь работает с формой
   ├── getFieldProps('name').onValueChange(v)    ← ввод
   ├── setValue → store.setState → recompute     ← пересчёт зависимостей
   └── getFieldProps подписчики → ре-рендер      ← только затронутые поля

5. submit()
   ├── beforeSubmit → transform values
   ├── validate all visible fields
   ├── onSubmitRef.current(values)               ← актуальный колбэк
   └── afterSubmit → side effects

6. Unmount
   ├── Store остаётся в registry                 ← для persist / возврата
   └── cleanup по стратегии (см. открытые вопросы)
```

---

## Подписка и оптимизация рендеров

`getFieldProps('name')` внутри использует `useSyncExternalStore` с селектором на `state.fields[key]`. Компонент перерендеривается **только** когда меняется объект `fields.name`.

Если компонент вызывает `getFieldProps` для нескольких полей — он подписан на эти поля, но **не на всю форму**.

> **Важно:** `getFieldProps` — это по сути хук (внутри `useSyncExternalStore`). Вызывается на верхнем уровне компонента, не в условиях/циклах.
>
> Вопрос: переименовать в `useFieldProps`? Явно видно что хук, но менее привычное имя.

---

## Смена ID (создание → сохранение)

Когда сервер возвращает реальный ID, компонент перемонтируется с новым ID через навигацию:

```tsx
// useForm("NewOrder") → сохранение → router.push → useForm("abc-123")
```

Под капотом:
1. Store `"Order:NewOrder"` — остаётся (или очищается по cleanup)
2. Store `"Order:abc-123"` — создаётся с `initial` данными из сервера
3. Черновик `"Order:NewOrder"` очищается из localStorage

---

## Что удалить из текущего кода

| Файл | Что | Почему |
|------|-----|--------|
| `react/useField.ts` | `useFieldValue` | Всё через `getFieldProps` |
| `react/useField.ts` | `useFieldError` | Всё через `getFieldProps` |
| `react/useField.ts` | `useSetFieldValue` | `setValue` из `useForm` + использует `require()` |
| `react/useField.ts` | `useFieldState` | Заменяется `getFieldProps` |
| `react/useField.ts` | `useFieldVisible` | `getFieldProps(key).isVisible` |
| `react/useFormStore.ts` | Текущий `useFormStore` | Заменяется `createForm` + `useForm` |

## Что создать

| Что | Где | Описание |
|-----|-----|----------|
| `createForm<T>(opts)` | `core/createForm.ts` | Factory — конфиг + translateFunction → `{ useForm }` |
| `useForm(id, opts?)` | Внутри `createForm` | Хук — создаёт/находит store, возвращает API |
| `getFieldProps(key)` | Внутри `useForm` | Подписка на поле через `useSyncExternalStore` |

## Что оставить

| Что | Зачем |
|-----|-------|
| `createStore` | Ядро — store вне React |
| `registry` | Хранение stores по `type:id` |
| `computeFields` | Пересчёт зависимостей |
| `actions.ts` | Чистые функции трансформации state |
| `useSelector` | Low-level escape hatch |
| `types.ts` | Типы (обновить под новый API) |

---

## Открытые вопросы

1. **Именование:** `getFieldProps` vs `useFieldProps` — первое привычнее, второе честнее (это хук)
2. **Cleanup:** когда удалять store из registry? При unmount? По таймеру? Вручную?
3. **SSR initial data:** достаточно ли `initial` в `useForm`, или нужен серверный `prefillForm()`?


