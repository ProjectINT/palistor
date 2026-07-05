# Palistor

> Декларативный фреймворк для data-driven интерфейсов на React — поведение, данные и отображение как три отдельных слоя

[English](./README.md) | **Русский**

[![npm version](https://img.shields.io/npm/v/palistor.svg)](https://www.npmjs.com/package/palistor)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![react](https://img.shields.io/badge/react-%5E19-61dafb.svg)](https://react.dev)

**Palistor — декларативный фреймворк для stateful, data-driven интерфейсов на React.** Он рассматривает экран как три независимых слоя — **конфигурация** (как он себя ведёт), **данные** (откуда берутся значения) и **отображение** (как он рендерится) — и не даёт им протекать друг в друга. Двухслойный proxy — это шов, который их связывает: чтения становятся точечными подписками, записи запускают объявленное вами поведение. Компонент перерендеривается **только** для тех полей, которые он реально читал.

```tsx
const store = new Palistor({
  config: {
    email: { value: "", isRequired: true },
    phone: { value: "", isVisible: (v) => v.email !== "" },
  },
});

function Form() {
  const form = useForm(store);
  return (
    <input
      value={form.email.value}
      onChange={(e) => (form.email.value = e.target.value)}
    />
  );
}
```

---

## Идея — три слоя, а не ещё один store

Большинство React-экранов сплетают внутри компонентов три несвязанные заботы: как экран **себя ведёт** (валидация, условные поля, кросс-полевые правила), откуда берутся его **данные** (загрузка, кэширование, мутации) и как он **выглядит** (JSX). По мере роста экрана эти три сплетаются так, что любое изменение задевает всё. А еще нарастает сложность зависимостей, useEffectов, кастомных хуков и контекстов — и в итоге экран становится монолитным, непредсказуемым и трудно тестируемым.

Palistor их разделяет:

```
┌── Конфигурация — поведение ──────────────┐   декларативно · framework-agnostic
│  поля · валидация · видимость ·          │   isVisible / isRequired / validate
│  кросс-полевые правила · зависимости ·   │   formatter / setter / onSubmit
│  жизненный цикл                          │   полностью тестируемо без React
└─────────────────────┬────────────────────┘
                      │   proxy — шов:
                      │   чтение → подписка на поле
                      │   запись → запуск объявленного пайплайна
┌── Данные — значения и сущности ──────────┐   нормализованный реестр сущностей
│  кэш значений · нормализованный реестр · │   резолверы с авто-трекингом зависимостей
│  async-резолверы                         │   retry · оптимистичные · Suspense
└─────────────────────┬────────────────────┘
                      │
┌── Отображение — рендеринг ───────────────┐   useForm(store) → tracking proxy
│  читать состояние · присваивать          │   гранулярные, по-полевые ре-рендеры
│  значения · без логики                   │
└──────────────────────────────────────────┘
```

- **Конфигурация — поведение.** Одно декларативное дерево описывает поля, валидацию, видимость, кросс-полевые правила, зависимости и жизненный цикл (`onSubmit`, `resolve`). Чистое и framework-agnostic — полностью тестируемо без React.
- **Данные — значения и сущности.** Значения текут через нормализованный реестр сущностей и async-резолверы с автоматически отслеживаемыми зависимостями, retry, оптимистичными обновлениями и Suspense.
- **Отображение — рендеринг.** Компоненты только читают реактивное состояние и присваивают значения. Они не несут логики и перерендериваются только для тех полей, которые реально прочитали.

Proxy — это шов между слоями: **чтение** (`form.email.value`) подписывает компонент на это поле; **запись** (`form.email.value = x`) запускает пайплайн, который вы объявили в конфиге — formatter → setter → recompute → notify. Ничего не связывается руками.

Выигрыш в том, что сложность растёт **по слоям**, а не по компонентам. Форма, мастер, таблица данных и админ-панель — это одни и те же три слоя в разном масштабе; именно поэтому async-загрузка, нормализованные списки, пошаговые flow, персист и i18n — часть фреймворка, а не аддоны, которые прикручиваешь потом.

---

## Содержание

- [Возможности](#возможности)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Концепции](#концепции)
- [API Reference](#api-reference)
- [Async-резолверы](#async-резолверы)
- [Списки и сущности](#списки-и-сущности)
- [Flows (пошаговые мастера)](#flows-пошаговые-мастера)
- [Field mapping](#field-mapping)
- [Persist](#persist)
- [i18n](#i18n)
- [Уведомления](#уведомления)
- [Контекст store](#контекст-store)
- [TypeScript](#typescript)
- [Лицензия](#лицензия)

---

## Возможности

| | |
|---|---|
| **Гранулярные ре-рендеры** | Компонент подписывается только на те поля, которые он читал — больше ничего не триггерит ре-рендер |
| **Computed field state** | `isVisible`, `isRequired`, `label`, ошибки валидации пересчитываются автоматически по конфигу |
| **Proxy API** | Нативный синтаксис: `form.email.value = x` вместо диспатча экшенов |
| **Submit pipeline** | `beforeSubmit → validate → onSubmit → afterSubmit`; ошибки показываются после первого неудачного submit |
| **Dirty tracking** | Per-field и per-group флаги изменений; baseline обновляется после resolve и reset |
| **Async-резолверы** | Загрузка данных с авто-трекингом зависимостей, retry, optimistic updates и React Suspense |
| **Списки и сущности** | Нормализованный реестр сущностей, list proxy с `add / remove / setItems`, per-entity шаблоны |
| **Flows** | Пошаговые мастера через `defineFlow` / `defineStep`: навигация, ветвление, валидация по шагам |
| **Field mapping** | Переименование пропсов состояния поля под конвенцию вашего UI-кита (`isRequired` → `required`, …) |
| **Persist** | Автосохранение в `localStorage`, `sessionStorage` или любой кастомный драйвер — вместе с навигацией флоу |
| **i18n** | Одна регистрация транслятора — `label`, `placeholder`, `description` переводятся везде |
| **Тестируемость** | Framework-agnostic ядро полностью тестируется без React |

---

## Установка

Пакет публикуется в **публичный npm-реестр** под именем `palistor`.

```bash
npm install palistor
# или
yarn add palistor
# или
pnpm add palistor
```

**Peer-зависимость:** `react ^19`

> **Альтернатива — GitHub Packages.** Тот же пакет доступен под scoped-именем
> `@projectint/palistor`. Добавьте в `.npmrc`:
> ```
> @projectint:registry=https://npm.pkg.github.com
> ```
> затем `npm install @projectint/palistor`. Каноническим считается имя `palistor`.

Все публичные символы доступны из корневого модуля:

```typescript
import {
  Palistor,
  useForm,
  usePersist,
  useTranslator,
  useNotifier,
  useStoreContext,
  defineList,
  defineFlow,
  defineStep,
  defineFieldMapping,
  localStorageDriver,
  sessionStorageDriver,
} from "palistor";
```

---

## Быстрый старт

### 1. Опишите форму

Конфиг декларативен: значения полей, валидация, видимость и lifecycle-колбэки живут в одном дереве. Store создаётся на уровне модуля.

```typescript
import { Palistor } from "palistor";

export const paymentStore = new Palistor({
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

### 2. Подключите компонент

```tsx
import { useForm } from "palistor";
import { paymentStore } from "./paymentStore";

function PaymentForm() {
  const form = useForm(paymentStore);

  return (
    <form onSubmit={(e) => { e.preventDefault(); paymentStore.submit(); }}>
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

      <Button type="submit" isLoading={form.submitting}>Оплатить</Button>
    </form>
  );
}
```

### 3. Изолированный ре-рендер дочернего компонента

Если дочернему компоненту нужен **независимый** трекинг, передайте поддерево пропсом и вызовите `useForm` на нём:

```tsx
function PassportSection({ passport }) {
  // Собственный tracking proxy — ре-рендер только при изменении полей passport
  const p = useForm(passport);

  return (
    <>
      <Input value={p.number.value}    onChange={(e) => (p.number.value = e.target.value)}    label={p.number.label} />
      <Input value={p.issueDate.value} onChange={(e) => (p.issueDate.value = e.target.value)} label={p.issueDate.label} />
    </>
  );
}
```

> **Без `useForm` в дочернем** компонент рендерится каскадно вместе с родителем. Для простых листовых компонентов это нормально.

---

## Концепции

### Два вида узлов: лист и группа

Вид узла определяется наличием свойства `value`:

```
Есть "value"  →  листовой узел (поле формы)
Нет  "value"  →  групповой узел (контейнер / секция)
```

```typescript
const config = {
  // Листовой узел — управляет значением
  email: { value: "", isRequired: true },

  // Групповой узел — контейнер с вычисляемыми свойствами
  address: {
    isVisible: (v) => v.showAddress,
    city:    { value: "" },
    country: { value: "RU" },
  },
};
```

### Как работает трекинг

```
Рендер: компонент читает form.email.value и form.phone.value
        → accessed = { emailNode, phoneNode }

SET form.city.value   → версия cityNode++  → snapshot не изменился → нет ре-рендера ✓
SET form.email.value  → версия emailNode++ → snapshot изменился    → ре-рендер      ✓
```

Родитель, который только навигирует (`form.passport`), но не читает состояние полей, — **не** перерендеривается при изменении полей внутри `passport`.

### Поток данных при записи

```
form.email.value = "user@example.com"
  │
  ├─ 1. formatter(rawValue, allValues)    → нормализованное значение
  ├─ 2. запись значения                   → nodeState обновлён, valuesCache за O(1)
  ├─ 3. setter(value, allValues, prev)?   → patch → применяется к смежным полям
  ├─ 4. recompute(changedNodes)           → таргетированный пересчёт FieldState
  ├─ 5. dirty-флаги                       → распространяются вверх по дереву
  ├─ 6. notify                            → version++ → useSyncExternalStore → ре-рендер
  └─ 7. onChange                          → onChange группы (fire-and-forget)
```

### Когда показываются ошибки (`revalidate`)

Ошибки валидации скрыты до первого неудачного `submit()` объемлющей группы. После него флаг группы `revalidate` становится `true`, и `isInvalid` / `errorMessage` обновляются вживую при каждом вводе.

---

## API Reference

### `new Palistor(options)`

```typescript
import { Palistor } from "palistor";

const store = new Palistor({
  config,          // дерево ConfigNode — обязательно
  initialValues,   // deep-partial значения поверх дефолтов из конфига
  context,         // начальный нереактивный контекст (см. «Контекст store»)
  fieldMapping,    // карта переименования пропсов (см. «Field mapping»)
});
```

**Store — публичный API:**

| Свойство / метод | Возвращает | Описание |
|---|---|---|
| `store.proxy` | proxy | Реактивный прокси, повторяющий конфиг. **Нельзя** передавать его (и его поддеревья) в `useForm` — передавайте сам store |
| `store.getValues()` | values | Глубокий **клон** всех текущих значений вложенным объектом |
| `store.submit()` | `Promise<SubmitResult>` | Submit корневой группы |
| `store.reset(values?)` | `void` | Сброс к дефолтам конфига (или к переданным значениям) |
| `store.setValues(patch)` | `void` | Bulk-патч: один recompute + notify; setters и formatters не вызываются |
| `store.set(data)` | `void` | Upsert entity или массива entities в реестре |
| `store.delete(id)` | `void` | Удалить entity (каскадно удаляет принадлежащие ей дочерние entity) |
| `store.rekey(oldId, newId)` | `void` | Переименовать entity в реестре и во всех списках |
| `store.invalidate(id, template?)` | `void` | Сбросить resolved-кэш entity, чтобы её resolve выполнился заново |
| `store.subscribe(node, fn)` | unsubscribe | Подписка на изменения одного узла |
| `store.subscribeGlobal(fn)` | unsubscribe | Подписка на любые изменения |
| `store.getVersion()` | `number` | Глобальная версия (инкремент при каждом изменении) |
| `store.getNodeVersion(node)` | `number` | Версия конкретного узла |
| `store.setTranslator(fn \| null)` | `void` | Зарегистрировать i18n-функцию |
| `store.setNotifier(fn \| null)` | `void` | Зарегистрировать функцию уведомлений |
| `store.setContext(ctx)` | `void` | Домержить нереактивный контекст (см. «Контекст store») |
| `store.context` | object | Текущий нереактивный контекст |
| `store.persist` | `PersistManager` | Менеджер персистенции (`enable / disable / flush`) |

---

### `useForm(source)`

```typescript
import { useForm } from "palistor";

const form    = useForm(store);            // tracking proxy поверх всего store
const section = useForm(form.address);     // независимый tracking поддерева (из пропса)
const entity  = useForm(item, (s) => s.editForm); // привязка entity к template
```

Возвращает типизированный tracking proxy. Компонент перерендеривается только при изменении узлов, к которым обращался.

| Перегрузка | Когда использовать |
|---|---|
| `useForm(store)` | Корень формы; поддеревья передаются вниз пропсами |
| `useForm(subtreeProp)` | Крупная секция с независимыми ре-рендерами |
| `useForm(entityProxy, templateSelector)` | Отображение/редактирование entity из списка через template (bind при mount, unbind при unmount) |

> ⚠️ Передача сырого поддерева `store.proxy` (например, `useForm(store.proxy.address)`) — **ошибка компиляции и рантайма**. Всегда сначала `useForm(store)`, а дальше — через возвращённый прокси.

---

### Листовой узел — свойства прокси

```typescript
// Чтение реактивно — регистрирует узел в tracking set
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
form.email.loading        // → boolean (per-field резолвер)

// Запись триггерит formatter → setter → recompute → notify
form.email.value = "new@example.com";
form.email.onValueChange("new@example.com"); // эквивалент, удобно как callback-проп

// Лист можно сабмитить и отдельно (тот же pipeline)
form.email.submitting        // → boolean
await form.email.submit();   // → SubmitResult
```

### Групповой узел — свойства прокси

```typescript
form.passport.isVisible     // → boolean
form.passport.isRequired    // → boolean | undefined
form.passport.isReadOnly    // → boolean | undefined
form.passport.isDisabled    // → boolean | undefined
form.passport.isInvalid     // → boolean | undefined
form.passport.errorMessage  // → string | undefined
form.passport.submitting    // → boolean
form.passport.loading       // → boolean (выполняется async-резолвер)
form.passport.dirty         // → boolean (хотя бы одно поле изменилось)
form.passport.revalidate    // → boolean (true после первого неудачного submit)
form.passport.values        // → живой снапшот значений группы (стабильная ссылка)

await form.passport.submit();          // → SubmitResult
form.passport.reset({ number: "" });   // сброс поддерева
form.passport.setValues({ number: "AB1234" }); // bulk-патч без setters/formatters
```

`values` — живая ссылка внутрь кэша значений: обновляется in-place при каждой записи, сама ссылка стабильна — безопасно передавать в API-вызов. Для отвязанного глубокого клона используйте `store.getValues()`.

---

### `ConfigNode` — схема поля

```typescript
// Листовой узел (есть "value")
{
  value?: TValue | ((values: TValues) => TValue),   // константа или computed
  validate?:  (value, values, t) => string | undefined | false,
  formatter?: (raw, values) => TValue,               // нормализация при записи
  setter?:    (value, values, previousValue) => DeepPartialValues<TValues>, // патч смежных полей
  beforeSubmit?: (value, groupValues) => TValue,     // трансформация перед submit (store не мутируется)
  resolve?:   Resolve<TValue>,                       // per-field резолвер (внутри template списка)
  dependencies?: string[],                           // топологический порядок для цепочек computed
  componentProps?: Record<string, unknown>,

  label?:       string | ((t, values) => string),
  placeholder?: string | ((t, values) => string),
  description?: string | ((t, values) => string),
  isVisible?:   boolean | ((values) => boolean),     // default: true
  isRequired?:  boolean | ((values) => boolean),     // default: false
  isDisabled?:  boolean | ((values) => boolean),     // default: false
  isReadOnly?:  boolean | ((values) => boolean),     // default: false
}

// Групповой узел (нет "value")
{
  beforeSubmit?: (values) => values,
  onSubmit?:     (values, store, parentProxy) => Promise<unknown> | unknown,
  afterSubmit?:  (result, { reset }) => void | Promise<void>,
  reset?:        (defaults) => values,               // трансформация при reset
  onChange?:     ({ fieldKey, newValue, previousValue, allValues }) => patch | void,
  resolve?:      Resolve,                            // async-резолвер (см. ниже)

  isVisible?, isRequired?, isDisabled?, isReadOnly?, // как у листа

  [childKey]: LeafNode | GroupNode | ListNode,       // дочерние узлы
}

// Узел-список — массив длиной 1 или 2 (или defineList)
[templateGroupNode]
[templateGroupNode, { resolve: { resolver, deps?, onError? } }]
```

### `SubmitResult`

```typescript
type SubmitResult =
  | { success: true;  result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };
```

### Рецепты

```typescript
// Computed value
total: { value: (v) => v.price * v.quantity, isReadOnly: true },

// Цепочка computed — dependencies задают топологический порядок
tax:   { value: (v) => v.price * 0.2,   dependencies: ["price"] },
total: { value: (v) => v.price + v.tax, dependencies: ["price", "tax"] },

// formatter — нормализация при записи
email: { value: "", formatter: (v) => String(v).trim().toLowerCase() },

// setter — каскадное изменение других полей
country: { value: "RU", setter: (value) => ({ city: "" }) },

// onChange группы — реакция на изменение любого поля внутри
passport: {
  onChange: ({ fieldKey }) => {
    if (fieldKey === "number") return { issueDate: "" };
  },
  number:    { value: "" },
  issueDate: { value: "" },
},

// Групповой submit с валидацией
company: {
  onSubmit: async (values) => api.saveCompany(values),
  afterSubmit: (_result, { reset }) => { showSuccessToast(); reset(); },
  name:  { value: "", isRequired: true },
  taxId: { value: "" },
},
```

---

## Async-резолверы

Резолвер конфигурируется на групповом узле. Загружает данные асинхронно — с авто-трекингом зависимостей, retry и поддержкой React Suspense.

```typescript
const store = new Palistor({
  config: {
    userId: { value: "" },

    userInfo: {
      resolve: {
        // `values` — tracking proxy: каждый GET становится зависимостью.
        // При изменении userId резолвер перезапустится автоматически.
        // `store` даёт доступ к остальному store (и к store.context).
        resolver: async (values, store) => {
          const data = await api.getUser(values.userId);
          return { name: data.name, email: data.email };
        },

        // Мгновенный placeholder, пока резолвер выполняется
        optimisticResolver: (values) => ({ name: "Загрузка…" }),

        onError: (error, ctx) => {
          ctx.notify("Не удалось загрузить данные", "USER_LOAD_ERROR");
        },

        deps: ["userId"],            // явные зависимости (для первого запуска)
        contextDeps: ["accountId"],  // ждать, пока context.accountId != null

        options: {
          lazy: true,      // ждать первого обращения к узлу (default: true)
          suspense: false, // бросать promise для React Suspense (default: false)
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

При изменении зависимости resolve-состояние сбрасывается, `optimisticResolver` применяется мгновенно, резолвер перезапускается. После успеха обновляется dirty-baseline — загруженные данные не считаются «грязными».

---

## Списки и сущности

Списки объявляются через `defineList` (предпочтительно — полная типизация) или сырым массивом длиной 1–2, где `[0]` — шаблон элемента.

```typescript
import { defineList, Palistor } from "palistor";

interface User { id: string; name: string; email: string }

const users = defineList<User>({
  template: {
    id:    { value: "" },
    name:  { value: "", isRequired: true },
    email: { value: "" },
  },
  resolve: {
    resolver: async (values, store) => api.getUsers(values.filter), // → Promise<User[]>
    deps: ["filter"],
  },
});

const store = new Palistor({
  config: { filter: { value: "" }, users },
});
```

Элементы хранятся в **нормализованном реестре сущностей**: одна entity может входить в несколько списков и отображаться через разные шаблоны без дублирования.

### List Proxy API

```typescript
const form = useForm(store);

// Чтение
form.users.items       // ReadonlyArray<entity proxy>
form.users.length      // number
form.users.loading     // boolean
form.users.dirty       // boolean — состав списка изменился vs. baseline
form.users.getValues() // Array<plain object>

// Итерация
form.users.map((item, index, id) => <Row key={id} item={item} />)
for (const item of form.users) { /* … */ }

// Мутации
form.users.add({ name: "Alice", email: "alice@ex.com" }); // объект → upsert + добавить; вернёт прокси элемента
form.users.add("existing-id");                            // строка → добавить существующую entity
form.users.remove("user-id");
form.users.setItems(["id1", "id2", "id3"]);               // bulk-замена
form.users.getById("user-id");                            // → прокси элемента | undefined
```

### Элемент списка — свойства прокси

Каждый элемент `form.users.items` — проекция entity через шаблон:

```typescript
const item = form.users.items[0];

item.id             // string — идентификатор entity
item.name.value     // значение поля через template (работают formatter/validate/isRequired)
item.name.label     // computed label из template
// …все leaf-свойства: value, label, placeholder, isRequired, isReadOnly, isDisabled,
//   isVisible, isInvalid, errorMessage, dirty, loading, onValueChange

item.loading        // boolean — для этой entity выполняется resolve
item.submitting     // boolean — для этой entity выполняется submit
item.values         // plain-объект текущих значений entity
await item.submit(); // → SubmitResult — валидация + onSubmit из template
```

### Отображение entity через другой шаблон

Привяжите entity к любой template-группе (например, форме редактирования) через двухаргументный `useForm`:

```tsx
function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user, (s) => s.editUserForm);
  return <span>{u.name.value}</span>;
}
```

При mount entity привязывается к шаблону, и резолвер шаблона выполняется один раз на пару entity+template (кэшируется). `store.invalidate(id, template?)` заставит его выполниться заново.

### Работа с entity напрямую

```typescript
// Создать / обновить entities (одна или батч — один recompute + notify)
store.set({ id: "u1", name: "Bob" });
store.set([{ id: "u1" }, { id: "u2" }]);

// Если id не передан — генерируется временный (_tmp_…).
// После того как сервер присвоил настоящий id:
store.rekey(tmpId, serverAssignedId);

// Удалить entity (принадлежащие ей дочерние удаляются каскадно)
store.delete("u1");
```

---

## Flows (пошаговые мастера)

`defineFlow` / `defineStep` строят пошаговый мастер поверх обычных групповых узлов: навигационное состояние, статусы шагов, ветвление и валидация по шагам.

```typescript
import { defineFlow, defineStep, Palistor } from "palistor";

const onboarding = defineFlow({
  steps: [
    defineStep("account", {
      fullName: { value: "", isRequired: true },
      email:    { value: "", isRequired: true },
      // Третий аргумент onSubmit — flow-proxy; навигационные методы bound,
      // поэтому деструктуризация работает:
      onSubmit: (_values, _store, { nextStep }) => nextStep(),
    }),

    defineStep("plan", {
      plan: { value: "", isRequired: true },
      onSubmit: (_values, _store, { nextStep }) => nextStep(),
    }),

    // Ветвление: скрытый шаг пропускается nextStep() и исключается из
    // финальной валидации.
    defineStep("company", {
      isVisible: (values) => values.plan.plan === "enterprise",
      companyName: { value: "", isRequired: true },
      onSubmit: (_values, _store, { nextStep }) => nextStep(),
    }),

    defineStep("summary", {}), // read-only шаг-сводка
  ],

  // Финализация уровня флоу — идёт через стандартный submit pipeline
  onSubmit: async (allValues, store) => api.completeOnboarding(allValues),
});

const store = new Palistor({ config: { onboarding } });
```

### Flow Proxy API

```tsx
const form = useForm(store);
const flow = form.onboarding;

// Навигационное состояние (реактивное)
flow.currentStepKey    // "account" | "plan" | …
flow.currentStepIndex  // number
flow.canGoBack         // boolean — стек посещений непуст
flow.history           // readonly string[] — [...visitStack, currentStepKey]
flow.errors            // FlowError[] — от последнего validate() / финализации

// Коллекция шагов
flow.steps.current     // прокси активного шага
flow.steps.account     // по ключу
flow.steps[0]          // по индексу
flow.steps.length      // число шагов
[...flow.steps]        // итерируемо

// Прокси шага = обычный group proxy + status
flow.steps.account.status   // "active" | "completed" | null (ещё не посещался)
flow.steps.account.email    // прокси поля — обычный лист

// Навигация
flow.nextStep();        // следующий ВИДИМЫЙ шаг; впереди нет → финализация через flow.submit()
flow.back();            // pop стека посещений; no-op при пустом стеке
flow.goTo("plan");      // прыжок по ключу или индексу; throw при неизвестном ключе
flow.validate();        // валидация посещённых видимых шагов → flow.errors

// Значения и финализация
flow.values             // аккумулированные значения всех шагов, по ключам шагов
await flow.submit();    // стандартный pipeline; ошибки скрытых шагов отфильтровываются
```

### Lifecycle шага

Конфиг шага, помимо всего, что умеет группа, принимает два flow-колбэка:

```typescript
defineStep("details", {
  onEnter: (flowValues, store) => { /* при входе в шаг */ },
  onReady: (flowValues, store) => { /* после завершения resolve шага */ },
  resolve: { resolver: async (values, store) => api.getDetails(), onError: () => {} },
  // …поля
})
```

При входе в шаг: `onEnter → resolve (запускается сразу) → onReady`. Первый шаг каждого флоу «входится» при создании store. Результат resolve шага кэшируется — повторный вход его не перезапускает. `reset()` флоу (или любого предка) сбрасывает навигацию на первый шаг и заново выполняет entry lifecycle.

Навигация флоу (текущий шаг, история) входит в снапшот [persist](#persist) и восстанавливается при гидратации.

---

## Field mapping

`fieldMapping` переименовывает пропсы состояния поля **на границе proxy** — GET, SET, tracking и spread, — так что `{...form.email}` можно спредить напрямую в компонент MUI, Ant Design или нативный HTML без адаптеров. Внутреннее ядро не меняется.

```typescript
import { Palistor, defineFieldMapping, useForm } from "palistor";

// defineFieldMapping сохраняет литеральные типы — переименованные пропсы
// статически типизированы на store.proxy / useForm(store).
const uiFieldMapping = defineFieldMapping({
  isRequired:   "required",
  isDisabled:   "disabled",
  isReadOnly:   "readOnly",
  isInvalid:    "error",
  errorMessage: "helperText",
  description:  "helpText",
});

const store = new Palistor({
  // Конфиг пишется в ТОМ ЖЕ публичном словаре (external-имена).
  // Написать internal-имя (isRequired) ремапленного ключа — ошибка типа.
  config: {
    email: {
      value: "",
      label: "Email",
      required: true,
      helpText: "Мы никому не передаём ваш email",
      validate: (v: string) => (!v.includes("@") ? "Некорректный email" : undefined),
    },
  },
  fieldMapping: uiFieldMapping,
});

function EmailField() {
  const form = useForm(store);
  return <TextField {...form.email} />; // required / error / helperText — как ждёт MUI
}
```

Переименовываемые ключи: `value`, `label`, `placeholder`, `description`, `isRequired`, `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`, `loading`, `onValueChange`. Без `fieldMapping` — нулевой оверхед и никаких изменений поведения.

> Для переиспользуемой карты используйте `defineFieldMapping` (или `as const`) — аннотация `: FieldMapping` или `satisfies FieldMapping` расширит литералы до `string`, и статическое переименование потеряется.

---

## Persist

Автосохранение состояния формы в любое хранилище.

### React-хук (рекомендуется)

```tsx
import { usePersist, localStorageDriver } from "palistor";

function PaymentPage({ orderId }: { orderId: string }) {
  usePersist(paymentStore, {
    key: `payment-${orderId}`,   // ключ может зависеть от пропсов / роутера
    driver: localStorageDriver,
    debounce: 500,               // ms, default: 100
    pick: ["cardNumber"],        // персистить только эти top-level поля
    // omit: ["cvv"],            // …или исключить чувствительные
  });

  const form = useForm(paymentStore);
  // …
}
```

Хук гидратирует при mount, автосохраняет при изменениях, при unmount делает flush и отключается.

### Вне React

```typescript
import { localStorageDriver } from "palistor";

paymentStore.persist.enable({ key: "payment", driver: localStorageDriver });
await paymentStore.persist.flush();   // принудительное сохранение
paymentStore.persist.disable();
```

### Кастомный драйвер

Синхронный или асинхронный — поддерживаются оба (localStorage, IndexedDB, AsyncStorage, …):

```typescript
import type { PersistDriver } from "palistor";

const myDriver: PersistDriver = {
  getItem:    (key)        => myStorage.get(key),      // string | null | Promise<…>
  setItem:    (key, value) => myStorage.set(key, value),
  removeItem: (key)        => myStorage.delete(key),
};
```

**`PersistOptions`:**

| Опция | Тип | По умолчанию | Описание |
|---|---|---|---|
| `key` | `string` | — | Ключ хранения |
| `driver` | `PersistDriver` | — | Реализация хранилища |
| `debounce` | `number` | `100` | Задержка записи, ms (`0` = мгновенно) |
| `serialize` | `fn` | `JSON.stringify` | Кастомный сериализатор |
| `deserialize` | `fn` | `JSON.parse` | Кастомный десериализатор |
| `pick` | `string[]` | — | Персистить только эти top-level ключи |
| `omit` | `string[]` | — | Исключить эти ключи (игнорируется при заданном `pick`) |

В снапшот входят состав списков и навигация флоу; и то и другое восстанавливается при гидратации.

---

## i18n

Зарегистрируйте функцию перевода один раз — в layout или провайдере. Все компоненты с `useForm` автоматически получат переведённые `label` / `placeholder` / `description`; при смене локали подписанные компоненты перерендерятся.

```tsx
import { useTranslations } from "next-intl";
import { useTranslator } from "palistor";

function RootLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  useTranslator(paymentStore, t);
  return <>{children}</>;
}
```

В конфиге переводимые строки — функции от `(t, values)`:

```typescript
cardNumber: {
  value: "",
  label:       (t) => t("fields.cardNumber"),
  placeholder: (t) => t("fields.cardNumber.placeholder"),
},
```

Колбэк `validate` тоже получает `t` третьим аргументом. Без зарегистрированного транслятора функции получают identity-`t` — удобно для тестов и SSR без i18n-окружения.

---

## Уведомления

Зарегистрируйте функцию toast/alert один раз; резолверы получат её в `onError` через `ctx.notify`:

```tsx
import { useCallback } from "react";
import { useNotifier } from "palistor";

function RootLayout({ children }: { children: React.ReactNode }) {
  const notifyError = useCallback((error: unknown, code?: string) => {
    addToast({ title: code ?? "Ошибка", color: "danger" });
  }, []);

  useNotifier(paymentStore, notifyError);
  return <>{children}</>;
}
```

---

## Контекст store

Нереактивные данные (id аккаунта, tenant, токены…), доступные во всех колбэках через `store.context`. Не является частью формы — не попадает в `getValues()`, submit-payload и persist.

```tsx
import { useStoreContext } from "palistor";

function Layout({ children }) {
  const accountId = useAccountId();
  useStoreContext(store, { accountId }); // мержится в store.context
  return <>{children}</>;
}
```

```typescript
resolve: {
  resolver: async (values, store) => api.fetchUsers(store.context.accountId),
  contextDeps: ["accountId"], // не запускаться, пока context.accountId == null
},
```

Изменение ключа контекста перезапускает зависящие от него резолверы (через `contextDeps` или затреканный путь `$context.…`). Начальный контекст можно передать в конструктор: `new Palistor({ config, context: { accountId } })`.

---

## TypeScript

Palistor полностью типизирован — значения, прокси, entity и даже переименования `fieldMapping` выводятся статически.

### Вывод типа значений из конфига

```typescript
import type { ExtractValues, DeepPartialValues } from "palistor";

const config = {
  name:    { value: "" },
  age:     { value: 0 },
  address: { city: { value: "" }, country: { value: "RU" } },
};

type FormValues = ExtractValues<typeof config>;
// → { name: string; age: number; address: { city: string; country: string } }

const initial: DeepPartialValues<FormValues> = { address: { city: "Москва" } };
```

### Типизация пропсов дочерних компонентов без импорта конфига

`PalistorProxy<T>` маппит простой интерфейс значений на прокси-дерево (тип называется `PalistorProxy`, потому что имя `Palistor` занято классом store):

```typescript
import type { PalistorProxy } from "palistor";

interface UserData { name: string; email: string; address: { city: string } }

function UserForm({ user }: { user: PalistorProxy<UserData> }) {
  const u = useForm(user);
  return <input value={u.name.value} onChange={(e) => (u.name.value = e.target.value)} />;
}
```

### Типизированные ссылки на entity

```typescript
import type { PalistorRef, PalistorList, InferEntity } from "palistor";

interface User { id: string; name: string }

function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user, (s) => s.editUserForm);
  return <span>{u.name.value}</span>;
}

type UserEntity = InferEntity<PalistorRef<User>>; // → User
type UsersList  = PalistorList<User>;             // типизированный list proxy
```

### Справочник типов

| Тип | Назначение |
|-----|-----------|
| `ExtractValues<TConfig>` | Тип значений, выведенный из конфига |
| `ConfigProxy<TConfig>` | Полный тип прокси — то, что возвращает `useForm(store)` |
| `PalistorProxy<T>` | Прокси из простого интерфейса значений — для пропсов дочерних компонентов |
| `PalistorRef<TEntity>` | Непрозрачная ссылка на entity — для пропсов одного элемента |
| `PalistorList<TEntity>` | Типизированный list proxy |
| `InferEntity<T>` | Извлечь тип entity из `PalistorRef` |
| `FieldMapping` / `defineFieldMapping` | Карта переименования пропсов (сохраняет литералы) |
| `FlowProxyNode<S>` / `FlowStepProxy<C>` / `StepStatus` | Типы flow-прокси |
| `MaybeComputed<TResult, TValues>` | Константа или `(values) => T` — `isVisible`, `isRequired`, `value` |
| `MaybeTranslatable<TResult, TValues>` | Константа или `(t, values) => string` — `label`, `placeholder` |
| `DeepPartialValues<T>` | Глубокий partial значений: `initialValues`, патчи `setter`, `setValues` |
| `TranslateFn` | Совместим с next-intl `t`, i18next `t`, любым `(...args) => string` |
| `TemplateConfig<TEntity>` / `ListResolver<TEntity>` | Типизированный шаблон / резолвер списка |
| `PersistDriver` / `PersistOptions` | Контракты персистенции |
| `Resolve<T>` / `NotifyFn` / `ResolveErrorContext` | Контракты резолверов |

---

## Лицензия

[MIT](./LICENSE) © Yuri Palienko
