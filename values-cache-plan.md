# valuesCache — постоянно-актуальный кеш значений

> **Статус: реализовано.** `collectValues` удалена. Все вызовы заменены на `valuesCache.values`.

## Предпосылки

`collectValues(rootConfig, nodeState)` рекурсивно обходила дерево конфига при **каждом** вызове
и собирала `{ key: nodeState.get(child).value }`. Вызывалась в 6 местах:

| # | Файл | Контекст |
|---|------|----------|
| 1 | `recomputeAll.ts` | Каждый computed-узел — внутри цикла |
| 2 | `recomputeAll.ts` | Фаза 2 — snapshot перед валидацией |
| 3 | `writePipeline.ts` | `formatValue` — formatter нуждается в allValues |
| 4 | `writePipeline.ts` | `runSetter` — setter получает allValues |
| 5 | `onChangePipeline.ts` | `fireOnChange` — onChange получает allValues |
| 6 | `buildProxy.ts` | `translatableHandler` — label/placeholder/description функции |
| 7 | `store.ts` | `getValues()` — публичный API + persist auto-save |
| 8 | `submitPipeline.ts` | `executeSubmit` — значения для onSubmit callback |

При форме из 50 полей — 50 итераций × N вызовов за один SET = сотни лишних обходов.

## Решение: `valuesCache` — вложенный объект, всегда актуальный

Вместо сбора значений "по запросу" — держим объект `Record<string, unknown>` (вложенный, повторяет структуру конфига), который **обновляется при каждой записи value**.

### Ключевое наблюдение

Значения value меняются **только в 4 точках**:

1. **`registerNodes`** — инициализация `nodeState.set(child, { value: initialValue })`
2. **`applyPatch`** — `nodeState.set(child, { ...state, value: patchValue })`
3. **`storeValue`** (writePipeline) — `nodeState.set(node, { ...state, value: processedValue })`
4. **`recomputeAll`** (recomputeLeaves, фаза 1) — `nodeState.set(node, { ...state, value: computedValue })`
**Все** эти точки можно перехватить, записывая параллельно в `valuesCache`. - да, я думаю можно одну функцию сеттер иметь которая будет параллелить всю запись.

---

## Архитектура

### Новый модуль: `store/valuesCache.ts`

```ts
export interface ValuesCache {
  /** Корневой объект значений — всегда актуальный, мутабельный */
  values: Record<string, unknown>;
  /** Маппинг config-node → { parent: Record, key: string } для O(1) обновления */
  nodeSlot: WeakMap<object, { parent: Record<string, unknown>; key: string }>;
}
```

### Инициализация (фаза 0 — после registerNodes)

Один проход по дереву конфига, параллельно с `registerNodes` или сразу после.
Для каждого узла:
- Групповой → создаём вложенный `{}`, записываем в parent
- Листовой → записываем `nodeState.get(child).value` в parent, сохраняем слот в `nodeSlot`

```ts
export function buildValuesCache(
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
): ValuesCache {
  const values: Record<string, unknown> = {};
  const nodeSlot = new WeakMap<object, { parent: Record<string, unknown>; key: string }>();
  
  function walk(node: AnyConfigNode, target: Record<string, unknown>) {
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;
      
      if ("value" in child) {
        target[key] = nodeState.get(child)?.value ?? "";
        nodeSlot.set(child, { parent: target, key });
      } else {
        const group: Record<string, unknown> = {};
        target[key] = group;
        walk(child, group);
      }
    }
  }
  
  walk(rootConfig, values);
  return { values, nodeSlot };
}
```

### Обновление — O(1) на каждую запись

```ts
export function updateValuesCacheEntry(
  cache: ValuesCache,
  node: object,
  newValue: unknown,
): void {
  const slot = cache.nodeSlot.get(node);
  if (slot) slot.parent[slot.key] = newValue;
}
```

---

## План миграции (по шагам)

### Шаг 1: Создать `store/valuesCache.ts`

- `buildValuesCache(rootConfig, nodeState)` → `ValuesCache`
- `updateValuesCacheEntry(cache, node, newValue)` → `void`
- Экспортировать `AnyConfigNode` отсюда (или оставить в collectValues.ts до удаления)

### Шаг 2: Инициализировать кеш в `store.ts`

```ts
// После registerNodes и initGroupSubmitting:
const valuesCache = buildValuesCache(rootConfig, nodeState);
```

`getValues()` меняется с `collectValues(rootConfig, nodeState)` на `valuesCache.values`.

### Шаг 3: Обновлять кеш при записи значений

#### 3a. `storeValue` (writePipeline.ts)

Добавить `valuesCache` в `WriteDeps`. После `nodeState.set(node, ...)`:

```ts
updateValuesCacheEntry(valuesCache, node, processedValue);
```

#### 3b. `applyPatch` (applyPatch.ts)

Добавить `valuesCache` параметром. После `nodeState.set(child, ...)`:

```ts
updateValuesCacheEntry(valuesCache, child, patchValue);
```

#### 3c. `recomputeLeaves` фаза 1 (recomputeAll.ts)

После `nodeState.set(node, { ...state, value: computedValue })`:

```ts
updateValuesCacheEntry(valuesCache, node, computedValue);
```

#### 3d. `registerNodes` (registerNodes.ts)

Не трогаем — `buildValuesCache` вызывается **после** `registerNodes`, читает уже готовые значения из `nodeState`.

### Шаг 4: Заменить все `collectValues()` вызовы на чтение кеша

| Файл | Было | Станет |
|------|------|--------|
| `recomputeAll.ts:167` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `recomputeAll.ts:180` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `writePipeline.ts:47` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `writePipeline.ts:130` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `onChangePipeline.ts:65` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `buildProxy.ts:122` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `store.ts:268` | `collectValues(rootConfig, nodeState)` | `valuesCache.values` |
| `submitPipeline.ts:130` | `collectValues(groupNode, nodeState)` | **Особый случай** (см. ниже) |

### Шаг 5: submitPipeline — особый случай

`executeSubmit` вызывает `collectValues(groupNode, nodeState)` — не root, а **поддерево**.
Это нужно для `onSubmit(values)` — передаются только значения группы.

**Решение:** вместо `collectValues(groupNode, ...)` — читаем нужный под-объект из `valuesCache.values` по пути группы. Группа `passport` → `valuesCache.values.passport`. Для `rootConfig` → `valuesCache.values`.

Это можно реализовать утилитой:

```ts
function getSubValues(values: Record<string, unknown>, node: AnyConfigNode, rootConfig: AnyConfigNode, nodePaths: WeakMap<object, string>): Record<string, unknown> {
  if (node === rootConfig) return values;
  const path = nodePaths.get(node);
  if (!path) return values;
  let current: any = values;
  for (const segment of path.split('.')) {
    current = current?.[segment];
  }
  return current as Record<string, unknown> ?? {};
}
```

Либо проще: в `submitPipeline` передавать `valuesCache.values` и `nodePaths`, а не `rootConfig`.

### Шаг 6: Прокинуть `valuesCache` через deps

Файлы, которым нужен `valuesCache`:

| Структура | Что добавить |
|-----------|-------------|
| `WriteDeps` | `+ valuesCache: ValuesCache` |
| `OnChangeDeps` | `+ valuesCache: ValuesCache` |
| `BuildProxyDeps` | `+ valuesCache: ValuesCache` |
| `SubmitDeps` | `+ valuesCache: ValuesCache` + `nodePaths: WeakMap` |
| `recomputeLeaves` аргументы | `+ valuesCache: ValuesCache` |
| `RecomputeTargetedDeps` | `+ valuesCache: ValuesCache` |

### Шаг 7: tracking-обёртка в recomputeAll

Сейчас `trackingWrap(node, rawValues)` оборачивает `rawValues` в tracking-proxy для построения карты зависимостей групп:

```ts
const rawValues = collectValues(rootConfig, nodeState);
const currentValues = trackingWrap ? trackingWrap(node, rawValues) : rawValues;
```

С кешем:

```ts
const currentValues = trackingWrap ? trackingWrap(node, valuesCache.values) : valuesCache.values;
```

Tracking-proxy (`createTrackingValues`) работает по Proxy-перехвату GET — ему всё равно, мутабельный объект или нет. **Но** tracking-proxy кеширует обёртки, и если `valuesCache.values` — один и тот же объект, кеши останутся валидными.

### Шаг 8: Удалить `collectValues` функцию

- Удалить экспорт `collectValues` из `collectValues.ts`
- Оставить `AnyConfigNode` (используется везде) — **переименовать файл** в `types.ts` или оставить
- Либо перенести `AnyConfigNode` в `types.ts`, а `collectValues.ts` — удалить

**Рекомендация:** оставить файл `collectValues.ts` с типом `AnyConfigNode`, удалить только функцию. Переименовывать файл — слишком много изменений в импортах.

### Шаг 9: Тесты

- Обновить `collectValues.test.ts` → тестировать `buildValuesCache` + `updateValuesCacheEntry`
- `writePipeline.test.ts` — добавить `valuesCache` в deps
- `applyPatch.test.ts` — добавить `valuesCache` параметр
- `store.test.ts` — всё должно продолжать работать через публичный API

---

## Консистентность — почему это 100% безопасно

1. **registerNodes** записывает `nodeState.set(child, { value })` → `buildValuesCache` читает после и строит кеш.
2. **storeValue** → `nodeState.set` + `updateValuesCacheEntry` — атомарно в одной функции.
3. **applyPatch** → `nodeState.set` + `updateValuesCacheEntry` — атомарно в одной функции.
4. **recomputeLeaves** → `nodeState.set` + `updateValuesCacheEntry` — атомарно в одной функции.
5. **resetPipeline** → использует `applyPatch` (уже обновляет кеш) + `recomputeAll` (тоже обновляет).

Нет случая, когда `nodeState.value` обновляется, а `valuesCache` — нет.

---

## Производительность

| Операция | Было | Станет |
|----------|------|--------|
| SET value (write) | `collectValues` × 2–3 (format, setter, recompute) = O(N) × 3 | `updateValuesCacheEntry` × 1 = **O(1)** |
| computed (recompute) | `collectValues` × M computed = O(N×M) | чтение `valuesCache.values` = **O(1)** × M |
| getValues() | `collectValues` O(N) | прямой return = **O(1)** |

Для формы из 50 полей с 10 computed: **~150 итераций → 0**.

---

## Порядок выполнения

1. ✅ Создать `store/valuesCache.ts` с `buildValuesCache`, `updateValuesCacheEntry`
2. ✅ Инициализировать в `store.ts`
3. ✅ Обновить `applyPatch.ts` — добавить обновление кеша
4. ✅ Обновить `writePipeline.ts` — `WriteDeps` + `storeValue` + `formatValue` + `runSetter`
5. ✅ Обновить `recomputeAll.ts` — `recomputeLeaves` получает `valuesCache`
6. ✅ Обновить `onChangePipeline.ts` — `OnChangeDeps` + кеш вместо `collectValues`
7. ✅ Обновить `buildProxy.ts` — `BuildProxyDeps` + кеш вместо `collectValues`
8. ✅ Обновить `submitPipeline.ts` — кеш вместо `collectValues`
9. ✅ Обновить `store.ts` — `getValues()` из кеша
10. ✅ Обновить тесты
11. ✅ Удалить функцию `collectValues` (оставить `AnyConfigNode`)
