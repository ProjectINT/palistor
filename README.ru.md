# Palistor

> декларативный MVVM like фреймворк для React, ИИ дружелюбный, формы, списки и пошаговые мастера.

[English](./README.md) | **Русский**

[![npm version](https://img.shields.io/npm/v/palistor.svg)](https://www.npmjs.com/package/palistor)
[![npm cube](https://img.shields.io/npm/v/palistor/cube.svg?label=palistor%40cube)](https://www.npmjs.com/package/palistor?activeTab=versions)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![react](https://img.shields.io/badge/react-%5E19-61dafb.svg)](https://react.dev)

> **Этот README описывает Palistor 0.1**: новое ядро Cube, серверный рендер (`usePalistor`, `initialData`) и скиллы для агентов. Пока 0.1 — пререлиз, он публикуется под dist-tag `cube`: `npm install palistor@cube`. Обычный `npm install palistor` пока ставит линию 0.0.x, в которой ничего из этого нет. Переход с 0.0.x — в разделе [Миграция на 0.1](#миграция-на-01).

**Palistor — декларативный MVVM like фреймворк для stateful, data-driven интерфейсов на React.**

Palistor разделяет фронтенд на три слоя:

1. Слой отображения. Это JSX слой из которого изъято все кроме собственно отображения. Под отображением мы тут понимаем верстку, рендеринг, стили.

Пример верстки (View по MVVM):
```tsx
function Form() {
  const form = useForm(store);

  return (
    <>
      <Input {...form.email} />
      {form.phone.isVisible && <Input {...form.phone} />}
    </>
  );
}
```

2. Слой конфигурации.

Пример конфигурации (Декларация ViewModel по MVVM):

```ts
const store = new Palistor({
  config: {
    id: { value: "" },
    email: {
      value: "",
      isRequired: true,
    },
    phone: {
      value: "",
      isVisible: (v: { email: string }) => v.email !== "",
      resolve: {
        resolver: async (v: { id: string }) => await getPhone(v.id), // getPhone это уже слой данных; результат становится значением поля
      },
    },
  },
});
```

3. Слой данных. (Model) Это слой который отвечает за получение данных и отправку данных. Слой данных может быть каким угодно, он может быть простым резольвером, или сложным кеширующим слоем реализующим offline функциональность. Palistor не навязывает реализацию слоя данных, он лишь предоставляет интерфейс для его интеграции.
Состояние Palistor также кеширует данные, что бы не тянуть их заново из слоя данных.

---

## Содержание

- [Идея](#идея)
- [Демо](#демо)
- [Возможности](#возможности)
- [Установка](#установка)
- [Скиллы для агентов](#скиллы-для-агентов)
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
- [SSR и Next.js](#ssr-и-nextjs)
- [TypeScript](#typescript)
- [Миграция на 0.1](#миграция-на-01)
- [Лицензия](#лицензия)

---

## Идея

### Идея MVVM (Model-View-ViewModel)

#### Классический MVVM, но по потоку данных правильнее читать его как конвейер: Model → ViewModel → View

Большинство React-экранов сплетают внутри компонентов три несвязанные заботы: 
 - как экран **себя ведёт** (валидация, условные поля, кросс-полевые правила),
 - откуда берутся его **данные** (загрузка, кэширование, мутации) 
 - и как он **выглядит** (JSX).

По мере роста экрана эти три части сплетаются так, что любое изменение задевает всё. А еще нарастает сложность зависимостей, useEffectов, кастомных хуков и контекстов — и в итоге экран становится монолитным, непредсказуемым и трудно тестируемым.

Все хорошо работало, пока мы писали код руками, мы научились писать на реакте более менее приемлемо, и хотя иногда одной кнопке требовалось 3-компонента и пару хуков, мы имели время и возможность декомпозировать сложность и эффективно ей управлять.

Но сегодня мы все меньше хотим читать код который мы получаем от ИИ, мы теряем контроль. В некоторых системах потеря контроля вполне приемлема, "ну работает и работает" e2e тесты в помощь.

ИИ плохо архитектурит, но отлично заполняет декларативные слоты. Palistor убирает саму задачу архитектуры — остаётся заполнить конфиг по правилам. Поэтому сгенерённый код нельзя развалить: ошибаться негде, а ревьювить нужно один плоский объект, а не дерево из useEffect'ов.

Если вы посмотрите на примеры кода Palistor, вы обнаружите, что сложность декомпозирована таким образом, что ее больше нигде нет. Точнее сказать нет избыточной (excessive complexity) сложности, вся необходимая сложность стянута в конфиг.
  - View примитивен настолько, что там негде совершить ошибку.
  - ViewModel (или точнее декларация ViewModel) просто объект с поведением, который выражает логику самым простым и емким способом.
  - Model — вне ответственности Palistor: любой источник данных (простой `fetch`, кэширующий или offline-слой), который вы подключаете через `resolve`. Palistor задаёт только интерфейс к нему, а не реализацию.

Мы можем сгенерировать любой фронтенд по правилам Palistor и не потерять контроль.
Бонусом мы получаем:
 - мгновенную конфигурацию приложения под разные режимы. В современных реалиях нам прийдется конфигурировать приложения под разные регионы, законы и правила, и легкое добавление новых режимов и контекстов станет очень важным преимуществом.
 - простой дебаг состояний. Благодаря такому разделению, мы видим наглядно все связи между данными. Нам просто негде запутаться.
 - React становится тонким отображающим слоем, больше никаких useEffect и сложных правил и тонкостей связанных с ядром реакт и концепцией рендера.
 - Состояние живёт в сторе, а не в React: производные значения считает стор, а компонент перерендеривается, только если изменилось поле, которое он реально прочитал → точечные ре-рендеры вместо каскадных.
 - Лучшая организация кода. Более естественное переиспользование различных функций, таких как валидаторы, форматтеры, и другие.

Все это позволит нам нарастить сложность всех слоев и добавить новый функционал без ущерба для стабильности и предсказуемости. А главное перейти к генерации фронтенда для корпоративных систем.

### Задачи для Palistor
Админки, саас платформы, консоли, личные кабинеты, состоящие в основном из форм и шаговых мастеров, динамических виджетов и таблиц:
 - Онбординг / KYC / верификация / анкеты — ветвящиеся многошаговые мастера, условные поля, пошаговая валидация (defineFlow).
 - Чек-ауты и платёжные формы — условные способы оплаты, кросс-полевые правила, async-подгрузка.
 - Конфигураторы / калькуляторы / CPQ — computed-поля и их зависимости (цена×кол-во→налог→итог) без единого useEffect.
 - Формы, управляемые справочниками — зависимые селекты (страна→город), опции через resolve.
 - CRUD-редакторы сущностей и таблицы с inline-правкой — нормализованный реестр, API списков, per-entity шаблоны.
 - Schema-driven / бэкенд-управляемые формы — раз конфиг это данные, его можно генерить/отдавать с сервера. Плюс мультирегиональность: context под регионы и законы.
 - Дашборды с формо-подобными фильтрами — панель фильтров как реактивный источник для данных.

### Для чего не подходит Palistor
Сайты лендинги где нет сложной логики и главная задача быстрее отдать простую страницу.
 - Контент-сайты: блоги, документация, маркетинг, SSG — SEO-first, статика, поведения почти нет.
 - Графика / canvas / realtime-рендер — игры, редакторы (rich-text, диаграммы, карты), видеоплееры, тяжёлые визуализации. Тут сложность в рендере, а модель не расщепляется на слои.
 - Тривиальный UI — один поиск, одна кнопка, форма из пары полей: трёхслойное разделение — оверхед, не окупается.
 - Встраиваемые виджеты, где критичен вес бандла — библиотека весит около 30 КБ после минификации и gzip (без React); для embeddable-скрипта на чужой странице это минус.

---

## Демо

Живой стенд с примерами из этого README: **[projectint.github.io/palistor](https://projectint.github.io/palistor/)**

Каждый таб — отдельная возможность фреймворка, на каждый ведёт прямая deep-ссылка:

- [Быстрый старт](https://projectint.github.io/palistor/#form) — условные поля, submit-pipeline, persist
- [Flows](https://projectint.github.io/palistor/#flow) — пошаговый мастер с ветвлением
- [Списки и сущности](https://projectint.github.io/palistor/#lists) — нормализованный реестр, API списков, пагинация, контекст store
- [Async-резолверы](https://projectint.github.io/palistor/#async) — загрузка данных, retry, уведомления
- [Field mapping](https://projectint.github.io/palistor/#mapping) — переименование пропсов под UI-кит

Исходники стенда — в [`app-demo/`](./app-demo). Под каждым разделом ниже — ссылки на конкретный код примера и соответствующий таб.

> Живой стенд собирается из `main`. Маршруты серверного рендера (`/ssr`, `/ssr/form`, `/ssr/catalog`, `/ssr/flow`, `/ssr/runtime` — см. [SSR и Next.js](#ssr-и-nextjs)) появятся на нём вместе с 0.1. До тех пор запустите стенд локально: `npm ci` в корне репозитория и в `app-demo/`, затем `npm run dev` в `app-demo/` и откройте [localhost:3001/palistor/](http://localhost:3001/palistor/).

---

## Возможности

Возможности нацелены включать все типичные потребности современных фронтендов, формы, списки, пошаговые мастера.

Философия Palistor в том, что бы давать полный инструментарий для генерации любого фронтенда, с ипользованием всех лучших и традиционных практик. 

| | |
|---|---|
| **Гранулярные ре-рендеры** | Компонент перерендеривается, только когда изменилось состояние узла, который он читал; запись в другое поле или пересчёт с тем же результатом ре-рендер не вызывают |
| **Computed field state** | `isVisible`, `isRequired`, `label`, вычисляемый `value`, ошибки валидации — ленивые геттеры, зависимости которых отслеживаются автоматически; объявлять ничего не нужно |
| **Нативный синтаксис** | `form.email.value = x` вместо диспатча экшенов; `{...form.email}` спредит пропсы поля в компонент. Узлы — обычные объекты с геттерами, а не Proxy |
| **Submit pipeline** | `beforeSubmit → validate → onSubmit → afterSubmit`; ошибки показываются после первого submit |
| **Dirty tracking** | Флаги изменений у поля, группы и списка; baseline сдвигается после resolve и `reset(values)` |
| **Async-резолверы** | Загрузка данных на группе, поле и списке с авто-трекингом зависимостей (в том числе чтений после `await`), retry, оптимистичными значениями и React Suspense |
| **Списки и сущности** | Нормализованный реестр сущностей, API списков с `add / remove / setItems`, per-entity шаблоны, вложенные списки |
| **Фильтрация** | Блок `filter` у списка: серверные поля перезапрашивают данные (с debounce), клиентские фильтруют уже загруженные строки |
| **Пагинация** | Кэш уровня страниц — переход на свежую закэшированную страницу не вызывает резолвер; режимы `paged` / `infinite` / `cursor`, persist окна, вложенные списки |
| **Flows** | Пошаговые мастера через `defineFlow` / `defineStep`: навигация, ветвление, валидация по шагам |
| **Field mapping** | Переименование пропсов состояния поля под конвенцию вашего UI-кита (`isRequired` → `required`, …) |
| **Persist** | Автосохранение в `localStorage`, `sessionStorage` или любой кастомный драйвер — вместе с составом списков и навигацией флоу |
| **i18n** | Одна регистрация транслятора — каждый `label: (t) => t("key")` переводится везде |
| **SSR и Next.js** | `usePalistor`, `<PalistorProvider>`, `initialData`: данные и переводы в первом HTML, без запросов store на сервере и без повторного запроса после гидратации |
| **Скиллы для агентов** | Пять скиллов для ИИ-агентов лежат в пакете и следуют его версии |
| **Тестируемость** | Framework-agnostic ядро полностью тестируется без React |

---

## Установка

Пакет публикуется в **публичный npm-реестр** под именем `palistor`. Пока 0.1 не стал `latest`, ставьте его с dist-tag `cube`:

```bash
npm install palistor@cube
# или
yarn add palistor@cube
# или
pnpm add palistor@cube
```

**Peer-зависимость:** `react ^19`

Пакет — ES-модули для бандлеров (Next.js, Vite, webpack) и тест-раннеров вроде Vitest; чистый `node` импортировать его не может.

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
  usePalistor,
  PalistorProvider,
  usePalistorContext,
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

Subpath-импорты 0.0.x продолжают работать: `palistor/react/useForm`, `palistor/react/usePersist`, `palistor/react/useTranslator`, `palistor/react/useNotifier`, `palistor/store/store`, `palistor/store/persist`. `palistor/cube` — то же, что корень. Новый код импортирует из корня.

---

## Скиллы для агентов

Palistor поставляет собственные инструкции для ИИ-агентов: пять [Agent Skills](https://agentskills.io) лежат прямо в npm-пакете (`node_modules/palistor/skills/`) и версионируются вместе с кодом, который описывают. Агент, загрузивший их, пишет конфиги по правилам установленной у вас версии, а не по догадкам. Скиллы есть в пакете начиная с 0.1 (`palistor@cube`); в пакетах 0.0.x их нет.

**Рекомендуемый путь — [TanStack Intent](https://tanstack.com/intent/latest):**

```bash
npm i palistor@cube
npm i -D @tanstack/intent
npx @tanstack/intent@latest install   # интерактивно: выбрать palistor
```

`intent install` сохраняет выбор в `package.json#intent.skills` и добавляет в `AGENTS.md` (или в уже существующий файл инструкций агента) блок, который велит агенту перед правкой кода выполнить `intent list` и `intent load palistor#<скилл>`. Claude Code сам читает `AGENTS.md` начиная с v2.1.277; в более старой версии добавьте `@AGENTS.md` в `CLAUDE.md` или используйте плагин ниже.

**Альтернативы** — поставить скиллы прямо из этого репозитория:

```bash
# Плагин Claude Code (выполнять внутри Claude Code)
/plugin marketplace add ProjectINT/palistor
/plugin install palistor@palistor

# skills CLI
npx skills add ProjectINT/palistor --full-depth --skill palistor palistor-lists palistor-flows palistor-field-mapping palistor-ssr

# GitHub CLI
gh skill add ProjectINT/palistor skills/palistor/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-lists/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-flows/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-field-mapping/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-ssr/SKILL.md
```

| Скилл | Чему учит |
|---|---|
| `palistor` | Ядро, начинать с него: config → store → `useForm` → spread; поля и группы, валидация, видимость, вычисляемые значения, submit и reset, асинхронный `resolve`, persist, i18n |
| `palistor-lists` | Коллекции: `defineList`, loading / error / reload, добавление и удаление строк, временные id, редактирование одной сущности, фильтрация, пагинация |
| `palistor-flows` | Пошаговые мастера: `defineFlow` / `defineStep`, навигация, ветвление, проверка шага и финальная проверка |
| `palistor-field-mapping` | UI-киты: один адаптер на вид инпута, `fieldMapping` для переименования пропсов поля |
| `palistor-ssr` | Серверный рендер в Next.js (App Router): `usePalistor`, `PalistorProvider`, `initialData`; данные и переводы в первом HTML, без запросов store на сервере и без повторного запроса после гидратации; один store на всё приложение |

Скиллы обновляются вместе с пакетом: `npm update palistor` приносит и инструкции для новой версии. Установка из репозитория (варианты выше) читает ветку по умолчанию (`main`), а не установленную версию; в `main` скиллы попадут вместе с релизом 0.1, а до тех пор используйте Intent — он берёт их из установленного пакета.

---

## Быстрый старт

> 🔗 **Код:** [config/payment.ts](./app-demo/src/config/payment.ts), [modules/payment-form/](./app-demo/src/modules/payment-form) · **Живой результат:** [Демо → Форма оплаты](https://projectint.github.io/palistor/#form)

### 1. Опишите форму

Конфиг декларативен: значения полей, валидация, видимость и lifecycle-колбэки живут в одном дереве. Store создаётся на уровне модуля (store с данными запроса создаётся внутри компонента — см. [SSR и Next.js](#ssr-и-nextjs)).

```typescript
import { Palistor } from "palistor";

interface PaymentValues {
  paymentType: string;
  cardNumber: string;
  passport: { number: string; issueDate: string };
  amount: number;
}

export const paymentStore = new Palistor({
  config: {
    paymentType: { value: "card", label: "Способ оплаты" },
    cardNumber: {
      value: "",
      label: "Номер карты",
      placeholder: "0000 0000 0000 0000",
      isVisible: (v: PaymentValues) => v.paymentType === "card",
      isRequired: (v: PaymentValues) => v.paymentType === "card",
      validate: (value: string, v: PaymentValues) =>
        v.paymentType === "card" && value.length < 16 ? "Введите 16 цифр" : undefined,
    },
    passport: {
      isVisible: (v: PaymentValues) => v.paymentType === "bank",
      number:    { value: "", label: "Серия и номер" },
      issueDate: { value: "", label: "Дата выдачи" },
    },
    amount: {
      value: 0,
      label: "Сумма",
      validate: (value: number) => (value > 0 ? undefined : "Введите сумму"),
    },
    onSubmit: async (values: PaymentValues) => api.pay(values),
  },
});
```

При submit валидируется каждое поле формы, в том числе скрытое (кроме полей строк списков и скрытых шагов флоу). Поле, обязательное только в одной ветке, говорит об этом в собственных `isRequired` / `validate`, как `cardNumber`. Функция поля внутри группы получает значения этой группы (см. [Какие values получает функция](#какие-values-получает-функция)), поэтому `passport.number` не смог бы прочитать `paymentType`: условие ветки стоит на группе `passport`, которая читает корень.

### 2. Подключите компонент

```tsx
import { useForm } from "palistor";
import { paymentStore } from "./paymentStore";

function PaymentForm() {
  const form = useForm(paymentStore);

  return (
    <form onSubmit={(e) => { e.preventDefault(); void paymentStore.submit(); }}>
      <Select
        value={form.paymentType.value}
        onChange={(e) => (form.paymentType.value = e.target.value)}
        label={form.paymentType.label}
      />

      {form.cardNumber.isVisible && (
        <Input
          {...form.cardNumber} // Конфиг знает об интерфейсе Input благодаря адаптеру (fieldMapping)
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
import { useForm, type PalistorProxy } from "palistor";

function PassportSection({ passport }: { passport: PalistorProxy<PaymentValues["passport"]> }) {
  // Собственная область трекинга — ре-рендер только при изменении полей passport
  const p = useForm(passport);

  return (
    <>
      <Input {...p.number} />
      <Input {...p.issueDate} />
    </>
  );
}
```

> **Без `useForm` в дочернем** компонент читает через область трекинга родителя: его чтения засчитываются родителю, и оба перерендериваются вместе. Для простых листовых компонентов это нормально.

Узлом в пропсе может быть и одно поле, а цепочка идёт на любую глубину конфига: см. [Компонент на узел](#компонент-на-узел).

---

## Концепции

### Виды узлов

Конфиг — это дерево, а вид узла следует из его формы:

```
Есть "value"                    →  лист    (поле)
Нет  "value"                    →  группа  (секция, форма)
defineList(…) или [template]    →  список  (строки реестра сущностей)
defineFlow(…)                   →  флоу    (группа, дети которой — шаги)
```

```typescript
const config = {
  // Лист — управляет значением
  email: { value: "", isRequired: true },

  // Группа — контейнер с вычисляемыми свойствами
  address: {
    isVisible: (v: { showAddress: boolean }) => v.showAddress,
    city:    { value: "" },
    country: { value: "RU" },
  },
};
```

### Как устроено ядро

С версии 0.1 Palistor работает на ядре **Cube**: один внутренний примитив и автоматический трекинг зависимостей вместо карт зависимостей и прохода пересчёта.

- **Один примитив.** Каждый узел — лист, группа, строка списка, шаг флоу — экземпляр одного внутреннего класса, *куба*; списки, флоу, шаги и фильтры — его тонкие подклассы. Поддерево строки строится при первом обращении, поэтому список из 1 000 строк держит 1 000 лёгких объектов, а не 1 000 копий шаблона.
- **Производное состояние — ленивое мемо.** `isVisible`, `isRequired`, `label`, вычисляемый `value`, `errorMessage`… — геттеры. Каждый запоминает версии того, что прочитал (другие узлы, транслятор), и пересчитывается, только когда одна из них сдвинулась, и только при следующем чтении. Ничего не объявляется, не сортируется и не пересчитывается заранее: зависимости — это то, что функция прочитала в последний запуск. Резолверы отслеживаются так же, включая чтения после `await` и ключи `store.context`.
- **Узлы — обычные объекты.** `store.proxy.email` — обычный объект, а не Proxy. Его собственные перечислимые свойства — ровно то, что должен давать спред (у поля — пропсы состояния и `onValueChange`), поэтому `{...form.email}` идёт прямо в компонент; дочерние узлы группы и остальные члены — неперечислимые геттеры на прототипе, общем для всех узлов одного конфига. Внутренности ядра никогда не занимают имя дочернего узла; короткий список имён зарезервирован под API самого узла (см. [`ConfigNode`](#confignode--схема-поля)).
- **Proxy только на краях.** `useForm` оборачивает узлы в тонкий tracking Proxy, который записывает, у каких узлов компонент читал *состояние*; прогон резолвера видит `store.context` через Proxy, который записывает прочитанные ключи. В самом ядре Proxy нет.
- **Версии состояния.** У каждого узла есть версия наблюдаемого состояния — значение, вычисляемые флаги и строки, `dirty`, ошибки, `loading`. Она сдвигается, только когда что-то из этого действительно изменилось, а не при каждом изменении зависимости. Вычисляемый `total`, который после записи остался прежним, не сдвигается.
- **Одно действие — одно уведомление.** Запись вместе с патчем setter, `setValues`, `reset`, результат резолвера — один батч: подписчики уведомляются один раз, после него, а затем перепроверяются резолверы, у которых сдвинулись зависимости.

### Как работает трекинг

```
Рендер: компонент читает form.email.value и form.phone.isVisible
        → набор чтений = { email, phone }

form.city.value  = "Париж"   → состояние city изменилось; city нет в наборе → нет ре-рендера ✓
form.email.value = "a@b.c"   → состояние email изменилось                  → ре-рендер     ✓
form.qty.value   = 3         → total = price × qty пересчитается при чтении;
                               читатель total перерендерится, только если total изменился   ✓
```

Компонент, который только навигирует (`form.passport`) и передаёт поддерево дальше, не читая его состояние, **не** перерендеривается при изменении полей внутри `passport`. Чтение любого состояния узла подписывает на всё его состояние: родитель, читающий `form.passport.isVisible`, перерендерится и когда изменится `passport.dirty` или `passport.submitting`. Набор чтений следует за рендерами: в нём чтения двух последних рендеров, а не всё, что компонент когда-либо читал. `useForm(subtree)` в дочернем компоненте открывает собственный набор.

### Компонент на узел

Дерево компонентов может повторять дерево конфига. Компонент получает свой узел пропсом, вызывает на нём `useForm` и отдаёт детям их узлы: секции — группу, инпуту — одно поле. Правило одно на всех уровнях, поэтому цепочка идёт на любую глубину конфига.

```tsx
import { Palistor, useForm, type FieldProxyNode, type PalistorProxy } from "palistor";

interface Geo      { lat: number; lng: number }
interface Address  { city: string; street: string; geo: Geo }
interface Customer { name: string; address: Address }

const orderStore = new Palistor({
  config: {
    number: { value: "" },
    customer: {
      name: { value: "" },
      address: {
        city:   { value: "" },
        street: { value: "" },
        geo: { lat: { value: 0 }, lng: { value: 0 } },
      },
    },
  },
});

// Уровень 0, корень: единственный компонент, который видит store
function OrderForm() {
  const form = useForm(orderStore);
  return (
    <>
      <TextField field={form.number} />
      <CustomerSection customer={form.customer} />
    </>
  );
}

// Уровень 1: узел `customer`
function CustomerSection({ customer }: { customer: PalistorProxy<Customer> }) {
  const c = useForm(customer);
  return (
    <>
      <TextField field={c.name} />
      <AddressSection address={c.address} />
    </>
  );
}

// Уровень 2: узел `customer.address`
function AddressSection({ address }: { address: PalistorProxy<Address> }) {
  const a = useForm(address);
  return (
    <>
      <TextField field={a.city} />
      <TextField field={a.street} />
      <GeoSection geo={a.geo} />
    </>
  );
}

// Уровень 3: узел `customer.address.geo`
function GeoSection({ geo }: { geo: PalistorProxy<Geo> }) {
  const g = useForm(geo);
  return (
    <>
      <NumberField field={g.lat} />
      <NumberField field={g.lng} />
    </>
  );
}

// Лист: один компонент на любое строковое поле, на любом уровне
function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}

function NumberField({ field }: { field: FieldProxyNode<number> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(Number(e.target.value))} />;
}
```

- **Узел выбирает родитель.** `TextField` стоит на `number`, `name`, `city` и `street`: четыре поля на трёх уровнях, компонент один.
- **Компонент не знает про store.** Он типизирован формой своего узла (`PalistorProxy<Address>`, `FieldProxyNode<string>`) и не импортирует ни store, ни конфиг. Узел в пропсе несёт свой store, поэтому компонент оказывается на том store, с которого начал родитель, и ровно на том узле, который ему передали. Корнем может быть и store из `usePalistor`: ниже него ничего не меняется.
- **Ре-рендеры остаются локальными.** Правка `geo.lat` перерисовывает только поле `lat`: `OrderForm`, три секции и все остальные поля не перерисовываются. Компонент, который только передаёт узлы вниз, не прочитал никакого состояния.
- **Секция, которая читает состояние своего узла, следит за всем его состоянием.** Если в `AddressSection` есть `if (!a.isVisible) return null`, первая правка ниже включает `address.dirty` и один раз перерисовывает секцию вместе с детьми; следующие правки перерисовывают только поле.

Вниз можно передать только узел, полученный от другого `useForm`: `useForm(orderStore.proxy.customer)` — ошибка (см. [`useForm(source)`](#useformsource)).

### Поток данных при записи

```
form.email.value = " User@Example.com "
  │
  ├─ 1. formatter(raw, values)          → нормализованное значение; неизменившееся значение — запись пропускается (предупреждение в консоли)
  ├─ 2. запись                          → версия листа сдвигается
  ├─ 3. setter(value, values, prev)?    → патч смежных полей, применяется в том же батче
  ├─ 4. notify                          → один цикл: подписчики узлов, чьё состояние изменилось;
  │                                       вычисляемые геттеры пересчитываются лениво, при чтении
  ├─ 5. резолверы                       → те, что читали изменившееся значение, запускаются снова
  └─ 6. onChange                        → у листа, затем у каждой группы-предка: микротаском позже,
                                          fire-and-forget; возвращённый патч применяется
```

У `setValues` и `reset` путь короче: без setter и без `onChange` (formatters в `setValues` выполняются).

### Какие values получает функция

| Колбэк | Его аргумент `values` |
|---|---|
| вычисляемый `value`, `isVisible` / `isRequired` / `isDisabled` / `isReadOnly`, `validate`, `setter` | значения родительской группы узла (для узла верхнего уровня — вся форма) |
| `label` / `placeholder` / `description`, `formatter`, `onChange` (`allValues`) | значения всей формы (внутри списка — строки) |
| `resolver` | значения всей формы (для resolve внутри шаблона списка — строки) |

Поэтому поле во вложенной группе не может прочитать поле снаружи: ставьте условие на группу или держите поле и его условие в одной группе. Функции флагов вторым аргументом получают ещё и транслятор: `isVisible: (values, t) => …`.

### Когда показываются ошибки (`revalidate`)

Ошибки валидации скрыты до первого `submit()` самого поля или любой группы над ним — успешного или нет. С этого момента флаг `revalidate` равен `true`, и `isInvalid` / `errorMessage` обновляются вживую при каждом вводе — до `reset()`. У полей строк списка такого порога нет: их `validate` показывается вживую с самого начала и не блокирует submit формы (submit формы строки списков не проверяет; `item.submit()` проверяет).

---

## API Reference

### `new Palistor(options)`

```typescript
import { Palistor } from "palistor";

const store = new Palistor({
  config,          // дерево ConfigNode — обязательно
  initialValues,   // deep-partial значения поверх дефолтов из конфига (они же становятся dirty-baseline)
  context,         // начальный нереактивный контекст (см. «Контекст store»)
  fieldMapping,    // карта переименования пропсов (см. «Field mapping»)
  translator,      // i18n-функция, действует с первого рендера (см. «i18n»)
  notifier,        // функция уведомлений, стоящая за ctx.notify (см. «Уведомления»)
  initialData,     // результаты резолверов, уже полученные сервером, в форме getValues() (см. «SSR и Next.js»)
  server,          // серверный режим: store ничего не запускает сам;
                   // по умолчанию typeof window === "undefined" (см. «SSR и Next.js»)
});
```

**Store — публичный API:**

| Свойство / метод | Возвращает | Описание |
|---|---|---|
| `store.proxy` | узел | Корневой узел: обычные геттеры, повторяющие конфиг (`store.proxy.email.value`, присваиваемо). Чтения через него компоненты не отслеживают — используйте его вне React, а в компонентах `useForm(store)`. Передача его или любого его узла в `useForm` бросает ошибку |
| `store.getValues()` | values | Глубокий **клон** всех текущих значений вложенным объектом (списки — массивами строк) |
| `store.submit()` | `Promise<SubmitResult>` | Submit корневой группы: валидирует каждое поле, в том числе скрытое (кроме строк списков и скрытых шагов флоу), затем вызывает `onSubmit` корня. Отклоняется, если колбэк бросил исключение |
| `store.reset(values?)` | `void` | `reset()` возвращает поля формы к их baseline — `initialValues`, данным резолвера или `initialData`, последнему `reset(values)`, — скрывает ошибки и возвращает флоу на первый шаг; корневой список сохраняет свой состав, а его строки — значения полей (см. «Списки и сущности»). `reset(values)` записывает эти ключи и делает всё текущее состояние новым baseline |
| `store.setValues(patch)` | `void` | Bulk-патч одним уведомлением: formatters выполняются, setters и `onChange` — нет; списки и неизвестные ключи игнорируются |
| `store.set(data)` | `void` | Upsert entity или массива entities в реестре (рекурсивный merge; строка без id получает `_tmp_…`) |
| `store.delete(id)` | `void` | Удалить entity отовсюду (каскадно удаляет принадлежащие ей дочерние entity) |
| `store.rekey(oldId, newId)` | `void` | Переименовать entity в реестре и во всех списках |
| `store.invalidate(id, template?)` | `void` | Забыть, что resolve шаблона из `useForm(entity, template)` уже выполнялся для этой entity (`template` — объект конфига шаблона; без него — все шаблоны); следующий mount выполнит его снова |
| `store.subscribe(node, fn)` | unsubscribe | Вызывается, когда меняется наблюдаемое состояние узла — у группы её собственные флаги, `dirty`, `submitting`, `revalidate`, а не каждое вложенное значение. Передавайте узел: `store.proxy.email` |
| `store.subscribeGlobal(fn)` | unsubscribe | Вызывается один раз на цикл уведомлений (один на действие) |
| `store.getVersion()` | `number` | Число циклов уведомлений |
| `store.getNodeVersion(node)` | `number` | Меняется, когда изменилось наблюдаемое состояние узла; сравнивайте только на неравенство |
| `store.setTranslator(fn \| null)` | `void` | Зарегистрировать i18n-функцию |
| `store.setNotifier(fn \| null)` | `void` | Зарегистрировать функцию уведомлений |
| `store.setContext(ctx)` | `void` | Неглубоко домержить нереактивный контекст: ничего не перерендеривает, перезапускает резолверы, которые читали изменившийся ключ (см. «Контекст store») |
| `store.context` | object | Текущий нереактивный контекст |
| `store.persist` | `PersistManager` | Персистенция: `enable / disable / flush / clear / hydrate / isEnabled` (см. «Persist») |
| `store.start()` | `void` | Запустить то, что store запускает сам: вход в шаг флоу, eager-резолверы и все резолверы, которые уже читали. Вне серверного режима его вызывает конструктор `new Palistor()`; у store из `usePalistor` его вызывает хук после первого коммита. Идемпотентен (см. «SSR и Next.js») |

---

### `useForm(source)`

```typescript
import { useForm } from "palistor";

const form    = useForm(store);            // область трекинга поверх всего store
const section = useForm(form.address);     // группа (из пропса): своя область трекинга
const city    = useForm(section.city);     // одно поле (из пропса): область над этим одним узлом
const entity  = useForm(item, (s) => s.editForm); // привязка entity к template
```

Возвращает узлы store, обёрнутые в область трекинга. Компонент перерендеривается, только когда меняется состояние узла, который он читал. Запись идёт прямо в узел.

| Перегрузка | Когда использовать |
|---|---|
| `useForm(store)` | Корень формы; узлы передаются вниз пропсами |
| `useForm(groupProp)` | Секция с независимыми ре-рендерами; проп типизируется как `PalistorProxy<T>` |
| `useForm(fieldProp)` | Компонент одного поля; проп типизируется как `FieldProxyNode<T>`, возвращается тот же узел |
| `useForm(rowProp)` | Строка списка (`PalistorRef<T>`), см. [Списки и сущности](#списки-и-сущности) |
| `useForm(entityProxy, templateSelector)` | Отображение/редактирование entity из списка через template (bind при mount, unbind при unmount) |

Узел в пропсе привязан к своему store и к своему месту в дереве: дочернему компоненту не нужен импорт store, а какой узел он показывает, решает родитель. Цепочка может быть любой глубины, см. [Компонент на узел](#компонент-на-узел).

> ⚠️ Передача сырого узла `store.proxy`, группы или поля (например, `useForm(store.proxy.address)`), — **ошибка компиляции и рантайма**. Всегда сначала `useForm(store)`, а дальше — через то, что он вернул.

---

### `usePalistor(options)`

```tsx
import { usePalistor } from "palistor";

const store  = usePalistor({ config, context: { accountId } });             // объект опций
const wizard = usePalistor(() => ({ config: buildConfig(), initialData })); // функция: вызывается один раз
```

Создаёт один store на экземпляр компонента и на каждом рендере возвращает его же. Принимает опции `new Palistor(options)` и подмешивает в них значения ближайшего `<PalistorProvider>`:

| Опция | Что получает store |
|---|---|
| `context` | `{ ...providerContext, ...options.context }` — собственные ключи store важнее |
| `translator`, `notifier` | Опция, если она задана, иначе значение провайдера |

После mount хук следит только за этими тремя значениями и передаёт изменение через `store.setContext` / `setTranslator` / `setNotifier`: от провайдера — всегда, из опций — только если они переданы объектом (функция уже прочитана один раз). Контекст мержится по ключам: исчезнувший ключ сохраняет в store последнее значение — чтобы очистить его, передайте `undefined`. `config`, `initialValues`, `initialData`, `fieldMapping` и `server` читаются один раз; компоненту, который должен начать заново с новыми данными, нужен новый `key`. При unmount ничего не сбрасывается: store уходит вместе с компонентом. Store на всё приложение — это тот же хук, вызванный один раз в провайдере, который рендерит layout, — см. [Один store на всё приложение](#один-store-на-всё-приложение).

Во время рендера ничего не запускается. Store создаётся удержанным (held), а эффект вызывает `store.start()` после коммита компонента: флоу входят в первый шаг, запускаются eager-резолверы и все резолверы, которые прочитал рендер. До этого они читаются как `loading: true` (у списка ещё и `resolveStatus: "idle"`) — то же самое показывает серверный HTML, поэтому первый клиентский рендер с ним совпадает. То, что эффект дочернего компонента попросил у store раньше, — например, `reload()` — не теряется: это выполнит старт. С `server: true` в опциях хук не запускает store вообще: `store.start()` вызываете вы. Store, созданный через `new Palistor()`, не удерживается: в браузере его запускает конструктор.

Под `<StrictMode>` в development React рендерит компонент дважды и дважды монтирует его эффекты, но store создаётся один: функция опций вызывается один раз, eager-резолвер и первый `onEnter` флоу запускаются один раз (второй вызов `start()` ничего не делает). Рендер, который React отбрасывает до коммита, — рендер перехода, перезапущенный из-за того, что под ним изменился другой store, или компонент, ушедший в suspense до первого коммита, — теряет свой store, и этот store ничего не запросил: запускается только store закоммиченного экземпляра.

### `<PalistorProvider>` / `usePalistorContext()`

```tsx
import { PalistorProvider, usePalistorContext } from "palistor";

<PalistorProvider context={{ account, navigate }} translator={t} notifier={notifyError}>
  {children}
</PalistorProvider>

const { account } = usePalistorContext<{ account: Account }>(); // в любом компоненте ниже
```

| Проп | Описание |
|---|---|
| `context` | Мержится в `store.context` каждого store, созданного через `usePalistor` ниже по дереву; собственная опция `context` у store важнее по каждому ключу |
| `translator` | Функция перевода для store ниже по дереву, которым не задана своя |
| `notifier` | Функция уведомлений (`ctx.notify`) для store ниже по дереву, которым не задана своя |

Все пропсы необязательны. Вложенные провайдеры складываются: `context` внутреннего мержится поверх внешнего (неглубоко, ключ внутреннего важнее), а `translator` / `notifier`, которые внутренний не передал, наследуются. Контекст сравнивается по ключам, поэтому инлайновый `context={{ … }}` с теми же значениями изменением не считается — стабильными должны быть сами значения. Провайдер доходит только до store, созданных через `usePalistor`; store, созданный через `new Palistor()`, подключается через `useStoreContext` / `useTranslator` / `useNotifier`.

`usePalistorContext<T>()` возвращает объединённый `context` провайдера. Это обычное чтение React-контекста: компонент перерендерится, когда изменится какой-либо ключ. Это значение провайдера, а не store: собственная опция `context` у store и последующие вызовы `setContext` видны в `store.context`. Без провайдера возвращается пустой объект; `T` не сверяется с тем, что передано провайдеру.

---

### Листовой узел — свойства

```typescript
// Чтения через useForm регистрируют узел в наборе чтений компонента
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
form.email.loading        // → boolean у поля с `resolve`, иначе undefined (в типе FieldProxyNode его пока нет)

// Запись: formatter → запись → setter → одно уведомление → onChange (см. «Поток данных при записи»)
form.email.value = "new@example.com";
form.email.onValueChange("new@example.com"); // эквивалент, удобно как callback-проп

// Лист можно сабмитить и отдельно
form.email.submitting        // → boolean
await form.email.submit();   // → SubmitResult
```

Спред `{...form.email}` даёт `value`, `label`, `placeholder`, `description`, четыре флага, `isInvalid`, `errorMessage`, `onValueChange` и ключи `componentProps`. `dirty`, `loading`, `submitting` и `submit` читаются, но в спред не попадают.

Собственный `submit()` листа валидирует только этот лист, передаёт его значение (после его `beforeSubmit`) в его `onSubmit(value, store, parentNode)`, а `reset`, который получает его `afterSubmit`, сбрасывает родительскую группу. Пути ошибок — полные (`"user.email"`).

### Групповой узел — свойства

```typescript
form.passport.isVisible     // → boolean (по умолчанию true)
form.passport.isRequired    // → по умолчанию false (в типе boolean | undefined)
form.passport.isReadOnly    // → по умолчанию false (в типе boolean | undefined)
form.passport.isDisabled    // → по умолчанию false (в типе boolean | undefined)
form.passport.isInvalid     // → boolean | undefined — только собственный validate группы
form.passport.errorMessage  // → string | undefined — то же
form.passport.submitting    // → boolean
form.passport.loading       // → boolean (async-резолвер выполняется или вот-вот запустится)
form.passport.dirty         // → boolean (хотя бы одно поле изменилось)
form.passport.revalidate    // → boolean (true после первого submit, до reset)
form.passport.values        // → значения группы (стабильный объект из геттеров)

await form.passport.submit();          // → SubmitResult
form.passport.reset();                 // поддерево — к его baseline
form.passport.reset({ number: "" });   // записать эти ключи; текущее состояние становится baseline
form.passport.setValues({ number: "AB1234" }); // bulk-патч: formatters выполняются, setters и onChange — нет
```

Флаги группы — её собственные: поля их не наследуют. Поле внутри скрытой группы по-прежнему читается как `isVisible: true` — рендерите группу условно, как в «Быстром старте». `isInvalid` / `errorMessage` группы берутся только из её собственного `validate`, а не из её полей (`isRequired` у группы ставит флаг, но ошибку не даёт никогда), и служат только для отображения: `validate` группы submit не блокирует. Чтобы показать ошибку секции по её полям, читайте поля.

`values` — один стабильный объект, свойства которого читают текущие значения: следующее чтение видит следующие записи. В функциях конфига и резолверах чтение `values.number` зависит только от `number`. В компоненте `values` считается собственным состоянием группы и при правке полей ре-рендер не вызывает — рендерите `form.passport.number.value`. Спред, `JSON.stringify` и `structuredClone` копируют текущее состояние; для отвязанного глубокого клона используйте `store.getValues()`.

`submit()` группы валидирует её поля (кроме строк списков) и передаёт в её `onSubmit` обычную копию её значений — вместе со скрытыми полями, после трансформаций `beforeSubmit`. `store.submit()` вызывает только `onSubmit` корня; `onSubmit` вложенной группы выполняется по `form.group.submit()`. Пути ошибок — относительно группы, которую сабмитят.

---

### `ConfigNode` — схема поля

```typescript
// Листовой узел (есть "value")
{
  value?: TValue | ((values: TValues) => TValue),   // константа или computed (computed — только для чтения)
  validate?:  (value, values, t) => string | undefined | false,
  formatter?: (raw, values) => TValue,               // нормализация при записи
  setter?:    (value, values, previousValue) => DeepPartialValues<TValues>, // патч смежных полей
  beforeSubmit?: (value, values) => TValue,          // трансформация отправляемого значения, синхронная (store не мутируется);
                                                     // values: payload группы, которую сабмитят, или значения родителя в leaf.submit()
  resolve?:   Resolve<TValue>,                       // результат становится значением; внутри шаблона списка — на каждую entity
  onChange?, onSubmit?, afterSubmit?,                // как у группы, для одного этого поля
  componentProps?: Record<string, unknown>,          // дополнительные пропсы, спредятся вместе с полем
  dependencies?: string[],                           // принимается и игнорируется: зависимости отслеживаются автоматически

  label?:       string | ((t, values) => string),
  placeholder?: string | ((t, values) => string),
  description?: string | ((t, values) => string),
  isVisible?:   boolean | ((values, t) => boolean),  // default: true
  isRequired?:  boolean | ((values, t) => boolean),  // default: false
  isDisabled?:  boolean | ((values, t) => boolean),  // default: false
  isReadOnly?:  boolean | ((values, t) => boolean),  // default: false
}

// Групповой узел (нет "value")
{
  beforeSubmit?: (values, parentValues) => values | Promise<values>,
  onSubmit?:     (values, store, parentNode) => Promise<unknown> | unknown,
  afterSubmit?:  (result, { reset }) => void | Promise<void>,
  reset?:        (baseline) => values,               // трансформация, которую применяет reset() без аргументов
  onChange?:     ({ fieldKey, newValue, previousValue, allValues }) => patch | void,
  validate?:     (values, parentValues, t) => string | undefined, // собственные isInvalid / errorMessage группы (только отображение)
  resolve?:      Resolve,                            // async-резолвер (см. ниже)

  isVisible?, isRequired?, isDisabled?, isReadOnly?, // как у листа; поля их не наследуют

  [childKey]: LeafNode | GroupNode | ListNode,       // дочерние узлы
}

// Узел-список — массив длиной 1 или 2 (или defineList)
[templateGroupNode]
[templateGroupNode, { resolve?, filter? }]
```

Какие `values` получает каждый колбэк — см. [Какие values получает функция](#какие-values-получает-функция).

**`onChange`** срабатывает только на запись (`node.value = …`, `onValueChange`) — не на `setValues`, `reset`, результаты резолверов и патчи setter. Он выполняется микротаском после уведомления, у поля и затем у каждой группы-предка; `fieldKey` — путь относительно этой группы, `allValues` — значения всей формы. Возвращённый патч (или промис патча) применяется к этой группе без formatters, setters и `onChange`; ошибки проглатываются.

**Имена дочерних узлов.** У группы ключи конфига — `value`, `label`, `placeholder`, `description`, четыре флага, `isInvalid`, `errorMessage`, `dirty`, `loading`, `validate`, `reset`, `resolve`, `deps`, `onSubmit`, `onEnter`, … — никогда не становятся дочерними узлами: объект под таким ключом читается как эта настройка (ключ `value` делает узел листом). `submitting`, `revalidate`, `values`, `submit`, `setValues` и `onValueChange` не могут быть именем дочернего узла группы: конструктор бросает ошибку с путём. В шаблоне списка пропускаются только структурные ключи (`label: { value: "" }` там — поле строки), а дочерний узел с именем `loading`, `submitting`, `submit`, `values` или `dirty` бросает ошибку при первом чтении полей строки.

### `SubmitResult`

```typescript
type SubmitResult =
  | { success: true;  result?: unknown }                              // result: то, что вернул onSubmit
  | { success: false; errors: Array<{ path: string; message: string }> };
```

`submit()` отклоняется, а не разрешается, если `onSubmit` (или другой колбэк pipeline) бросил исключение.

### Рецепты

```typescript
// Computed value
total: { value: (v: { price: number; quantity: number }) => v.price * v.quantity, isReadOnly: true },

// Цепочка computed — ничего объявлять не нужно: каждое значение отслеживает то, что читает
tax:   { value: (v: { price: number }) => v.price * 0.2 },
total: { value: (v: { price: number; tax: number }) => v.price + v.tax },

// formatter — нормализация при записи
email: { value: "", formatter: (v: string) => String(v).trim().toLowerCase() },

// setter — каскадное изменение других полей
country: { value: "RU", setter: () => ({ city: "" }) },

// onChange группы — реакция на изменение любого поля внутри
passport: {
  onChange: ({ fieldKey }: { fieldKey: string }) => {
    if (fieldKey === "number") return { issueDate: "" };
  },
  number:    { value: "" },
  issueDate: { value: "" },
},

// Групповой submit с валидацией
company: {
  onSubmit: async (values: { name: string; taxId: string }) => api.saveCompany(values),
  afterSubmit: (_result: unknown, { reset }: { reset: () => void }) => { showSuccessToast(); reset(); },
  name:  { value: "", isRequired: true },
  taxId: { value: "" },
},
```

---

## Async-резолверы

> 🔗 **Код:** [config/catalog/](./app-demo/src/config/catalog), [modules/async-demo/](./app-demo/src/modules/async-demo) · **Живой результат:** [Демо → Async-резолверы](https://projectint.github.io/palistor/#async)

`resolve` загружает данные асинхронно. Он ставится на группу (результат патчит её поля), на поле (результат становится его значением) или на список (результат становится его строками — см. [Списки и сущности](#списки-и-сущности)).

```typescript
const store = new Palistor({
  config: {
    userId: { value: "" },

    userInfo: {
      resolve: {
        // `values` — значения всей формы: каждое прочитанное значение становится зависимостью,
        // в том числе чтения после `await`. При изменении userId резолвер запустится снова.
        // `store` даёт доступ к остальному store; прочитанный ключ store.context — тоже зависимость.
        resolver: async (values: { userId: string }, store: ProxyStore<any>) => {
          const data = await api.getUser(values.userId);
          return { name: data.name, email: data.email };
        },

        // Мгновенный placeholder, пока резолвер выполняется
        optimisticResolver: () => ({ name: "Загрузка…" }),

        // `notify` — функция уведомлений store, `t` — его транслятор: сообщение собирается здесь, без хука
        onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) => {
          notify(t("errors.loadUser"), "USER_LOAD_ERROR");
        },

        deps: ["userId"],            // зависимости на каждом запуске, прочитаны они или нет
        contextDeps: ["accountId"],  // запускаться, только пока store.context.accountId != null

        options: {
          lazy: true,      // ждать первого чтения узла, в том числе `loading` (default: true)
          suspense: false, // бросать promise для React Suspense (default: false)
          retry: { attempts: 3, delay: 1000 }, // ещё 3 попытки после ошибки, с паузой 1000 мс (delay по умолчанию: 1000)
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

`loading` равен `true`, пока резолвер выполняется, и ещё до его первого запуска, если тот вот-вот начнётся: у eager-резолвера (`lazy: false`) — с момента создания store, у lazy — с первого чтения узла. Чтение `loading` тоже считается таким чтением, поэтому `if (form.userInfo.loading) return <Spinner />` показывает спиннер уже в первом рендере. Store, созданный через `usePalistor`, запускает прогоны после первого коммита компонента: до этого они только готовятся стартовать, и `loading` уже равен `true`. Резолвер, который ещё ждёт свои `contextDeps`, читается как `loading: false`. На сервере резолверы не запускаются, а узел с `suspense: true` без данных отдаёт fallback своей границы — см. [SSR и Next.js](#ssr-и-nextjs).

При изменении зависимости resolve-состояние сбрасывается, `optimisticResolver` применяется мгновенно, резолвер запускается снова; изменение во время прогона запускает его ещё раз после того, как прогон завершится. После успеха обновляется dirty-baseline — загруженные данные не считаются «грязными».

- **`deps`** считаются зависимостями на каждом запуске, прочитаны они или нет: для значения, которое читается только при каком-то условии, или для узла, данные которого пришли из `initialData` (его резолвер ещё не запускался, значит, ничего не отслежено).
- **`contextDeps`** только откладывают старт: прогон, который должен начаться, пока перечисленный ключ равен `null` (первый, по изменению зависимости, по `reload()`), ждёт и сохраняет последний результат. Смена ключа сама по себе резолвер не перезапускает — это делает чтение `store.context.accountId` в резолвере (исключение — узел, заполненный из `initialData`: до первого прогона он перезапускается при смене ключа из `contextDeps`). Resolve строк и entity никогда не ждёт; список с пагинацией `contextDeps` не учитывает.
- **`retry`**: `attempts` дополнительных попыток после первой ошибки. `loading` всё это время остаётся `true`, а `onError` вызывается один раз — после последней попытки.
- **Списки** игнорируют `retry` и `optimisticResolver`; их retry — `list.reload()`.
- Присваивание `values.x` внутри резолвера применяется вместе с его результатом.

`onError(error, { notify, t })` получает ошибку и контекст. `notify` вызывает функцию уведомлений store (см. [Уведомления](#уведомления)). `t` — текущий транслятор store: тот, что передан в конструктор, в `<PalistorProvider>`, в `store.setTranslator` или в `useTranslator`. Это стабильная ссылка: она следует за последующим `setTranslator`, а без зарегистрированного транслятора возвращает ключ. Поэтому сообщение об ошибке собирается прямо в конфиге, без хука. Экспортируемый тип `ResolveErrorContext` пока объявляет только `notify`: в обычном объекте конфига аннотируйте параметр, как выше, а там, где resolve типизирован, приводите тип (см. [Уведомления](#уведомления)).

---

## Списки и сущности

> 🔗 **Код:** [modules/lists-demo/](./app-demo/src/modules/lists-demo) · **Живой результат:** [Демо → Списки и сущности](https://projectint.github.io/palistor/#lists)

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
    resolver: async (values, store) => api.getUsers(values.search), // → Promise<User[]>
    deps: ["search"],
  },
});

const store = new Palistor({
  config: { search: { value: "" }, users },
});
```

Элементы хранятся в **нормализованном реестре сущностей**: одна entity может входить в несколько списков и отображаться через разные шаблоны без дублирования.

### API списка

```typescript
const form = useForm(store);

// Чтение
form.users.items         // ReadonlyArray<узел entity>
form.users.length        // number
form.users.loading       // boolean
form.users.dirty         // boolean — состав изменился vs. baseline: свой или вложенного списка
form.users.error         // unknown | null — ошибка последнего resolve
form.users.resolveStatus // "idle" | "pending" | "resolved" | "error"
form.users.getValues()   // Array<plain object>

// Перезапуск резолвера (игнорирует дедуп по resolved; no-op без резолвера)
form.users.reload();

// Итерация
form.users.map((item, index, id) => <Row key={id} item={item} />)
for (const item of form.users) { /* … */ } // текущие строки, но не будит lazy-список и не подписывает компонент

// Мутации
form.users.add({ name: "Alice", email: "alice@ex.com" }); // объект → upsert + добавить; вернёт узел элемента (без id — временный)
form.users.add("existing-id");                            // строка → добавить entity, которая уже есть в реестре; вернёт undefined
form.users.remove("user-id");                             // только из этого списка; store.delete(id) удаляет отовсюду
form.users.setItems(["id1", "id2", "id3"]);               // заменить состав: id и/или строки (строки upsert-ятся)
form.users.getById("user-id");                            // → узел элемента | undefined
```

`add(id)` игнорирует id, которого нет в реестре (per-entity список бросает ошибку), и никогда не добавляет id дважды; `setItems` из повторяющихся id оставляет первый. Публичный тип `setItems` принимает id; строки принимаются в рантайме.

У списка с [фильтром](#фильтрация) `items`, `length`, `map` и итерация показывают видимые строки; `getById`, `getValues()`, `dirty` и `store.getValues()` работают с полным составом. У [списка с пагинацией](#пагинация) они охватывают текущее окно, а `dirty` — все закэшированные страницы.

`dirty` списка считается по составу: состав списка отличается от загруженного — или строка списка владеет вложенным списком, который грязен по тому же правилу, на любой глубине. Поэтому `add` / `remove` / `setItems` во вложенном списке делают грязными сам вложенный список, строку, которая им владеет, список, в который входит эта строка, и форму (`form.dirty`). Значения полей строки в этом не участвуют: правка поля делает грязной строку, а не список. `store.reset()` отменяет правки внутри вложенных списков и в списках с пагинацией; обычный корневой список сохраняет собственные `add` / `remove` / `setItems` (его `reload()` снова делает baseline загруженные строки). Успешный `submit()` сам по себе не сдвигает baseline ни у какого узла: вложенная цепочка становится чистой после `afterSubmit: (_result, { reset }) => reset()` корня (при `store.submit()`), после `store.reset()` или после `reload()` вложенного списка; собственный `reset()` группы вложенные списки не трогает.

В TypeScript элементы `items` (и строки, которые отдаёт `map`) — непрозрачные `PalistorRef<User>`: передайте строку в компонент, который читает её через `useForm(row)`, как ниже.

### Состояние resolve: loading / error / reload

`loading`, `error` и `resolveStatus` — проекции одного состояния resolve, поэтому они всегда
согласованы и реактивны: компонент, читающий `error`, перерисуется и при появлении ошибки, и при её
исчезновении.

```tsx
function Users() {
  const form = useForm(store);
  const users = form.users;

  if (users.error) return <LoadError onRetry={() => users.reload()} />;
  if (users.loading) return <Spinner />;

  return <ul>{users.map((u, i, id) => <UserItem key={id} user={u} />)}</ul>;
}

function UserItem({ user }: { user: PalistorRef<User> }) {
  return <li>{useForm(user).name.value}</li>; // своя область трекинга: перерисовывается одна
}
```

`loading` равен `true`, пока идёт прогон, а также с первого чтения списка до старта первого прогона.
Чтение `loading` — тоже такое чтение: оно будит lazy-резолвер так же, как `items`. Поэтому компонент
выше показывает спиннер уже в первом рендере, в том числе на сервере (см.
[SSR и Next.js](#ssr-и-nextjs)). `resolveStatus` остаётся `"idle"`, пока прогон действительно не начался.

`reload()` перезапускает резолвер даже после успешной загрузки. У обычного списка `reload()` во время
прогона ничего не делает; у списка с пагинацией это `refetch()`: один новый запрос, который вытесняет
текущий. Идентичность функции стабильна — её можно класть в массив зависимостей или в проп `onRetry`.
Работает одинаково для корневых и вложенных (per-entity) списков.

> **У групп `error` пока нет.** Ошибка резолвера группы/флоу по-прежнему доступна только через
> колбэк `onError`; `error` / `resolveStatus` / `reload()` — пока только для списков.

> **`error`, `resolveStatus` и `reload` не переименовываются через `fieldMapping`** (`loading` —
> переименовывается). Они сопоставляются до применения маппинга, поэтому маппинг вида `{ isInvalid: "error" }` их не перекрывает: у **поля** `.error`
> остаётся флагом валидации, у **списка** `.error` — ошибка resolve. На одном узле они не встречаются.

### Фильтрация

> 🔗 **Код:** [cube/contract/sliceE/](./cube/contract/sliceE) — описанное здесь поведение в виде тестов

Список принимает блок `filter` рядом со своим `resolve`. **Серверное поле** передаётся резолверу, и его изменение запрашивает данные заново; **клиентское поле** (`where`) фильтрует уже загруженные строки и никогда ничего не запрашивает.

```typescript
interface Car { id: string; name: string; isNew: boolean }

const cars = defineList<Car>({
  template: { id: { value: "" }, name: { value: "" }, isNew: { value: false } },
  filter: {
    search:  { value: "", debounce: 300 },                       // серверное поле: запрос через 300 мс после последнего изменения
    brand:   { value: null as string | null, param: "brand_id" }, // серверное поле, уходит как brand_id
    onlyNew: { value: false, where: (car: Car, on: boolean) => car.isNew === on }, // клиентское поле
  },
  resolve: {
    resolver: async (_values, _store, ctx) => api.cars(ctx.filter.params), // { search, brand_id }
  },
});
```

```tsx
function CarFilters() {
  const cars = useForm(store).cars;
  const filter = cars.filter!; // в типе необязателен: он есть только у списка с блоком

  return (
    <>
      <Input {...filter.search} />                          {/* поле фильтра подключается как поле формы */}
      <Checkbox isSelected={filter.onlyNew.value} onValueChange={filter.onlyNew.onValueChange} />
      {filter.isActive && <button onClick={() => filter.clear()}>Сбросить ({filter.activeCount})</button>}
      <span>{cars.length} из {cars.fullLength}</span>
    </>
  );
}
```

- **Поля.** Поле принимает словарь листа (`value`, `label`, `formatter`, вычисляемые флаги, `onChange`…) плюс `where` (клиентское поле), `param` (переименовать серверный параметр) и `debounce` (мс). Литерал — сокращение: `search: ""` — это `{ value: "" }`. Поле, у которого `value` — функция, производное: только для чтения, не отправляется, активным не считается. Опции блока: `$all(row, filterValues)` — ещё одно клиентское правило, выполняется последним; `$toParams(filterValues, context)` — собрать параметры самостоятельно.
- **Элементы управления.** `list.filter.<поле>` — узел поля: `value`, `onValueChange`, `label`… Запись выполняет formatter → setter → `onChange`. `filter.set(patch)` записывает несколько полей (formatters выполняются, setters и `onChange` — нет), `filter.reset()` возвращает объявленные значения по умолчанию, `filter.clear(field?)` записывает пустое значение. `filter.values` — обычный снимок; `isActive` / `activeCount` считают непустые поля; `isPending` равен `true`, пока изменение ждёт debounce.
- **Серверные поля.** После изменения резолвер запускается один раз; с `debounce` ждёт запуск (а не значение), таймер перезапускается при каждом изменении, а ввод с откатом в пределах задержки не отправляет ничего. Изменение без debounce — или `set` / `reset` / `clear` — отправляется сразу и несёт текущие значения отложенных полей. Первый запуск никогда не откладывается. Резолвер получает `ctx.filter`: `values` (все поля), `params` (серверные поля под их именами `param` или то, что вернул `$toParams`) и `key`.
- **Клиентские поля.** `where(row, value)` получает сырую строку и пропускается, пока поле пустое; правила складываются (И). Строка, добавленная локально, видна до следующего resolve.
- **Что показывает список.** `items`, `map`, `length` и итерация — видимые строки, `fullLength` — полное число; `getById`, `getValues()`, `dirty`, `store.getValues()` и submit работают с полным составом.
- **Вне формы.** Фильтра нет в `getValues()`, в `store.proxy.values`, в payload submit, в сохранённых черновиках и в `values` резолвера; `store.reset()` его не трогает, а его `onChange` не всплывает к форме.
- **Пагинация.** Серверные поля входят в ключ запроса: изменение начинает с первой страницы одним запросом, а при `maxCachedQueries > 1` возврат к прежнему фильтру отдаётся из кэша. Клиентские поля фильтруют только текущее окно.
- **Ограничения.** Фильтр у списка, вложенного в строку, игнорируется (предупреждение в консоли). Блок типизирован нестрого: аннотируйте параметры `where`, `$all`, `$toParams`.

### Пагинация

> 🔗 **Исходник:** [modules/lists-demo/OrdersPagedSection.tsx](./app-demo/src/modules/lists-demo/OrdersPagedSection.tsx) · **Живой результат:** [Демо → Списки и сущности](https://projectint.github.io/palistor/#lists)

Список загружает **по одной странице** и кэширует каждую увиденную. Добавьте блок `pagination` в
`resolve` — его наличие и есть единственный переключатель. Резолвер получает запрос страницы как
`ctx.page` и возвращает `{ items, total }`. Голый массив тоже работает: `total` тогда остаётся
`undefined`, `pageCount` считает подряд идущие свежие закэшированные страницы с первой, а `hasNextPage` следует за полной страницей.

```typescript
const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" }, amount: { value: 0 } },
  resolve: {
    deps: ["search"],                       // задаёт ключ запроса до первого прогона
    pagination: { pageSize: 20 },           // mode: "paged" (по умолчанию) | "infinite" | "cursor"
    resolver: async (values, store, ctx) => {
      const r = await api.orders({
        q: values.search,                   // каждое чтение values / context — авто-зависимость
        tenant: store.context.tenantId,
        offset: ctx.page!.offset,           // (page − base) × pageSize; infinite: сколько строк уже загружено
        limit: ctx.page!.pageSize,
        cursor: ctx.page!.cursor,           // режимы cursor / infinite
      });
      return { items: r.rows, total: r.count, nextCursor: r.next }; // PagedResult
    },
  },
});
```

**Переход на закэшированную страницу, пока она свежа, никогда не вызывает резолвер** — это синхронная проекция
(после `staleTime` страница показывается и перепроверяется в фоне). Резолвер вызывается только при
промахе, устаревшей странице или изменении того, что он прочитал (поиск, фильтры, `store.context`, …):
это новый *ключ запроса*, старые страницы инвалидируются и первая страница запрашивается ровно один раз.
Запись тех же значений без изменения — строгий no-op.

```typescript
const list = form.orders; // члены пагинации в типе списка необязательны: под strict TS — list.setPage!(n)

// Реактивные геттеры (пейджер, читающий только page / pageCount, перерисуется на setPage)
list.page            // текущая страница (с учётом `base`, по умолчанию 1)
list.pageSize
list.pageCount       // из серверного total, иначе — число подряд идущих свежих закэшированных страниц
list.total           // ОТОБРАЖАЕМЫЙ total: серверный ± локальные оптимистичные add/remove
list.serverTotal     // сырой серверный total — меняется только на fetch / delete / подтверждённый add
list.hasNextPage     // оптимистичный add его не обманывает
list.hasPrevPage
list.isFetching      // любой запрос страницы в полёте (`loading`: он же или первый запрос, который вот-вот уйдёт)
list.isInitialLoading // грузим или вот-вот начнём, а в кэше ещё ничего — скелетон vs. спиннер;
                     // чтение будит lazy-список, как `loading` и `items`
list.isPreviousData  // `keepPreviousData`: строки на экране принадлежат предыдущему запросу
list.isStaleFromStorage // окно пришло из storage уже просроченным (staleTime) и ещё не перепроверено
list.pendingAdds     // id не отправленных на сервер оптимистичных добавлений

// Навигация
list.setPage(n);     // закэширована и свежа → синхронно; иначе один запрос
list.nextPage();  list.prevPage();
list.prefetch(n);    // прогреть кэш, не двигая указатель (hover); возвращает Promise
list.setPageSize(n); // очистить кэш, один запрос первой страницы

// Свежесть — всегда не больше ОДНОГО запроса
await list.refetch();   // paged: весь запрос устаревает, текущая страница перезапрашивается сейчас;
                        // infinite / cursor: pull-to-refresh — назад к первой странице
list.invalidate();      // paged: все страницы устаревают, текущая перезапрашивается сейчас;
                        // cursor: назад к первой странице с перезапросом; infinite: окно сжимается
                        // до первой страницы, она помечается устаревшей, запроса нет
list.invalidate(3);     // одну страницу — paged: устаревает, перезапрос сейчас, если текущая; cursor: страницы
                        // после неё сбрасываются, указатель возвращается к ней, перезапрос; infinite: страницы
                        // после неё сбрасываются, запроса нет
list.discardPendingAdds(); // выбросить неотправленные строки (выход из «вечно dirty»)

// режим infinite
list.loadMore();            // дозагрузить следующую страницу (кэш ⇒ без запроса; no-op пока грузится)
list.isFetchingNextPage     // спиннер в футере, не путать с isInitialLoading
list.loadedPages            // [{ ordinal, ids }] — для UI с заголовками секций

// режимы infinite и cursor
list.continuationLost       // цепочку курсоров не восстановить → предложите «Обновить ленту»
```

```tsx
function Orders() {
  const form = useForm(store);
  const orders = form.orders;
  return (
    <>
      {orders.isInitialLoading ? <Skeleton /> : orders.map((o, i, id) => <Row key={id} order={o} />)}
      <button disabled={!orders.hasPrevPage} onClick={orders.prevPage}>Назад</button>
      <span>Страница {orders.page} из {orders.pageCount}{orders.isFetching && " …"}</span>
      <button disabled={!orders.hasNextPage} onClick={orders.nextPage}>Вперёд</button>
    </>
  );
}
```

**Режимы.** `paged` — одна страница на экране, произвольный доступ. `infinite` — окно накапливается
(`loadMore`); продолжение идёт по `nextCursor`, если резолвер его вернул, иначе по offset; `setPage`
там ничего не делает (предупреждение в консоли, один раз), а `setItems` бросает ошибку в development и
предупреждает в production. `cursor` — одна страница
на экране, последовательный доступ через `nextCursor`: `setPage(n)` достигает закэшированной страницы
или следующей, а `prevPage` бесплатен, пока та страница свежа.

**Конец ленты.** В режимах `infinite` и `cursor` страница, которая пришла с явным `nextCursor: null`, —
последняя: `hasNextPage` равен `false`, `loadMore()` и `nextPage()` ничего не запрашивают, а в режиме
`cursor` ничего не запрашивают и `setPage(next)` с `prefetch(next)`. Явный `null` важнее `total`,
`hasMore: true` и полной страницы. Страница без этого поля о конце ничего не говорит: решают `total`,
`hasMore` или полная страница. Поэтому лента, которая продолжается по offset, должна не передавать
`nextCursor` вовсе, а не присылать `null`. Для первой страницы, переданной через `initialData`
(`{ items, nextCursor: null }`), правило то же.

**Локальные правки и кэш.** `add / remove / setItems` меняют закэшированную страницу, на которую
попадают (`add` — текущую, в `infinite` — последнюю загруженную; `setItems` — только текущую); видимое
окно — всегда проекция страниц. `dirty` — агрегат по всем закэшированным страницам, так что
неотправленный add на невидимой странице держит список грязным, как и правка во вложенном списке
строки с такой страницы. `store.reset()` откатывает правки каждой страницы и сохраняет навигацию (без
запроса); `reset()` группы страницы не трогает. `store.rekey(tmp, real)` доходит до каждой страницы и переводит подтверждённую строку в
серверную правду; `store.delete(id)` вырезает её из всех страниц, а для серверной строки помечает
последующие страницы устаревшими (paged / cursor) или сдвигает offset продолжения (infinite).
Удалённая строка в режиме `paged` на экране замещается головой следующей закэшированной страницы, пока
та не перезапрошена.

| Опция `pagination` | По умолчанию | Смысл |
|---|---|---|
| `pageSize` | — | обязательна |
| `mode` | `"paged"` | `"paged"` \| `"infinite"` \| `"cursor"` |
| `base` / `initialPage` | `1` / `base` | нумерация страниц (`base` — 0 или 1) |
| `staleTime` | `Infinity` | мс, пока закэшированная страница отдаётся без фонового перезапроса (stale-while-revalidate) |
| `maxCachedQueries` / `gcTime` | `1` / `Infinity` | сколько ключей запроса хранить (возврат к старому фильтру ⇒ кэш) и как долго |
| `maxCachedPages` | `Infinity` | LRU-лимит страниц на запрос (видимое окно не вытесняется) |
| `maxPages` | `Infinity` | `infinite`: окно держит не больше стольких страниц — старые уходят из памяти, offset продолжения сохраняется |
| `keepPreviousData` | `false` | держать строки предыдущего запроса, пока грузится первая страница нового |
| `persist` | `{ maxPages: 3 }` | что попадает в storage: ограниченный хвост, `"window"` (всё + якорь скролла) или `false` |
| `persistPendingAdds` | `"keep"` | неотправленные добавления переживают перезагрузку (`"drop"` — выбросить) |
| `revalidateOnHydrate` | `"first"` | что перепроверяет восстановленное просроченное окно после отрисовки (`"none"` \| `"first"` \| `"all"`) |
| `queryKey(values, context)` | авто | запасной выход, если авто-зависимости не сериализуются; заменяет автоматический ключ |

**Persist.** С `usePersist` / `store.persist` текущая страница корневого списка (а для `infinite` —
хвост окна) восстанавливается после перезагрузки и отдаётся без запроса — но только если сохранённый
запрос совпадает с живыми значениями и контекстом (окно, сохранённое для tenant A, никогда не отдаётся
tenant B). При `persist: "window"` вызывайте `list.setScrollAnchor(id)` из IntersectionObserver и
читайте `list.scrollAnchor` после гидрации, чтобы восстановить скролл. Список с пагинацией, вложенный в
строку, возвращается вместе со строками владельца, а кэш его страниц запрашивается заново.

**Вложенные списки.** Тот же блок `pagination` на списке внутри шаблона сущности пагинирует **каждый
per-entity экземпляр независимо** (`user.orders.setPage(2)`) — со своим кэшем и ключом запроса.
Резолвер получает значения владельца первым аргументом; прочитанные поля владельца становятся его
зависимостями, так что правка `user.region` перезапрашивает только список этого пользователя.

**Контекст.** Список с пагинацией не учитывает `contextDeps`. Ключ `store.context`, который читает
резолвер, входит в ключ запроса; чтобы ключевать по нему ещё до первого прогона, укажите его в `deps`
как `"$context.tenantId"`.

**Suspense.** `resolve.options.suspense: true` заставляет `items` / `map` / `length` бросать промис
запроса, пока списку нечего показать (первая страница или смена запроса без `keepPreviousData`);
навигация по страницам и `loadMore` никогда не «подвешивают» уже показанные строки.

### Элемент списка — свойства

Каждый элемент `form.users.items` — узел entity, видимый через шаблон. В TypeScript это непрозрачный `PalistorRef`; `useForm(row)` в компоненте строки возвращает типизированный узел:

```typescript
const item = useForm(user); // user: PalistorRef<User>, элемент form.users.items

item.id             // string — идентификатор entity (меняется по store.rekey)
item.name.value     // значение поля через template
item.name.label     // computed label из template
// …все leaf-свойства: value, label, placeholder, description, isRequired, isReadOnly, isDisabled,
//   isVisible, isInvalid, errorMessage, dirty, loading, onValueChange

item.dirty          // boolean — изменилось поле этой строки или вложенный в неё список грязен
item.values         // значения строки (объект из геттеров, как values группы)
item.loading        // boolean — у узла, который вернул useForm(entity, template): выполняется resolve
                    // его шаблона; у строки списка остаётся false
item.submitting     // boolean — для этой entity выполняется submit
await item.submit(); // → SubmitResult — правила validate шаблона, затем его onSubmit
```

В строке `formatter` поля применяется при записи, а его `validate` вживую, без submit, управляет `isInvalid` / `errorMessage`; `isRequired` там — только флаг для отображения. Собственный resolve поля виден в `item.<поле>.loading`. `item.submit()` вызывает `onSubmit(entityNode, store)` шаблона — с узлом, а не с обычным payload, — без `beforeSubmit`. У шаблона не может быть вычисляемого `value`; его поле `id` перекрывается `item.id`.

**Вложенные списки.** Список, объявленный внутри шаблона, — per-entity список: у каждой строки свой экземпляр, он читается из строки (`item.orders`) через тот же API списка. Его резолвер получает значения владельца. Вложенный список получает строки от собственного резолвера, через `setItems` / `add` или из `initialData`. Резолвер списка уровнем выше его не заполняет: вложенный массив в строке, которую вернул резолвер, — не состав вложенного списка. А `initialData` и сохранённый черновик (persist) заполняют вложенные списки из строк (см. [SSR и Next.js](#ssr-и-nextjs)).

**`store.reset()` и строки.** Полный `store.reset()` ничего не запрашивает для строк. Вложенный список и поле строки, у которых resolve уже получил результат, остаются resolved: состав списка возвращается к тому, что загрузил резолвер (или `initialData`), `loading` равен `false`, и следующее чтение резолвер не вызывает — как и у корневого списка. Сброс доходит и до вложенных списков тех строк, которых нет на экране (они на другой закэшированной странице списка с пагинацией). Resolve, который к моменту сброса ещё выполнялся или завершился ошибкой, при следующем чтении запускается заново. Чтобы намеренно загрузить вложенный список ещё раз, вызовите его `reload()`.

### Отображение entity через другой шаблон

Привяжите entity к любой template-группе (например, форме редактирования) через двухаргументный `useForm`:

```tsx
function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user, (s) => s.editUserForm);
  return <span>{u.name.value}</span>;
}
```

При mount entity привязывается к шаблону, и резолвер шаблона выполняется один раз на пару entity+template (кэшируется) как `resolver(entityNode, store)` — без авто-трекинга, `deps`, retry и оптимистичного значения; его результат мержится в строку. `store.invalidate(id, templateConfig)` забывает выполненный прогон, и следующий mount `useForm(entity, template)` запускает резолвер снова.

### Работа с entity напрямую

```typescript
// Создать / обновить entities (одна или батч — одно уведомление; рекурсивный merge)
store.set({ id: "u1", name: "Bob" });
store.set([{ id: "u1" }, { id: "u2" }]);

// Строка без id получает временный (_tmp_…, его видно в `id` узла строки).
// Для оптимистичного добавления проще задать свой временный id…
form.users.add({ id: "tmp-1", name: "Ann", email: "" });
// …и переименовать его, когда сервер присвоит настоящий:
store.rekey("tmp-1", serverAssignedId);

// Удалить entity (принадлежащие ей дочерние удаляются каскадно)
store.delete("u1");
```

---

## Flows (пошаговые мастера)

> 🔗 **Код:** [config/flow.ts](./app-demo/src/config/flow.ts), [modules/flow-demo/](./app-demo/src/modules/flow-demo) · **Живой результат:** [Демо → Flows](https://projectint.github.io/palistor/#flow)

`defineFlow` / `defineStep` строят пошаговый мастер поверх обычных групповых узлов: навигационное состояние, статусы шагов, ветвление и валидация по шагам.

```typescript
import { defineFlow, defineStep, Palistor } from "palistor";

interface Nav { nextStep: () => void }
interface OnboardingValues { plan: { plan: string } }

const onboarding = defineFlow({
  steps: [
    defineStep("account", {
      fullName: { value: "", isRequired: true },
      email:    { value: "", isRequired: true },
      // Третий аргумент onSubmit — узел флоу; навигационные методы bound,
      // поэтому деструктуризация работает. Submit шага сначала валидирует шаг.
      onSubmit: (_values: unknown, _store: unknown, { nextStep }: Nav) => nextStep(),
    }),

    defineStep("plan", {
      plan: { value: "", isRequired: true },
      onSubmit: (_values: unknown, _store: unknown, { nextStep }: Nav) => nextStep(),
    }),

    // Ветвление: скрытый шаг пропускается nextStep() и исключается из
    // финальной валидации.
    defineStep("company", {
      isVisible: (values: OnboardingValues) => values.plan.plan === "enterprise",
      companyName: { value: "", isRequired: true },
      onSubmit: (_values: unknown, _store: unknown, { nextStep }: Nav) => nextStep(),
    }),

    defineStep("summary", {}), // read-only шаг-сводка
  ],

  // Финализация уровня флоу — идёт через стандартный submit pipeline
  // (defineFlow принимает и beforeSubmit / afterSubmit)
  onSubmit: async (allValues, store) => api.completeOnboarding(allValues),
});

const store = new Palistor({ config: { onboarding } });
```

### API узла флоу

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
flow.steps.current     // узел активного шага
flow.steps.account     // по ключу
flow.steps[0]          // по индексу
flow.steps.length      // число шагов
[...flow.steps]        // итерируемо

// Узел шага = обычный групповой узел + status
flow.steps.account.status   // "active" | "completed" (посещался раньше) | null (ещё не посещался)
flow.steps.account.email    // узел поля — обычный лист

// Навигация
flow.nextStep();        // следующий ВИДИМЫЙ шаг; впереди нет → финализация через flow.submit()
flow.back();            // pop стека посещений; no-op при пустом стеке
flow.goTo("plan");      // прыжок по ключу или индексу; покинутый шаг уходит в стек «назад»
flow.validate();        // валидация посещённых видимых шагов → возвращает ошибки и кладёт их в flow.errors

// Значения и финализация
flow.values             // аккумулированные значения всех шагов, по ключам шагов
await flow.submit();    // стандартный pipeline; ошибки скрытых шагов отфильтровываются
```

- `nextStep()` не валидирует шаг, который покидает: вызывайте его из `onSubmit` шага, как выше, чтобы идти дальше только с валидным шагом. Когда впереди нет видимого шага, он финализирует fire-and-forget: навигация остаётся на месте, ошибки попадают в `flow.errors`.
- `goTo()` бросает ошибку на неизвестный ключ или индекс вне диапазона, для активного шага ничего не делает и скрытые шаги не пропускает.
- `validate()` проверяет посещённые видимые шаги (скрытые поля пропускаются) и не раскрывает ошибки полей: `errorMessage` остаются скрытыми до submit.
- `"completed"` значит «посещался раньше и сейчас не активен» — не обязательно валиден или отправлен.
- Скрытый шаг пропускается `nextStep()` и исключается из финальной валидации, но его значения остаются в `flow.values` и в payload `onSubmit`: при необходимости уберите их в `beforeSubmit` или `onSubmit`.
- Узел флоу — тоже групповой узел: `loading` (какой-то шаг грузится), `dirty`, `isInvalid` (посещённые видимые шаги), `revalidate`, `reset()`. Флоу может стоять внутри группы. Ключи шагов не могут занимать собственные имена флоу (`values`, `steps`, `current`, `length`, навигационные имена…), а у шага не может быть поля `status`.

### Lifecycle шага

Конфиг шага, помимо всего, что умеет группа, принимает два flow-колбэка:

```typescript
defineStep("details", {
  onEnter: (flowValues: unknown, store: ProxyStore<any>) => { /* при входе в шаг */ },
  onReady: (flowValues: unknown, store: ProxyStore<any>) => { /* после того, как resolve шага завершился */ },
  resolve: { resolver: async () => api.getDetails(), onError: () => {} },
  // …поля
})
```

При входе в шаг: `onEnter → resolve (запускается сразу) → onReady`. `onEnter` срабатывает при каждом входе. `onReady` — когда resolve шага завершился, успехом или ошибкой, то есть один раз на прогон resolve: шаг, в который вернулись с закэшированным resolve, получает `onEnter`, но не новый `onReady`; шаг без `resolve` получает `onReady` при каждом входе. Оба — fire-and-forget: исключение навигацию не блокирует. Первый шаг каждого флоу «входится» при старте store: у `new Palistor()` — в конструкторе, у `usePalistor` — после первого коммита компонента. До этого — и в серверном режиме, где ничего не запускается, — колбэки не вызываются, а первый шаг с `resolve` читается как `loading: true` (см. [SSR и Next.js](#ssr-и-nextjs)). `reset()` флоу (или любого предка) сбрасывает навигацию на первый шаг и заново выполняет entry lifecycle, включая resolve шагов.

Навигация флоу (текущий шаг, история) входит в снапшот [persist](#persist) и восстанавливается при гидратации. Учтите, что успешный submit группы очищает снапшот — в том числе `submit()` шага.

---

## Field mapping

> 🔗 **Код:** [config/fieldMapping.ts](./app-demo/src/config/fieldMapping.ts), [modules/field-mapping/](./app-demo/src/modules/field-mapping) · **Живой результат:** [Демо → Field mapping](https://projectint.github.io/palistor/#mapping)

`fieldMapping` переименовывает пропсы состояния поля **на границе узла** — чтение, запись, трекинг и spread, — так что `{...form.email}` несёт пропсы под именами вашего UI-кита (MUI, Ant Design, нативный HTML). Ядро внутри не меняется.

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
  // Internal-имя (isRequired) ремапленного ключа — ошибка типа и исключение в рантайме.
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
  return (
    <TextField
      {...form.email} // required / error / helperText — как ждёт MUI
      onChange={(e) => form.email.onValueChange(e.target.value)} // MUI передаёт событие, а не значение
    />
  );
}
```

Переименовываемые ключи: `value`, `label`, `placeholder`, `description`, `isRequired`, `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`, `loading`, `onValueChange`. Без `fieldMapping` — нулевой оверхед и никаких изменений поведения.

- Спред несёт `value`, `label`, `placeholder`, `description`, четыре флага, `isInvalid`, `errorMessage` (под переименованными именами, где они заданы), `onValueChange(value)` и ключи `componentProps`; `dirty` / `loading` читаются под переименованными именами, но в спред не попадают (у поля строки списка — попадают). Инпуту на событиях нужен `onChange={(e) => form.email.onValueChange(e.target.value)}` (или компонент-адаптер), а непереименованные пропсы доходят до компонента под своими именами.
- В конфиге допустимы только входные имена: `value`, `label`, `placeholder`, `description` и четыре флага. `isInvalid`, `errorMessage`, `dirty`, `loading` и `onValueChange` — только выходные; их external-имя в конфиге бросает ошибку. Переименование в зарезервированный ключ списка (`filter`, `values`, `page`, `total`, …) бросает ошибку при создании store.
- Internal-имена остаются читаемыми в рантайме вне спреда (типы их скрывают). Ключи дочерних узлов, `getValues()` и payload submit никогда не переименовываются.

> Для переиспользуемой карты используйте `defineFieldMapping` (или `as const`) — аннотация `: FieldMapping` или `satisfies FieldMapping` расширит литералы до `string`, и статическое переименование потеряется.

---

## Persist

> 🔗 **Код:** [modules/payment-form/PersistControls.tsx](./app-demo/src/modules/payment-form/PersistControls.tsx) · **Живой результат:** [Демо → Форма оплаты](https://projectint.github.io/palistor/#form)

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

Хук гидратирует при mount, автосохраняет при изменениях, при unmount делает flush и отключается. Гидратация асинхронна даже с синхронным драйвером, поэтому она приходит после первого рендера. Смена `key` или `driver` сохраняет под старым ключом и гидратирует из нового; изменения остальных опций применяются только при таком переподключении.

### Вне React

```typescript
import { localStorageDriver } from "palistor";

await paymentStore.persist.enable({ key: "payment", driver: localStorageDriver }); // разрешается после гидратации
await paymentStore.persist.flush();   // принудительное сохранение (no-op, пока идёт гидратация)
await paymentStore.persist.hydrate(); // перечитать хранилище
await paymentStore.persist.clear();   // удалить снапшот
paymentStore.persist.isEnabled();     // → boolean
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

Встроенные `localStorageDriver` / `sessionStorageDriver` ничего не делают там, где хранилища нет (на сервере), и передают ошибку переполнения квоты в `onError`.

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
| `onError` | `(error, phase: "save" \| "hydrate") => void` | — | Вызывается, когда сохранение или гидратация не удались (иначе ошибки проглатываются) |

**Что входит в снапшот.** Значения (после `pick` / `omit`), состав списков, включая вложенные, навигация каждого флоу (всегда, что бы ни говорили `pick` / `omit`) и окна корневых списков с пагинацией (если их массив проходит `pick` / `omit`). Фильтры не сохраняются никогда. Кастомные `serialize` / `deserialize` должны сохранять и служебные ключи `__flows` и `__pagination`. Гидратация применяет сырые значения — без formatter, setter и `onChange` — одним уведомлением.

**Успешный submit очищает снапшот.** Успешный `submit()` store или любой группы — в том числе шага флоу и самого флоу — удаляет снапшот; он записывается снова после следующего изменения. Submit листа или entity его сохраняет.

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

В конфиге переводимые строки — функции от `(t, values)`; статическая строка показывается как есть:

```typescript
cardNumber: {
  value: "",
  label:       (t: TranslateFn) => t("fields.cardNumber.label"),
  placeholder: (t: TranslateFn) => t("fields.cardNumber.placeholder"),
},
```

Колбэк `validate` получает `t` третьим аргументом, а функции флагов (`isVisible`, `isRequired`, …) — вторым. Без зарегистрированного транслятора функции получают identity-`t`, то есть функция `label` возвращает свой ключ, — удобно для тестов.

`onError` резолвера тоже получает `t` — в контексте, рядом с `notify`, — так что сообщение об ошибке переводится прямо в конфиге, без хука:

```typescript
userInfo: {
  resolve: {
    resolver: async () => api.getUser(),
    onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) =>
      notify(t("errors.loadUser")),
  },
  name: { value: "" },
},
```

Этот `t` — текущий транслятор store, он следует за последующим `store.setTranslator`. `NotifyFn` и `TranslateFn` — типы, экспортируемые пакетом; зачем параметр аннотирован, объясняется в разделе [Уведомления](#уведомления).

`useTranslator` регистрирует функцию в эффекте, после mount: в серверном HTML и в первом клиентском рендере её ещё нет. Чтобы перевод был уже в первом рендере, передайте функцию в конструктор — `new Palistor({ config, translator: t })` — или в `<PalistorProvider translator={t}>`: он отдаст её каждому store, созданному через `usePalistor` ниже по дереву (см. [SSR и Next.js](#ssr-и-nextjs)). При unmount `useTranslator` снимает регистрацию: подписи возвращаются к ключам, даже если транслятор был передан в конструктор.

---

## Уведомления

> 🔗 **Код:** [config/catalog/catalogConfig.ts](./app-demo/src/config/catalog/catalogConfig.ts) · **Живой результат:** [Демо → Async-резолверы](https://projectint.github.io/palistor/#async)

Зарегистрируйте функцию toast/alert один раз; резолверы получат её в `onError` через `ctx.notify`:

```tsx
import { useCallback } from "react";
import { useNotifier } from "palistor";

function RootLayout({ children }: { children: React.ReactNode }) {
  const notifyError = useCallback((message: string, code?: string) => {
    addToast({ title: message, description: code, color: "danger" });
  }, []);

  useNotifier(paymentStore, notifyError);
  return <>{children}</>;
}
```

Функцию можно передать и в конструктор (`notifier`), в `<PalistorProvider notifier>` или в `store.setNotifier`. `useNotifier` регистрирует её после mount и снимает регистрацию при unmount. Без нотификатора `notify` ничего не делает.

`onError` получает эту функцию в контексте — вместе с транслятором store `t`:

```typescript
import { defineList, type ResolveErrorContext, type TranslateFn } from "palistor";

interface User { id: string; name: string }

const users = defineList<User>({
  template: { id: { value: "" }, name: { value: "" } },
  resolve: {
    resolver: async () => api.getUsers(),
    onError: (error: unknown, ctx: ResolveErrorContext) => {
      const { notify, t } = ctx as ResolveErrorContext & { t: TranslateFn }; // в объявленном типе `t` нет
      notify(t("errors.loadUsers"), "USERS_LOAD_ERROR");
    },
  },
});
```

`notify` передаёт свои аргументы зарегистрированной функции без изменений. `t` — текущий транслятор store: тот, что передан в конструктор, в `<PalistorProvider>`, в `store.setTranslator` или в `useTranslator`. Это стабильная ссылка, которая следует за последующим `setTranslator`; без транслятора она возвращает ключ. И то и другое получает каждый `onError`: у группы, у списка, у списка с пагинацией, у поля строки и у резолвера шаблона в `useForm(entity, template)`.

Экспортируемый тип `ResolveErrorContext` пока объявляет только `{ notify }`. Там, где resolve типизирован, — внутри `defineList`, в типизированном шаблоне, в объекте с типом `Resolve<T>`, — приводите тип, как выше; приведение работает везде. Только в обычном объекте конфига параметр можно вместо этого аннотировать: `onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) => notify(t("errors.loadProfile"))`.

---

## Контекст store

> 🔗 **Код:** [modules/lists-demo/StoreContextSection.tsx](./app-demo/src/modules/lists-demo/StoreContextSection.tsx) · **Живой результат:** [Демо → Списки и сущности](https://projectint.github.io/palistor/#lists)

Нереактивные данные (id аккаунта, tenant, токены…), доступные как `store.context` в колбэках, которые получают store: в резолверах, `onSubmit`, `onEnter` / `onReady` (`$toParams` фильтра получает контекст вторым аргументом). Не является частью формы — не попадает в `getValues()`, submit-payload и persist.

```tsx
import { useStoreContext } from "palistor";

function Layout({ children }: { children: React.ReactNode }) {
  const accountId = useAccountId();
  useStoreContext(store, { accountId }); // мержится в store.context
  return <>{children}</>;
}
```

```typescript
resolve: {
  resolver: async (_values: unknown, store: ProxyStore<any>) =>
    api.fetchUsers(store.context.accountId as string), // чтение делает accountId зависимостью
  contextDeps: ["accountId"], // каждый прогон ждёт, пока context.accountId != null
},
```

Резолвер перезапускается, когда ключ контекста, который он прочитал через свой аргумент `store`, меняется через `setContext` (`useStoreContext`, `usePalistor`, провайдер). `contextDeps` только откладывают прогон. `setContext` мержит неглубоко и ничего не перерендеривает; мутация объекта контекста на месте ничего не перезапускает. Начальный контекст можно передать в конструктор: `new Palistor({ config, context: { accountId } })`. `store.context` типизирован как `Record<string, unknown>`: приводите прочитанное к нужному типу.

`useStoreContext` ставит контекст в эффекте, после mount. Для первого рендера, в том числе серверного, контекст должен быть уже в конструкторе: передайте его туда или положите общие ключи в `<PalistorProvider context={{ accountId }}>`. `usePalistor` подмешивает контекст провайдера в конструктор каждого store ниже по дереву (собственная опция `context` у store важнее по каждому ключу) и передаёт в store последующие изменения; `usePalistorContext()` читает те же значения в компоненте (см. [SSR и Next.js](#ssr-и-nextjs)). `useStoreContext` остаётся как был и действует после mount.

---

## SSR и Next.js

> 🔗 **Код:** [app/ssr/](./app-demo/src/app/ssr) — пять маршрутов, в каждом серверный компонент (`page.cube.tsx`) читает данные и передаёт их клиентскому компоненту с `usePalistor`; провайдер и рамка страницы — в [`shared/`](./app-demo/src/app/ssr/shared). e2e: [e2e/ssr*.spec.ts](./app-demo/e2e) · **Живой результат:** маршруты `/ssr` стенда (на живом демо появятся вместе с 0.1 — см. [Демо](#демо); локально — по адресу `/palistor/ssr/`)
>
> | Маршрут | Что показывает |
> |---|---|
> | `/ssr` | Список с серверными данными и фильтром (после гидратации запроса нет), список без серверных данных (в HTML — его скелетон), группа с `suspense: true` (в HTML — её fallback) |
> | `/ssr/form` | Группа с `resolve`, заполненная через `initialData` (`dirty: false`, `reset()` возвращает к серверным значениям), перезапуск по объявленным `deps` и по `reload()` списка, ошибки резолвера `onError` переводит через `t` store и передаёт в `notifier` провайдера, черновик `usePersist` ложится поверх серверных данных после монтирования |
> | `/ssr/catalog` | Первая страница пагинированного списка как `{ items, total }` (страница 2 — один запрос, страница 1 возвращается из кэша), лента «Показать ещё», которую завершает `nextCursor: null`, скелетон `isInitialLoading` у пагинированного списка без серверных данных, вложенные списки в строках |
> | `/ssr/flow` | Шаг flow с серверными данными (в браузере `onEnter` и `onReady` по одному разу, запроса нет), следующий шаг загружается один раз и остаётся в кэше, flow без данных: состояние загрузки активного шага уже в HTML |
> | `/ssr/runtime` | `server: true` и `store.start()`, eager-резолв, который `usePalistor` запускает после первого коммита, один store на экземпляр компонента, вложенный `<PalistorProvider context>` управляет `contextDeps` |

В Next.js App Router клиентский компонент рендерится дважды: на сервере в HTML, затем в браузере при гидратации. Store не сериализуется, поэтому он создаётся дважды — по разу на каждый рендер — из одних и тех же props, и оба рендера должны дать одинаковую разметку. На сервере эффекты не выполняются, а store не запускает резолверы, поэтому транслятора, зарегистрированного через `useTranslator`, и строк, которые загрузил бы резолвер, в HTML нет: вместо подписей — ключи переводов, вместо списка — его скелетон. Передайте в конструктор всё, что нужно первому рендеру, — контекст, транслятор, данные — и HTML придёт полным, а гидратация пройдёт без расхождений и без повторного запроса.

Серверная страница загружает строки и передаёт их пропсами. Клиентский компонент создаёт свой store через `usePalistor` и передаёт строки в `initialData`:

```tsx
// app/[accountId]/customers/page.tsx — Server Component
import { getCustomers } from "@/data/customers";
import { CustomersView } from "./CustomersView";

export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const customers = await getCustomers(accountId); // на сервере, с cookies пользователя
  // key: другой аккаунт — другой экземпляр компонента: новый store с новыми строками
  return <CustomersView key={accountId} accountId={accountId} customers={customers} />;
}
```

```tsx
// app/[accountId]/customers/CustomersView.tsx
"use client";
import { defineList, useForm, usePalistor, type PalistorRef, type TranslateFn } from "palistor";

interface Customer { id: string; name: string }

const customersConfig = {
  search: { value: "", placeholder: (t: TranslateFn) => t("customers.search") },
  customers: defineList<Customer>({
    template: { id: { value: "" }, name: { value: "" } },
    resolve: {
      resolver: async (values, store) =>
        api.getCustomers(store.context.accountId as string, values.search),
      deps: ["search"],           // объявлено явно: до первого запуска резолвера авто-трекинг ничего не знает
    },
  }),
};

export function CustomersView({ accountId, customers }: { accountId: string; customers: Customer[] }) {
  const store = usePalistor(() => ({
    config: customersConfig,
    context: { accountId },
    initialData: { customers },   // список сразу resolved, без запроса
  }));
  const form = useForm(store);

  return (
    <>
      <input
        placeholder={form.search.placeholder}
        value={form.search.value}
        onChange={(e) => (form.search.value = e.target.value)}
      />
      <ul>{form.customers.map((c, i, id) => <CustomerRow key={id} customer={c} />)}</ul>
    </>
  );
}

// Строка читается через свой useForm: при изменении её полей перерисовывается только она.
function CustomerRow({ customer }: { customer: PalistorRef<Customer> }) {
  return <li>{useForm(customer).name.value}</li>;
}
```

Значения, общие для всех store, — контекст, транслятор, нотификатор — задаются в `<PalistorProvider>` в layout. `usePalistor` подмешивает их в конструктор каждого store ниже по дереву:

```tsx
// app/providers.tsx — клиентская обёртка, которую рендерит layout
"use client";
import { useTranslations } from "next-intl";
import { PalistorProvider } from "palistor";

const notifyError = (message: string, code?: string) =>
  addToast({ title: message, description: code, color: "danger" });

export function Providers({ account, children }: { account: Account; children: React.ReactNode }) {
  const t = useTranslations();
  return (
    <PalistorProvider context={{ account }} translator={t} notifier={notifyError}>
      {children}
    </PalistorProvider>
  );
}
```

Теперь в HTML есть и переведённый placeholder, и строки. Резолвер `customers` не вызывается ни на сервере, ни после гидратации — только при изменении `search` или по `reload()` списка.

Каждый модуль пакета с хуками начинается с `"use client"`, поэтому файл серверного компонента может импортировать `Palistor`, `defineList`, `defineFlow` и типы из `"palistor"` — например, модуль конфига, общий для страницы и клиентского компонента. Хуки приходят туда как клиентские ссылки и не выполняются.

### Один store на экземпляр компонента

Store с данными запроса создавайте внутри компонента: `usePalistor` строит его один раз на экземпляр компонента и на каждом рендере возвращает его же. Store уровня модуля живёт столько же, сколько серверный процесс, и общий для всех запросов, поэтому данные запроса в него попадать не должны. Именно поэтому `initialData` есть только у конструктора: метода, который добавил бы данные позже, нет. `usePalistor` читает `config` и `initialData` один раз: компоненту, который должен начать заново с новыми данными, нужен новый `key`.

Store уровня модуля без данных запроса продолжает работать под SSR: на сервере на него действует серверный режим. Но в браузере он не удерживается — стартует, когда загружается его модуль, ещё до гидратации, — поэтому eager-резолв или резолв активного шага может завершиться раньше гидратации, и тогда с серверным рендером расходится даже `loading`. Для разметки, которая гидратируется точно, используйте `usePalistor`.

### Один store на всё приложение

Store, общий для всего приложения, — текущий аккаунт, корзина, состояние layout, которое читают шапка и каждая страница, — создаётся так же: один раз, в клиентском компоненте, который рендерит корневой layout. Каждый запрос рендерит свой провайдер, поэтому на сервере получается один store на запрос. В браузере Next.js держит layout смонтированным, пока меняются страницы внутри него, поэтому store и всё, что пользователь в него ввёл, переживает клиентскую навигацию — как store уровня модуля.

Компоненты по-прежнему получают узлы пропсами, как в разделе [Компонент на узел](#компонент-на-узел). Новое здесь одно. Серверный компонент не может передать узел вниз: layout получает страницу как непрозрачный `children`, а узел не сериализуется. Поэтому эту границу store пересекает через ваш собственный React-контекст, и только её: первый клиентский компонент под серверным — шапка, представление страницы — читает контекст один раз, а дальше от него узлы идут пропсами.

```tsx
// app/AppStore.tsx
"use client";
import { createContext, useContext } from "react";
import { usePalistor, type Palistor } from "palistor";

export interface Account { id: string; name: string }

const appConfig = {
  account: { id: { value: "" }, name: { value: "Guest" } },
  sidebarOpen: { value: true },
};

type AppStore = Palistor<typeof appConfig>;
const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ account, children }: { account: Account | null; children: React.ReactNode }) {
  const store = usePalistor(() => ({                  // единственный вызов usePalistor для этого store
    config: appConfig,
    initialData: account ? { account } : undefined,   // данные запроса, из layout
  }));
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

/** Для входа в клиентское поддерево: компонента, который рендерит серверный компонент. */
export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("useAppStore: <AppStoreProvider> is missing above this component");
  return store;
}
```

```tsx
// app/Header.tsx — вход в клиентское поддерево: его единственное чтение контекста
"use client";
import { useForm, type FieldProxyNode } from "palistor";
import { useAppStore } from "./AppStore";

export function Header() {
  const form = useForm(useAppStore());   // передаёт узлы вниз и не читает состояние: не перерисовывается
  return <header><AccountBadge name={form.account.name} /></header>;
}

// Не знает ни про store, ни про контекст: стоит на поле, которое дал родитель.
function AccountBadge({ name }: { name: FieldProxyNode<string> }) {
  return <span>{useForm(name).value}</span>;
}
```

```tsx
// app/settings/SettingsView.tsx — вход страницы; app/settings/page.tsx рендерит <SettingsView />
"use client";
import { useForm, type FieldProxyNode, type PalistorProxy } from "palistor";
import { useAppStore, type Account } from "../AppStore";

export function SettingsView() {
  const form = useForm(useAppStore());
  return <AccountSection account={form.account} />;
}

function AccountSection({ account }: { account: PalistorProxy<Account> }) {
  const a = useForm(account);
  return <TextField field={a.name} />;   // уровень за уровнем, на любую глубину конфига
}

function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}
```

```tsx
// app/layout.tsx — Server Component
import { getAccount } from "@/data/account";
import { AppStoreProvider } from "./AppStore";
import { Header } from "./Header";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const account = await getAccount();   // на сервере; null для неавторизованного посетителя
  return (
    <html lang="en">
      <body>
        {/* key: вход или выход — другой экземпляр провайдера: новый store с новым аккаунтом */}
        <AppStoreProvider key={account?.id ?? "guest"} account={account}>
          <Header />
          {children}
        </AppStoreProvider>
      </body>
    </html>
  );
}
```

Ввод в поле настроек перерисовывает это поле и бейдж в шапке. Провайдер, `Header`, `SettingsView` и `AccountSection` не перерисовываются.

Что следует из правил выше:

- **`usePalistor` вызывается один раз, в провайдере.** Второй вызов с тем же конфигом создаёт второй store: серверный HTML по-прежнему выглядит верно, но правка в одном компоненте не доходит до другого.
- **Контекст читается один раз на клиентское поддерево, его входом.** `Header` и `SettingsView` рендерят серверные компоненты, поэтому проп до них дойти не может; каждый компонент ниже получает свой узел пропсом и вызывает на нём `useForm`. Компонент, который вместо этого берёт из контекста весь store, тоже работает, но он привязан к store этого приложения и к одному пути в нём: родитель больше не решает, какой узел он показывает, и на другом узле его не переиспользовать.
- **`initialData` читается один раз.** Layout, который может перерендериться с другим аккаунтом без загрузки страницы (вход, выход, `router.refresh()`), требует `key`, как выше. Полная загрузка страницы и так создаёт новый store.
- **Ставьте провайдер ниже `<PalistorProvider>`**, если он есть в приложении: общий store получит транслятор, нотификатор и общий контекст в конструкторе, как любой другой store.
- **Вне React этот store импортировать нельзя.** Обработчик или хелпер получает его аргументом от компонента, у которого он есть; резолвер другого store получает нужное значение ключом `context`.

Какой store создавать:

| | `new Palistor()` на уровне модуля | `usePalistor` в провайдере layout |
|---|---|---|
| Данные запроса в первом HTML | Нет: `initialData` есть только у конструктора, а модуль общий для всех запросов | Да |
| Транслятор и контекст в первом HTML | Только то, что доступно без хука | Да, из `<PalistorProvider>` |
| Старт в браузере | При загрузке модуля, до гидратации | После первого коммита провайдера |
| Доступ вне React | Да, через импорт | Нет: передавайте его аргументом |
| Как компонент получает узел | Пропсом от родителя; корень импортирует store | Пропсом от родителя; вход каждого клиентского поддерева читает контекст |

### Серверный режим

Store, созданный там, где нет `window`, работает в серверном режиме: сам он ничего не запускает. Ни eager-резолвер, ни lazy-резолвер по чтению, ни запрос страницы, ни вход в шаг флоу (`onEnter` / `onReady` не вызываются). Всё, что должно было запуститься, читается как `loading: true`, а store, созданный в браузере, вызывает каждый резолвер один раз. `useStoreContext`, `useTranslator`, `useNotifier` и `usePersist` работают через эффекты, которые сервер не выполняет, поэтому на сервере они ничего не делают.

`usePalistor` соблюдает то же правило при рендере в браузере. Он создаёт store удержанным, поэтому во время рендера ничего не запускается, а эффект вызывает `store.start()` после коммита компонента. Так что первый клиентский рендер читает то же, что читал серверный, — `loading: true`, у списка `resolveStatus: "idle"`, — и они совпадают по построению. Рендер, который React отбрасывает (переход прерван, потому что под ним изменился другой store; компонент ушёл в suspense до первого коммита), оставляет store, который ничего не запросил: запускается только store закоммиченного экземпляра. С `server: true` хук работает в ручном режиме: сам он store не запускает, `store.start()` вызываете вы. Store, созданный через `new Palistor()`, не удерживается: в браузере его запускает конструктор.

Одно следствие вне Next.js: скрипт или тест без DOM (например, в окружении `node` у Vitest) тоже оказывается в серверном режиме. Запустите store явно или отключите режим:

```typescript
const store = new Palistor({ config });                 // нет `window` → серверный режим
store.start();                                          // вход в шаг флоу, eager-резолверы, все уже прочитанные резолверы

const client = new Palistor({ config, server: false }); // или: вести себя как в браузере
```

`store.start()` идемпотентен, после него store ведёт себя как в браузере. Тестов под jsdom это не касается: `window` там есть.

### `loading` в первом рендере

```tsx
const customers = useForm(store).customers;

if (customers.loading) return <Skeleton />;
return <ul>{customers.map((c, i, id) => <CustomerRow key={id} customer={c} />)}</ul>;
```

Без `initialData` этот код отдаёт скелетон и на сервере, и в первом клиентском рендере, так что они совпадают. За этим стоит правило: резолвер, который вот-вот запустится, уже читается как `loading: true` — eager (`lazy: false`) и резолвер активного шага флоу с момента создания store, lazy — с первого чтения. Чтение `loading` группы, списка или флоу — тоже такое чтение: оно будит lazy-резолвер точно так же, как чтение `items` или поля; так же действует `isInitialLoading` списка с пагинацией. В браузере правило то же: `loading` равен `true` между первым чтением и стартом прогона. С `usePalistor` прогон стартует после первого коммита, поэтому гидратирующий рендер читает `loading: true` и `resolveStatus: "idle"` — ровно то же, что читал серверный.

Резолвер, который ждёт свои `contextDeps`, читается как `loading: false`: запускаться он пока не собирается. `loading` шага флоу не будит резолвер шага — его запускает сам флоу при входе. `resolveStatus` остаётся `"idle"`, пока прогон действительно не начался.

### `suspense: true` на сервере

Поставьте границу `<Suspense>` над компонентом, который читает узел с `suspense: true`. Без данных серверу нечего ждать, поэтому он отдаёт fallback границы, а содержимое оставляет браузеру:

```tsx
export function CarView() {
  const store = usePalistor({ config: carConfig }); // car.resolve.options.suspense: true
  return (
    <Suspense fallback={<Spinner />}>
      <CarCard store={store} /> {/* читает form.car.loading и поля — ниже границы */}
    </Suspense>
  );
}
```

На сервере чтение бросает ошибку, которую Next.js воспринимает так же, как `next/dynamic` с `ssr: false`: отдаёт fallback, ничего не пишет в лог и рендерит содержимое в браузере. Вне Next.js React тоже отдаёт fallback, но сообщает об ошибке в серверный `onError`, а при гидратации — в `onRecoverableError`, по одному разу на границу.

- **Граница обязательна** над всем, что читает узел с `suspense: true`, — как и всегда. Без неё ошибка обрывает серверный рендер.
- **Узел, который ждёт свои `contextDeps`, ошибку не бросает**: запускаться он не собирается, поэтому рендерит значения по умолчанию, без fallback.
- **В браузере первый рендер показывает значения по умолчанию.** Store из `usePalistor` удержан до коммита своего компонента, но он не в серверном режиме: бросать ему нечего — прогона ещё нет, — и серверную ошибку он тоже не бросает, поэтому узел с `suspense: true` без данных рендерит значения по умолчанию с `loading: true`. Когда store стартует, компонент, который вместе с полями узла читает и его собственный `loading`, перерендеривается и уходит в suspense: fallback границы, затем данные. Список с `suspense: true` удерживается так же: пустой первый рендер без ошибки, затем fallback, затем строки.
- **Ручной режим (`server: true`) — это серверный режим, в том числе в браузере**: вызовите `store.start()` раньше, чем что-нибудь прочитает узел с `suspense: true` без данных. До этого такое чтение бросает серверную ошибку, и в браузере React передаёт её error boundary, а не `<Suspense>`.
- **Компонент, который вызывает `usePalistor`, может читать узел сам.** В suspense он уходит уже после своего коммита, поэтому React сохраняет его состояние: один store, один запрос. Граница тогда ставится над этим компонентом.
- **Компонент, который читает только дочерние узлы, старт не перерендеривает**: он показывает значения по умолчанию, пока не придут данные, и при клиентском монтировании не показывает fallback вообще. Ниже границы читайте ещё и `loading` узла, либо ветвитесь по нему (`if (car.loading) return <Skeleton />`), либо дайте узлу `initialData`. Список перерендеривает своих читателей при старте прогона, поэтому читатель списка с `suspense: true` всегда доходит до fallback.
- **Компонент, ушедший в suspense до первого коммита по другой причине, ничего не сохраняет**, в том числе store: функция опций вызывается снова, и создаётся ещё один store. Отброшенные store ничего не запрашивают; стартует только store рендера, который закоммитился.
- **`initialData` для этого узла снимает ожидание**: содержимое уже есть в серверном HTML, и в suspense ничего не уходит.
- **Чтение одного `loading` никогда не уводит в suspense**: компонент рендерит собственный скелетон, в том числе на сервере.

### `initialData`

То, что сервер уже загрузил, передайте как `initialData` — в той же форме, что у `store.getValues()`. Ключ, которого нет в данных, не трогается, и такой узел резолвится как обычно.

```typescript
const store = new Palistor({
  config,
  initialData: {
    // группа: её значения
    profile: { name: "Ann", email: "ann@example.com" },
    // список: массив строк; вложенные списки лежат внутри своих строк
    customers: [{ id: "c1", name: "Acme", orders: [{ id: "o1", amount: 90 }] }],
    // список с пагинацией: первая страница в том виде, в каком её возвращает резолвер —
    // { items, total?, nextCursor?, hasMore? } или просто массив
    invoices: { items: firstPage, total: 240 },
  },
});
```

Узел с `resolve`, получивший данные, оказывается в том же состоянии, в каком его оставил бы резолвер, вернувший эти данные: значения, dirty-baseline (`dirty: false`; `reset()` возвращает к этим данным и ничего не запрашивает, в том числе для вложенных списков), состав списка, `resolveStatus: "resolved"`, `loading: false`. Его резолвер не вызывается ни на сервере, ни после гидратации. Единственное исключение — вложенные списки: `initialData` (как и сохранённый черновик persist) заполняет списки, вложенные в его строки, а строки, которые возвращает резолвер списка, — нет: вложенный массив в строке резолвера — не состав вложенного списка. Вложенный список заполняется собственным резолвером, через `setItems` / `add` или из `initialData`. Шаг флоу, получивший данные, при первом входе вызывает `onEnter` и сразу за ним `onReady`, без запроса; `reset()`, который захватывает флоу, возвращает его на первый шаг, и resolve шагов при входе запускается снова — с данными или без. Обоим рендерам нужны одни и те же данные; в Next.js они приходят с одними и теми же props.

`initialData` — не `initialValues`: те лишь перекрывают дефолты конфига, и узел с `resolve` после них всё равно резолвится. Данные применяются поверх `initialValues`. Собственный `resolve` группы считается выполненным, если в данных есть значение хотя бы одного листа под ней, не считая списков: `{ customers: [...] }`, список во вложенной подгруппе или пустой `{ car: {} }` не закрывают `resolve` ни группы, ни корня. Лист с вычисляемым `value` свои данные игнорирует.

Ограничения:

- **Объявляйте `deps`.** В браузере резолвер ещё не запускался, поэтому чтения, которые нашёл бы авто-трекинг, неизвестны до первого настоящего запуска. До тех пор узел перезапускается только по объявленным `resolve.deps`, при изменении ключа из `contextDeps`, при изменении фильтра списка и по `reload()` списка. У группы `reload()` нет: её перезапускают только объявленные `deps` и `contextDeps`. Если список должен перезагружаться при изменении поля — укажите это поле в `deps`. Ключ запроса списка с пагинацией строится из `deps` и фильтра (`contextDeps` он не учитывает; ключ контекста указывайте в `deps` как `"$context.accountId"`); следующая страница запрашивается как обычно. Типы resolve списка не объявляют `contextDeps`: у обычного списка в рантайме он работает, но нужно приведение типа.
- **Данные должны быть теми, которые store запросил бы прямо сейчас**: для начальных значений фильтра, первой страницы (`pagination.initialPage`) и того же контекста. Контекст должен быть в конструкторе или в провайдере: ключ из `contextDeps`, который приходит позже через `useStoreContext`, считается изменением и перезапускает резолвер сразу после гидратации. Список с пагинацией кладёт строки под текущий ключ запроса.
- **Данные встраиваются в HTML.** Пропсы клиентского компонента сериализуются в страницу — передавайте только то, что пользователю можно видеть.
- **Каждой строке нужен `id`.** Строка без него получает временный id, который на сервере и в браузере разный (предупреждение в dev: `initialData: a row of list "…" has no id`).
- **Ключи, которых нет в конфиге, игнорируются** (предупреждение в dev: `initialData: "…" is not in the config; ignored`). Ключи внутри строк не проверяются.

### Вместе с `usePersist`

`usePersist` гидратирует в эффекте, после mount, поэтому сохранённый черновик накладывается поверх серверных данных: первый рендер совпадает с серверным HTML, затем появляется черновик, и форма становится dirty относительно серверных данных. Это ожидаемый порядок.

---

## TypeScript

Значения, узлы, entity и даже переименования `fieldMapping` выводятся из конфига статически. Нестрого типизированы: `store.context` (`Record<string, unknown>`), `values` резолвера списка, двухаргументный `useForm(entity, template)` (возвращает `any`), блок фильтра и `ResolveErrorContext` (без `t`). `useForm(узел)` не компилируется для узла store, у которого `fieldMapping` переименовывает один из пропсов этого узла (для поля — любое переименование; для группы — проп, который есть и у групп, например `isRequired` или `isDisabled`), хотя и работает: вызывайте в таком компоненте `useForm(store)` и спускайтесь от корня. Члены пагинации в типе списка необязательны (`list.setPage!(2)`), а строки списка — непрозрачные `PalistorRef`, пока не пройдут через `useForm`.

**Аннотируйте колбэки конфига.** Параметры функций конфига не выводятся: в проекте со `strict` запись `(v) => v.paymentType === "card"` даёт ошибку TS7006. Аннотируйте их интерфейсом значений, как в примерах выше: `isVisible: (v: PaymentValues) => …`.

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

`PalistorProxy<T>` маппит простой интерфейс значений на дерево узлов (тип называется `PalistorProxy`, потому что имя `Palistor` занято классом store):

```tsx
import { useForm, type PalistorProxy } from "palistor";

interface UserData { name: string; email: string; address: { city: string } }

function UserForm({ user }: { user: PalistorProxy<UserData> }) {
  const u = useForm(user);
  return (
    <>
      <input value={u.name.value} onChange={(e) => (u.name.value = e.target.value)} />
      <TextField field={u.address.city} />
    </>
  );
}
```

Компонент одного поля принимает `FieldProxyNode<T>`, и `useForm` возвращает тот же узел:

```tsx
import { useForm, type FieldProxyNode } from "palistor";

function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}
```

### Типизированные ссылки на entity

```tsx
import { useForm, type PalistorRef, type PalistorList, type InferEntity } from "palistor";

interface User { id: string; name: string }

function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user);                         // типизирован: PalistorEntityProxy<User>
  const edit = useForm(user, (s) => s.editUserForm); // через шаблон: any
  return <span>{u.name.value}</span>;
}

type UserEntity = InferEntity<PalistorRef<User>>; // → User
type UsersList  = PalistorList<User>;             // типизированный узел списка
```

### Справочник типов

| Тип | Назначение |
|-----|-----------|
| `ExtractValues<TConfig>` | Тип значений, выведенный из конфига |
| `ConfigProxy<TConfig>` | Полный тип дерева узлов — то, что возвращает `useForm(store)` |
| `Palistor<TConfig, TMapping?>` | Тип экземпляра store (со `start()`) — для пропса со store |
| `ProxyStore<TConfig>` | Интерфейс store, который резолвер получает как `store` (для аннотации — `ProxyStore<any>`) |
| `PalistorProxy<T>` | Дерево узлов из простого интерфейса значений — для пропсов дочерних компонентов |
| `PalistorRef<TEntity>` | Непрозрачная ссылка на entity — для пропсов одного элемента |
| `PalistorEntityProxy<T>` | Узел одной entity, `id` строкой — то, что возвращает `useForm(ref)` |
| `PalistorList<TEntity>` / `ListProxyNode<TItem>` | Типизированный узел списка |
| `InferEntity<T>` | Извлечь тип entity из `PalistorRef` |
| `FieldProxyNode<TValue>` / `GroupProxyNode` | Узел поля / группы. `FieldProxyNode<T>` типизирует проп компонента одного поля: `useForm(field)` возвращает тот же тип |
| `ConfigNode<TValue, TValues>` / `FormConfig<TValues>` | Узел конфига; объект конфига, типизированный по интерфейсу значений |
| `FieldMapping` / `defineFieldMapping` | Карта переименования пропсов (сохраняет литералы) |
| `FlowProxyNode<S>` / `FlowStepProxy<C>` / `FlowStepsProxy<S>` / `StepStatus` | Типы узлов флоу |
| `FlowError` / `FlowValues` / `DefineFlowOptions` | Ошибки и значения флоу, опции `defineFlow` |
| `MaybeComputed<TResult, TValues>` | Константа или `(values) => T` — `isVisible`, `isRequired`, `value` |
| `MaybeTranslatable<TResult, TValues>` | Константа или `(t, values) => string` — `label`, `placeholder` |
| `DeepPartialValues<T>` | Глубокий partial значений: `initialValues`, патчи `setter`, `setValues` |
| `TranslateFn` | Совместим с next-intl `t`, i18next `t`, любым `(...args) => string` |
| `TemplateConfig<TEntity>` / `ListResolver<TEntity>` / `ListResolveContext` | Типизированный шаблон / резолвер списка / третий аргумент резолвера (`filter`, `page`, `queryKey`) |
| `FilterBlock<TEntity>` / `FilterFieldConfig<TEntity>` / `FilterProxyNode` | Блок `filter` списка, одно поле фильтра, элементы управления `list.filter` |
| `PaginationConfig` / `PageMode` / `PageRequest` / `PagedResult<T>` | Блок `pagination`, его режим, запрос `ctx.page`, то, что возвращает резолвер с пагинацией |
| `PersistDriver` / `PersistOptions` / `PersistManager` | Контракты персистенции |
| `Resolve<T>` / `ResolveStatus` / `NotifyFn` / `ResolveErrorContext` | Контракты резолверов. `Resolve<T>` объявляет `onError` обязательным. `ResolveErrorContext` объявлен как `{ notify }`, хотя `onError` получает ещё и `t`: в обычном объекте конфига аннотируйте параметр как `{ notify, t }: { notify: NotifyFn; t: TranslateFn }`; там, где resolve типизирован, приводите тип: `ctx as ResolveErrorContext & { t: TranslateFn }` |
| `InitialData<TConfig>` / `PalistorOptions<TConfig, TMapping?>` / `PalistorProviderProps` | Контракты SSR: форма `initialData` для конфига, опции конструктора, пропсы провайдера |

---

## Миграция на 0.1

0.1 заменяет движок и сохраняет язык: тот же конфиг, те же экспорты, те же имена типов, те же subpath-импорты. Код, написанный для 0.0.x, должен компилироваться и работать без изменений, кроме пунктов ниже. Пока 0.1 не вышел как `latest`, ставьте его командой `npm install palistor@cube`; диапазон `^0.0.x` сам пререлиз не подхватит.

**Может потребовать правки**

| Что изменилось | Что сделать |
|---|---|
| **Зарезервированные имена дочерних узлов.** Дочерний узел группы с именем `submitting`, `revalidate`, `values`, `submit`, `setValues` или `onValueChange` бросает ошибку в конструкторе с указанием пути; дочерний узел шаблона списка с именем `loading`, `submitting`, `submit`, `values` или `dirty` — при первом чтении строки. 0.0.x принимал такой узел, но добраться до него было нельзя. (Ключи конфига вроде `label` или `value` дочерними узлами не были и не стали.) | Переименуйте узел. |
| **Серверный режим.** Там, где нет `window` (Node, серверный рендер), store сам ничего не запускает: ни резолвер, ни запрос страницы, ни вход в шаг флоу. | Скрипт или тест без DOM вызывает `store.start()` или передаёт `server: false`. Тестов под jsdom это не касается. См. [Серверный режим](#серверный-режим). |
| **`suspense: true` на сервере.** Группа или список с `suspense: true` без данных при серверном рендере бросает ошибку отказа. (В 0.0.x lazy-узел рендерил значения по умолчанию, а eager уходил в suspense на серверном прогоне.) | Поставьте границу `<Suspense>` над читателем или дайте узлу `initialData`. См. [`suspense: true` на сервере](#suspense-true-на-сервере). |
| **`nextCursor: null` завершает ленту** в режимах `cursor` и `infinite` — даже при `total`, `hasMore: true` или полной странице. | Лента, которая продолжается по offset, не передаёт `nextCursor` вместо `null`. |
| **`dirty` списка учитывает вложенные списки.** `add` / `remove` / `setItems` во вложенном в строку списке делают грязными список строки и форму. | Код, который по `form.dirty` показывает «несохранённые изменения», теперь видит и такие правки. |
| **Полный `store.reset()` сохраняет данные строк.** Вложенные списки и поля строк, чей resolve уже отработал, возвращаются к загруженным данным и заново не запрашиваются. | Чтобы загрузить заново, вызовите `reload()` вложенного списка. |
| **`PersistManager` — только тип.** В 0.0.x `palistor/store/persist` экспортировал его как класс; `new PersistManager(…)` и `instanceof PersistManager` больше не компилируются. | Используйте `store.persist`: методы те же. |
| **Внутренностей store больше нет.** TypeScript-тип экземпляра по-прежнему перечисляет члены класса 0.0.x (`nodes`, `services`, `groupDepsMap`, `recompute()`, …); у store 0.1 ни одного из них нет. | Пользуйтесь только описанным выше API. |

**Ничего делать не нужно**

- `loading` равен `true` с первого чтения lazy-резолва (раньше — со старта прогона, микротаском позже), а чтение `loading` группы, списка или флоу — или `isInitialLoading` списка с пагинацией — будит lazy-резолв. Компонент, который рендерит спиннер по `loading`, показывает его уже в первом рендере. `resolveStatus` по-прежнему остаётся `"idle"` до старта прогона.
- `onError(error, ctx)` получает транслятор store как `ctx.t`, рядом с `ctx.notify`.
- `useForm(field)` типизирован: компонент, который получает пропсом одно поле, объявляет его как `FieldProxyNode<T>` вместо `any` (сам вызов работал всегда). См. [Компонент на узел](#компонент-на-узел).
- Список с пагинацией больше не пишет предупреждение `pagination invariant … has no cached page` при смене ключа запроса.
- Новое: `usePalistor`, `<PalistorProvider>`, `usePalistorContext`, опции конструктора `translator`, `notifier`, `initialData` и `server`, `store.start()` — см. [SSR и Next.js](#ssr-и-nextjs). И пять [скиллов для агентов](#скиллы-для-агентов) в пакете.
- С раннего пререлиза 0.1 (`0.1.0-cube.1`): store из `usePalistor` стартует после первого коммита, а не в конструкторе; в первом рендере eager-список читает `resolveStatus: "idle"` (было `"pending"`), а eager-группа с `suspense: true` показывает значения по умолчанию, а не fallback.

**Исправлено в 0.1**

- Поле, которое читает резолвер, перезапускает его при каждом изменении; в 0.0.x резолвер замолкал после 10 изменений (резолверы групп и полей, списки с пагинацией, серверные поля фильтра).
- `loading` группы остаётся `true`, пока выполняется её resolve, и тогда, когда у группы есть вычисляемый ключ (`label`, `isVisible`, …).
- Успешный submit очищает сохранённый черновик окончательно (в 0.0.x следующее уведомление записывало его обратно); ошибка переполнения квоты у встроенных драйверов доходит до `onError`.
- В `store.proxy.values` нет ключа фильтра.

---

## Лицензия

[MIT](./LICENSE) © Yuri Palienko
