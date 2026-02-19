# Proxy-Based Reactive Architecture

## Проблема с текущим подходом

```tsx
// ❌ Нужно вручную описывать selector
const number = useSelector(store, s => s.values.passport.number);

// ❌ Зависимости нужно указывать явно, легко забыть
cardNumber: {
  isVisible: (v) => v.paymentType === "card",
  dependencies: ["paymentType"],
}
```

## Что хотим

```tsx
// ✅ Подписка на всю сущность по ID
const user = useForm(user_id);


// Далее мы передаем ссылку в компонент

<Component passport={user.passport}>

// В компоненте

const { passport } = props

// дальше

<Number number={passport.number}>


// ✅ Любая глубина вложенности

// ✅ Зависимости для вычисляемых полей — автоматически
cardNumber: {
  isVisible: (v) => v.paymentType === "card",
  // dependencies не нужны — прокси сам отследил доступ к v.paymentType
}
```

## Как это работает

### `useForm(id)` → TrackingProxy

```ts
function useForm<T>(id: string): T {
  const store = getStoreById(id);
  const trackedPaths = useRef(new Set<string>());

  return useSyncExternalStore(
    (notify) => store.subscribe(() => {
      // ре-рендер только если изменился хотя бы один из прочитанных путей
      if (hasAnyPathChanged(store, trackedPaths.current)) notify();
    }),
    () => makeTrackingProxy(store.getState(), trackedPaths.current)
  );
}
```

### TrackingProxy

Рекурсивный `Proxy`, который при каждом `get` записывает путь в `Set`:

```ts
// доступ к passport.number → записывает "passport.number"
// доступ к user.passport   → записывает "passport" и возвращает новый прокси
```

Сравнение при обновлении store: `prev[path] === next[path]` для каждого записанного пути.

### Автодепенденсии в compute

Те же `TrackingProxy`-обёртки используются при вызове `isVisible(v)` / `compute(v)`:

```ts
const deps = new Set<string>();
const proxy = makeTrackingProxy(values, deps);
fn(proxy); // ← записываем что было прочитано
// deps теперь содержит реальные зависимости
```

Пересчёт — только когда изменился хотя бы один путь из `deps`.

## Что даёт

| Сейчас | С прокси |
|---|---|
| `useSelector(store, s => s.values.x)` | `const f = useForm(id); f.values.x` |
| `dependencies: ["paymentType"]` | не нужны |
| Ручной `shallowEqual` при выборке объекта | прокси сам знает какие поля читались |
