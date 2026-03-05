# Система резольверов

## Решения (финализировано)

- Resolve сетит **своё поддерево** (дочерние поля и их потомки).
- Для побочных эффектов вверх (флаги и т.д.) — присваивание через `values` внутри resolver (batch-режим, без промежуточных ре-рендеров).
- Триггер lazy-резольвера: первый GET на групповой узел через Store Proxy.
- `loading` — свойство `FieldState` группового узла (доступно как `form.car.loading`).
- Опционально: `suspense: true` → proxy бросает Promise → нативный React Suspense (только для loading, ошибки ВСЕГДА реактивно через `error`/`errorMessage`).
- **Зависимости:** двойной механизм — опциональный `deps: string[]` (явные пути) + auto-deps через tracking proxy (собираются после первого запуска). Merge.
- **Retry:** встроенный retry через `options.retry: { attempts, delay }`.
- **Приоритет вложенных resolve:** родитель перезатирает потомков (атомарность модулей). Потомок перезапустится по deps/auto-deps.
- **Batch-режим:** побочные эффекты (запись в values) буферизуются, применяются одним flush после завершения resolver.
- **Обработка ошибок:** `onError(error, { notify })` callback из конфига. `notify` — функция уведомления, зарегистрированная через `useNotifier` (по аналогии с `useTranslator`). Ошибка также реактивно доступна через `error`/`errorMessage` на групповом узле. Никакого throw Error.

---

## 1. Тип Resolve

```ts
interface Resolve<T = Record<string, unknown>> {
  /**
   * Async загрузка данных.
   * `values` — tracking write-proxy:
   *   - Чтение: отслеживает зависимости (auto-deps)
   *   - Запись: буферизует побочные эффекты (batch)
   * Возвращает объект с значениями для СВОЕГО поддерева.
   */
  resolver: (values: AllValues) => Promise<T>;

  /**
   * Синхронная заглушка — сетится мгновенно до завершения resolver.
   * Структура аналогична resolver.
   */
  optimisticResolver?: (values: AllValues) => Partial<T>;

  /**
   * Обработчик ошибки resolver'а (вызывается после исчерпания retry).
   * `ctx.notify` — функция уведомления, зарегистрированная через useNotifier
   * (аналог useTranslator). Гарантированно существует (noop по умолчанию).
   */
  onError: (error: unknown, ctx: ResolveErrorContext) => void;

  /**
   * Явные зависимости — пути в values-дереве.
   * При изменении любого из этих путей → перезапуск resolver.
   * Имеют приоритет для первого запуска (auto-deps ещё не собраны).
   * После первого запуска merge с auto-deps.
   */
  deps?: string[];

  options?: {
    /** Ждать первого обращения к узлу. Default: true */
    lazy?: boolean;
    /** Бросить Promise для React Suspense (только loading). Default: false */
    suspense?: boolean;
    /** Повторные попытки при ошибке */
    retry?: {
      attempts: number;  // default: 0 (без повторов)
      delay: number;     // default: 1000 ms
    };
  };
}
```

**Контекст ошибки:**

```ts
interface ResolveErrorContext {
  /** Функция уведомления, зарегистрированная через useNotifier. Гарантированно существует (noop по умолчанию). */
  notify: NotifyFn;
}

/** Тип функции уведомления. Пользователь определяет сигнатуру. */
type NotifyFn = (...args: any[]) => void;
```

## 1.1. useNotifier — регистрация функции уведомления

По аналогии с `useTranslator` — один вызов в layout/провайдере.
Регистрирует React-aware функцию в store, которая потом доступна
в `onError` через `ctx.notify`.

```tsx
import { useTranslations } from 'next-intl';
import { useNotifier } from '@palistor/react/useNotifier';
import { useTranslator } from '@palistor/react/useTranslator';
import { paymentStore } from './config/paymentForm';

function Layout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const tErrors = useTranslations('Errors');

  // Регистрируем translator (уже есть)
  useTranslator(paymentStore, t);

  // Регистрируем notifier — React-aware функция уведомления
  const notifyError = useCallback((error: any, code?: string) => {
    const knownErrors = Object.keys(Errors.Errors);
    if (error?.code && knownErrors.includes(error.code)) {
      addToast({ title: tErrors(error.code), color: 'danger' });
    } else {
      addToast({ title: code ? tErrors(code) : tErrors('UNKNOWN_ERROR'), color: 'danger' });
    }
  }, [tErrors]);

  useNotifier(paymentStore, notifyError);

  return <>{children}</>;
}
```

**В конфиге — чистый `onError` без React-зависимостей:**

```ts
car: {
  resolve: {
    resolver: async (values) => fetchCar(values.user.id),
    onError: (error, { notify }) => {
      // notify — это notifyError из useNotifier, с доступом к toast/i18n
      notify?.(error, 'CAR_LOAD_FAILED');
    },
  },
  brand: { value: '' },
}
```

**Реализация `useNotifier`:**

```ts
// react/useNotifier.ts
import { useEffect } from 'react';
import type { ProxyStore } from '../store/store';
import type { NotifyFn } from '../store/resolvePipeline';

export function useNotifier<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  notifier: NotifyFn,
): void {
  useEffect(() => {
    store.setNotifier(notifier);
    return () => { store.setNotifier(null); };
  }, [store, notifier]);
}
```

## 2. Фрагмент конфига

```ts
type ConfigNode = {
  resolve?: Resolve;
  // loading появляется автоматически в FieldState группового узла,
  // если у узла есть resolve. Не задаётся в конфиге.
}
```

## 3. Ленивость (lazy)

Резольверы ленивые по умолчанию (`lazy: true`). Триггер запуска — **первое обращение
к групповому узлу** через Store Proxy (GET trap в `buildProxy.ts`).

Если `lazy: false` — resolver запускается сразу при создании store.

## 4. Loading

`loading` — часть `FieldState` группового узла. Появляется автоматически
при наличии `resolve`. Доступен через proxy:

```ts
const form = useForm(store);
form.car.loading  // true пока resolver не завершится
```

## 5. Suspense (опционально)

Если `options.suspense: true`, Store Proxy **бросает Promise** при GET на незагруженный
узел (только loading-состояние). React Suspense подхватывает:

```tsx
<Suspense fallback={<Spinner />}>
  <CarForm />
</Suspense>
```

Без `suspense: true` — компонент рендерится сразу, `loading: true`, поля пустые.

**Ошибки НЕ бросаются** через throw Error (ни в suspense, ни без него).
Ошибки всегда реактивно доступны через `form.car.error` / `form.car.errorMessage`.
`onError` из конфига решает, что записать в эти поля.

## 6. Скоуп resolver'а

Возвращаемый объект сетит **только своё поддерево** — дочерние поля и их потомков:

```ts
car: {
  resolve: {
    resolver: async (values) => {
      const car = await fetchCar(values.user.id);

      // ← Побочный эффект вверх: присваивание через values
      values.user.vehicleExists = true;

      // ← Возвращает только своё поддерево
      return {
        brand: car.brand,
        model: car.model,
        document: {
          series: car.doc.series,
          number: car.doc.number,
        },
      };
    },
    onError: (err) => console.error("Car load failed", err),
  },
  brand: { value: "" },
  model: { value: "" },
  document: {
    series: { value: "" },
    number: { value: "" },
  },
}
```

Родительский resolve **перезатирает** данные дочернего resolve — это нормальное поведение.
Даёт атомарность модулей: можно изъять модуль из дерева или вложить обратно, и всё будет работать.

## 7. Обработка ошибок

Если `resolver` выбросил ошибку (после исчерпания retry):

1. `loading` → `false`
2. Вызывается `onError(error, { notify })` из конфига
   - `notify` — функция уведомления из `useNotifier` (имеет доступ к React-контексту: toast, i18n)
   - Если notifier не зарегистрирован — `notify === null`
3. `onError` управляет ошибкой: вызывает `notify()` для toast,
   может записать `errorMessage` через `values`, залогировать и т.д.
4. Ошибка **реактивно доступна** в React через `form.car.error` / `form.car.errorMessage`
   (обычный proxy GET → tracking → re-render)
5. Никакого `throw Error` — ни в suspense-режиме, ни без него.
   Suspense бросает только Promise (loading), не Error.

**Пример:**
```ts
// Конфиг (чистый, без React-зависимостей)
car: {
  resolve: {
    resolver: async (values) => fetchCar(values.user.id),
    onError: (err, { notify }) => {
      // notify — это notifyError из useNotifier, с доступом к toast/i18n
      notify?.(err, 'CAR_LOAD_FAILED');
      console.error('Car load failed', err);
    },
  },
  brand: { value: '' },
}

// Layout (регистрация notifier)
function Layout({ children }) {
  const tErrors = useTranslations('Errors');
  const notifyError = useCallback((error, code) => {
    addToast({
      title: error?.code ? tErrors(error.code) : tErrors(code ?? 'UNKNOWN_ERROR'),
      color: 'danger',
    });
  }, [tErrors]);

  useNotifier(store, notifyError);  // аналог useTranslator
  return <>{children}</>;
}

// Компонент (реактивная ошибка через proxy)
function CarForm() {
  const car = useForm(form.car);
  if (car.error) return <Alert>{car.errorMessage}</Alert>;
  // ...
}
```

## 8. Pipeline загрузки

```
Компонент обращается к form.car.brand
              │
              ▼
   Store Proxy GET "car" (buildProxy.ts)
   Узел имеет resolve? → ДА
   Уже resolved? → НЕТ
              │
    ┌─────────┴───────────────┐
    ▼                         ▼
optimisticResolver          resolver (async)
  │                            │
  ▼                         ┌──┴──────────────────┐
applyPatch               OK │                     │ FAIL
loading: true               ▼                     ▼
nodeState updated      batch flush:             onError(err)
recomputeAll             applyPatch(result)     loading: false
notifyChanged            applyPatch(buffered    error на узле
                           side-effects)        recomputeAll
                         loading: false         notifyChanged
                         recomputeAll (1 раз)
                         notifyChanged (1 раз)
```

## 9. Решения по открытым вопросам (финализировано)

### 9.1. Автоматический сбор зависимостей — ДА, реализуем сразу

Оборачиваем `values` внутри resolver'а в tracking proxy (тот же принцип что уже
есть для компонентов в `createTrackingProxy.ts`), записываем к каким путям
resolver обратился. При изменении этих путей — перезапуск resolver'а.

**Реализация:** Создаём `createValuesTrackingProxy(values)` → возвращает
`{ proxy, getAccessedPaths() }`. Proxy рекурсивный: при чтении вложенных
объектов возвращает тоже proxy, при чтении примитива — записывает полный путь.
Resolver получает этот proxy вместо сырых values. После первого выполнения
resolver'а — сохраняем `accessedPaths`. Подписываемся на изменения этих узлов
через существующий `subscribe`. При изменении — перезапуск.

**Явные `deps` + auto-deps:** Оба механизма работают вместе:
- `deps: string[]` (опциональный) — явный список путей. Работает **сразу**, до первого запуска.
  Если задан — перезапуск resolver'а при изменении этих путей.
- Auto-deps — собираются tracking proxy **после первого запуска**.
  Merge с явными deps. Итоговый набор зависимостей = `deps ∪ accessedPaths`.
- Если `deps` не задан — resolver запускается один раз (lazy/eager), потом
  перезапускается только по auto-deps.
- Если разработчик хочет отключить auto-deps перезапуск для определённых путей —
  это контролируется через `deps` (задаёт только нужные пути).

Отличие от tracking proxy компонентов: здесь мы отслеживаем не config-ноды,
а paths в values-дереве (строки вроде `"user.id"`, `"payment.amount"`).

### 9.2. Retry — ДА, через `options.retry`

```ts
options?: {
  lazy?: boolean;       // default: true
  suspense?: boolean;   // default: false
  retry?: {
    attempts: number;   // default: 0 (без повторов)
    delay: number;      // default: 1000 ms
  } 
};
```

Логика: при ошибке resolver'а — повторяем до `retry.attempts` раз с задержкой `retry.delay`.
Если все попытки исчерпаны — стандартный flow ошибки (onError, error на узле).
`loading` остаётся `true` на протяжении всех попыток.

### 9.3. Приоритет вложенных resolve — родитель перезатирает

Родительский resolve **перезатирает** данные потомков, даже если у потомка свой resolve.
Это обеспечивает атомарность модулей — можно изъять модуль из дерева или вложить
обратно, и он будет работать. При необходимости потомок перезапустит свой resolve
через deps/auto-deps (если зависимости изменились).

**Примечание:** auto-deps собираются только после первого запуска resolver'а.
Для случаев когда перезапуск нужен **до** первого запуска (например, родитель
перезатёр данные и нужно заново загрузить) — используется явный `deps: string[]`.
Это гарантирует, что потомок сможет перезапуститься по известным путям.

### 9.4. Побочные эффекты — batch-режим

Во время выполнения resolver'а `values` — это write-proxy. Присваивания
`values.user.flag = true` **не применяются мгновенно**, а накапливаются в буфер
(`pendingWrites: Array<{path, value}>`).

После завершения resolver'а — один flush цикл:
1. `applyPatch(resolverResult)` — результат resolver'а в поддерево
2. `applyPatch(bufferedWrites)` — все побочные эффекты
3. `loading: false`
4. `recomputeAll()` — один раз
5. `notifyChanged()` — один раз

Это гарантирует: React получает все изменения одним batched update,
никаких промежуточных ре-рендеров.

---

## 10. Финальный тип Resolve (обновлённый)

Совпадает с определением в секции 1. Полная версия для справки:

```ts
interface Resolve<T = Record<string, unknown>> {
  resolver: (values: AllValues) => Promise<T>;
  optimisticResolver?: (values: AllValues) => Partial<T>;
  onError: (error: unknown, ctx: ResolveErrorContext) => void;
  deps?: string[];
  options?: {
    lazy?: boolean;       // default: true
    suspense?: boolean;   // default: false (только loading, без throw Error)
    retry?: {
      attempts: number;   // default: 0
      delay: number;      // default: 1000 ms
    };
  };
}

interface ResolveErrorContext {
  notify: NotifyFn | null;
}
type NotifyFn = (...args: any[]) => void;
```

## 11. Состояние resolver'а (ResolveState)

Для каждого узла с `resolve` хранится в `WeakMap<object, ResolveState>`:

```ts
type ResolveStatus = "idle" | "pending" | "resolved" | "error";

interface ResolveState {
  status: ResolveStatus;
  /** Текущий промис (для suspense и дедупликации) */
  promise: Promise<unknown> | null;
  /** Последняя ошибка */
  error: unknown | null;
  /** Пути в values, от которых зависит resolver (auto-deps) */
  dependencies: Set<string>;
  /** Номер текущей попытки (для retry) */
  attempt: number;
}
```

## 12. Изменения в существующих файлах

### constants.ts
- Добавить `"resolve"` в `CONFIG_PROPS` (чтобы пропускался при обходе дерева)
- Добавить `"loading"` в `FIELD_STATE_PROPS` (чтобы был доступен через proxy)

### compute.ts → FieldState
- Добавить `loading?: boolean` — для групповых узлов с resolve
- **Без** отдельного `resolveError` — ошибки resolver'а идут через существующие `error`/`errorMessage` (устанавливаются `onError`)

### buildProxy.ts → GET trap
- Для группового узла с `resolve`: проверить ResolveState
- Если `idle` + `lazy` → запустить resolve (trigger)
- Если `pending` + `suspense` → throw promise
- Добавить доступ к `loading` через proxy

### store.ts
- Создать `resolveState: WeakMap<object, ResolveState>`
- При init: найти все узлы с resolve, инициализировать ResolveState
- Для `lazy: false` — запустить resolve сразу
- Подключить auto-deps: при изменении зависимостей → перезапуск
- Передать resolve-зависимости в `createBuildProxy`
- `setNotifier(fn)` / `getNotifier()` в публичном API
- Передать стабильную функцию `notify` в resolve pipeline

### ConfigNode (store.ts)
- Добавить `resolve?: Resolve` в тип ConfigNode

### ProxyStore (store.ts)
- Добавить `setNotifier(fn: NotifyFn | null)` / `getNotifier()` в публичный API

### Новые файлы
- `react/useNotifier.ts` — хук регистрации notifier (аналог `useTranslator.ts`)
- `store/createValuesTrackingProxy.ts` — tracking write-proxy для resolver
- `store/resolvePipeline.ts` — ядро resolve pipeline

---

## 13. План реализации (пошаговый)

### Фаза 1: Типы и константы

**Шаг 1.1** — Расширить `FieldState` в `compute.ts`:
- Добавить `loading?: boolean`
- Добавить `loading` в `fieldStateChanged()`

**Шаг 1.2** — Расширить `constants.ts`:
- `CONFIG_PROPS` ← `"resolve"`
- `FIELD_STATE_PROPS` ← `"loading"`

**Шаг 1.3** — Расширить `ConfigNode` в `store.ts`:
- Добавить `resolve?: Resolve` в интерфейс ConfigNode (включая `deps?: string[]`)
- Добавить `"resolve"` в `ConfigSkipKeys`
- Добавить `"deps"` в `ConfigSkipKeys` и `CONFIG_PROPS`
- Добавить `loading` в `GroupProxyNode`
- Добавить `Resolve`, `ResolveErrorContext`, `NotifyFn` типы
- Добавить `setNotifier`/`getNotifier` в `ProxyStore` (гарантированно не-null)

**Шаг 1.4** — Создать `react/useNotifier.ts`:
- По аналогии с `useTranslator.ts`
- `useEffect` → `store.setNotifier(notifier)` / cleanup → `store.setNotifier(null)`

---

### Фаза 2: Ядро resolver pipeline

**Шаг 2.1** — Создать `store/createValuesTrackingProxy.ts`:
- `createValuesTrackingProxy(values)` → `{ proxy, accessedPaths }`
- Рекурсивный Proxy: при чтении примитива — записываем полный path
- При записи — буферизуем в `pendingWrites[]`
- Экспорт: `{ proxy, getAccessedPaths(), getPendingWrites(), flush() }`

**Шаг 2.2** — Создать `store/resolvePipeline.ts`:
- `ResolveState` тип + `ResolveStatus`
- `initResolveStates(rootConfig)` — рекурсивный обход, поиск `resolve` в конфиге
- `executeResolve(node, deps)` — основная функция:
  1. Получить status → если `pending`, вернуть текущий promise (дедупликация)
  2. `status = "pending"`, `loading = true`
  3. Если есть `optimisticResolver` → выполнить, `applyPatch` (без notify, batch)
  4. Обернуть values в tracking write-proxy
  5. Вызвать `resolver(trackedValues)`
  6. Retry-логика: при ошибке → повторить до `retry` раз
  7. При успехе:
     - `applyPatch(result)` в поддерево узла
     - flush buffered writes (побочные эффекты)
     - `loading = false`, `status = "resolved"`
     - `recomputeAll()` (один раз)
     - `notifyChanged()` (один раз)
  8. При ошибке (после всех retry):
     - `onError(error, { notify })` ← пользователь вызывает `notify()` для toast
     - `loading = false`, `status = "error"`
     - `recomputeAll()` + `notifyChanged()`
  9. Сохранить `accessedPaths` для auto-deps

**Шаг 2.3** — Тесты для `resolvePipeline.ts`:
- Успешный resolve → applyPatch + loading lifecycle
- Ошибка → onError + error на узле
- Retry: 3 попытки, потом ошибка
- Дедупликация: повторный вызов во время pending → тот же promise
- Batch: побочные эффекты не вызывают промежуточных notify
- optimisticResolver → мгновенное обновление

---

### Фаза 3: Интеграция с buildProxy и store

**Шаг 3.1** — Расширить `BuildProxyDeps` в `buildProxy.ts`:
- Добавить `triggerResolve: (node) => void`
- Добавить `getResolveState: (node) => ResolveState | undefined`

**Шаг 3.2** — Модифицировать GET trap в `buildProxy.ts`:
- Для группового узла: перед возвратом дочернего proxy —
  проверить `resolve` + `ResolveState`
- Если `idle` → вызвать `triggerResolve(node)` (fire-and-forget)
- Если `pending` + `suspense: true` → `throw resolveState.promise`
- `key === "loading"` → вернуть `nodeState.get(node)?.loading ?? false`

**Шаг 3.3** — Расширить `store.ts`:
- Создать `resolveStates: WeakMap<object, ResolveState>`
- В init: `initResolveStates(rootConfig, resolveStates)`
- Создать `triggerResolve(node)` и `getResolveState(node)`
- Для eager resolvers (lazy: false): запустить все при init
- Передать в `createBuildProxy`: `triggerResolve`, `getResolveState`

---

### Фаза 4: Auto-deps (перезапуск при изменении зависимостей)

**Шаг 4.1** — В `resolvePipeline.ts`:
- После `executeResolve`: сохранить `accessedPaths` в `ResolveState.dependencies`
- Экспортировать `getResolveDependencies(node)`

**Шаг 4.2** — В `store.ts`:
- После `notifyChanged`: проверить все resolve-узлы
- Для каждого resolved-узла: если изменился узел, путь которого
  входит в `dependencies` → сбросить status в `idle`
- Если узел lazy и уже был прочитан (status был `resolved`) → перезапустить
- Требует маппинг `path → config node` (обратный nodePaths)

**Шаг 4.3** — Явные deps:
- При init: если `resolve.deps` задан → подписаться на эти пути сразу
- При изменении deps-пути → сброс status в `idle`, перезапуск
- Merge: итоговые deps = `resolve.deps ∪ accessedPaths` (после первого запуска)

**Шаг 4.4** — Тесты:
- Resolver с `deps: ["user.id"]`. Изменяем `user.id` → resolver перезапускается
- Resolver без deps. Изменяем что-то → resolver НЕ перезапускается (до первого запуска)
- Resolver без deps, после первого запуска: auto-deps собраны, изменяем зависимость → перезапуск
- Auto-deps: читает `values.user.id` внутри → после resolve, изменяем `user.id` → перезапуск
- Auto-deps: НЕ читает `values.user.name` → изменяем `user.name` → БЕЗ перезапуска

---

### Фаза 5: Suspense

**Шаг 5.1** — В `buildProxy.ts`:
- Если `suspense: true` и `status === "pending"` → `throw resolveState.promise`
- Promise резолвится когда resolver завершится → React Suspense retry рендер

**Шаг 5.2** — Тесты:
- Suspense: компонент в Suspense, resolver pending → fallback, resolve → content
- Ошибка при suspense: resolver fails → onError вызван, error/errorMessage реактивно обновлены, компонент рендерит ошибку (без throw Error)

---

### Фаза 6: Финализация

**Шаг 6.1** — E2E тест с демо-конфигом:
- Конфиг с lazy resolver, auto-deps, побочными эффектами
- Полный цикл: mount → lazy trigger → loading → resolve → deps change → re-resolve

**Шаг 6.2** — Расширить `computeProxyKeys` в `buildProxy.ts`:
- Для групповых узлов с resolve: добавить `"loading"` в ownKeys

**Шаг 6.3** — Документация обновления README / architecture.md
