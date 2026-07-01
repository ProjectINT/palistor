# RFC: Field Name Mapping (fieldMapping)

## Проблема

Palistor экспортирует через proxy жёстко зашитые имена свойств:

```ts
form.email.isRequired   // boolean
form.email.isInvalid    // boolean
form.email.errorMessage // string
form.email.isDisabled   // boolean
form.email.isReadOnly   // boolean
form.email.isVisible    // boolean
form.email.label        // string
form.email.placeholder  // string
form.email.description  // string
form.email.value        // unknown
form.email.dirty        // boolean
form.email.loading      // boolean
```

UI-библиотеки ожидают **другие** имена:

| Palistor       | Ant Design        | Material UI   | Chakra UI      | HTML native   |
|----------------|-------------------|---------------|----------------|---------------|
| `isRequired`   | `required`        | `required`    | `isRequired`   | `required`    |
| `isDisabled`   | `disabled`        | `disabled`    | `isDisabled`   | `disabled`    |
| `isReadOnly`   | `readOnly`        | `readOnly`    | `isReadOnly`   | `readOnly`    |
| `isInvalid`    | `status: 'error'` | `error`       | `isInvalid`    |     —         |
| `errorMessage` | `help`            | `helperText`  | `errorMessage` |     —         |
| `isVisible`    |        —          |       —       |        —       |     —         |
| `label`        | `label`           | `label`       | `label`        |     —         |
| `placeholder`  | `placeholder`     | `placeholder` | `placeholder`  | `placeholder` |
| `description`  | `extra`           | `helperText`  | `helpText`     |     —         |

Из-за этого при `{...form.email}` (spread) фронтенд вынужден писать адаптеры:

```tsx
// Текущий подход — ручной маппинг каждый раз
<Input
  value={form.email.value}
  required={form.email.isRequired}
  disabled={form.email.isDisabled}
  error={form.email.isInvalid}
  helperText={form.email.errorMessage}
/>
```

При смене версии Palistor или UI-фреймворка — адаптеры нужно переписывать.

> **Важно про границы (см. §7).** Бóльшая часть строк таблицы — это чистое
> *переименование* (`isRequired → required`). Но две ячейки — это не
> переименование, а **трансформация значения**: Ant `isInvalid → status:'error'`
> (boolean → строка-энум) и MUI `helperText`, который берётся из `errorMessage`
> **или** `description` (many-to-one). Этот RFC решает переименование 1:1 — оно
> покрывает ~90 % ячеек; трансформации явно вынесены в §7.

---

## Суть решения

Добавить необязательный маппер `fieldMapping` в опции `Palistor`. Маппер задаёт,
под какими именами внутренние свойства видны через proxy (GET + ownKeys/spread +
tracking). Внутренний `FieldState`, compute, pipelines — **без изменений**.

```ts
const store = new Palistor({
  config: orderConfig,
  fieldMapping: {
    isRequired:   'required',
    isDisabled:   'disabled',
    isReadOnly:   'readOnly',
    isInvalid:    'error',
    errorMessage: 'helperText',
    description:  'helpText',
    // не указанные ключи остаются как есть: value, label, placeholder, dirty, loading, onValueChange
  },
});
```

После маппинга:

```tsx
// Spread напрямую — без адаптеров
<Input {...form.email} />
// form.email.required   === true
// form.email.helperText === "Email is required"
// form.email.error      === true
// form.email.value      === ""
// form.email.label      === "Email"
```

---

## Ключевая идея: обратный маппинг на границе proxy

**Маппинг — это биекция `internal ⇄ external`.** Значит переводить нужно ровно в
двух точках, а не переписывать все обработчики:

1. **Вход (GET/SET/tracking):** приходящий *external*-ключ переводим в *internal*
   **одной строкой** в начале trap-а. Дальше вся существующая логика работает по
   internal-именам без изменений.
2. **Выход (ownKeys/spread):** список internal-ключей проецируем в external
   **одной операцией** `keys.map(k => fwd[k] ?? k)`.

```
Пользователь → [external] → reverse ↓  Proxy internal-логика  ↑ forward → [external] → spread
                 GET/SET/track  (без изменений)   ownKeys
```

Это принципиально дешевле подхода «переписать каждый объект-обработчик под
external-ключи»: тот требует трогать 4 dispatch-таблицы и параметризовать
`translatableHandler`; обратный маппинг добавляет **по одной строке на trap**.

### Почему обратный маппинг ещё и безопаснее

При «object-dispatch с external-ключами» чтение *старого* internal-имени
(`form.email.isRequired` при активном маппинге) провалится в ветку «дочерний
узел» и вернёт **сырое значение из конфига** — а оно может быть функцией
(`isRequired: (values) => …`). Это footgun. При обратном маппинге internal-имя
по-прежнему резолвится штатным обработчиком (возвращает вычисленный boolean), а
из `spread`/`ownKeys` исчезает. То есть обратный маппинг строго безопаснее.

---

## Дизайн

### 0. Единый источник имён ключей (убираем тройное дублирование)

Сейчас список полей продублирован: `FIELD_STATE_PROPS` (Set) и
`SPREADABLE_FIELD_STATE_PROPS` (derived). Тип `FieldMapping` в прежнем RFC
перечислял те же имена ещё трижды. Заводим один canonical tuple и выводим из него
и Set, и тип:

```ts
// store/constants.ts

/** Единственный источник имён полей состояния. */
export const FIELD_STATE_KEYS = [
  "value", "label", "placeholder", "description",
  "isRequired", "isReadOnly", "isDisabled", "isVisible",
  "isInvalid", "errorMessage", "dirty", "loading",
] as const;

export const FIELD_STATE_PROPS = new Set<string>(FIELD_STATE_KEYS);

/** Ключи, которые можно переименовывать: поля состояния + функциональный сеттер. */
export const MAPPABLE_KEYS = [...FIELD_STATE_KEYS, "onValueChange"] as const;
export type MappableKey = (typeof MAPPABLE_KEYS)[number];
```

```ts
// store/store/types.ts

/**
 * Карта переименования internal → external.
 * Sparse: указываем только те ключи, которые переименовываем;
 * остальные остаются с оригинальными именами.
 */
export type FieldMapping = Partial<Record<MappableKey, string>>;
```

> `ResolvedFieldMapping`, `defaultFieldMapping`, `resolveFieldMapping()` из
> прежнего RFC **не нужны**: identity-поведение даёт `fwd[k] ?? k` в каждой точке.
> Нет полного identity-объекта — нет и шага резолва.

### 1. Kernel хранит две проекции карты

```ts
// store/store/palistor.ts — в конструкторе

/** internal → external (sparse). Для ownKeys/spread. @internal */
readonly fieldMapping: FieldMapping;
/** external → internal (sparse, обратная). Для GET/SET/tracking. @internal */
readonly externalToInternal: Record<string, string>;

constructor(options: ProxyStoreOptions<TConfig>) {
  // ...
  const fwd = options.fieldMapping ?? {};
  this.fieldMapping = fwd;
  this.externalToInternal = {};
  for (const internal in fwd) {
    this.externalToInternal[fwd[internal as MappableKey]!] = internal;
  }
}
```

Когда `fieldMapping` не передан, обе карты пусты → `?? k` возвращает ключ как есть
→ **поведение и производительность без изменений** (нулевой оверхед по умолчанию).

### 2. Паттерн в каждом GET-trap: одна строка перевода

Во всех proxy-строителях в начале GET (после обработки символов) добавляем:

```ts
const ikey = kernel.externalToInternal[key as string] ?? key;
// дальше вся существующая dispatch-логика — по `ikey` вместо `key`.
// `key` оставляем только для символов и навигации к дочерним узлам.
```

Пример для `buildProxy.ts` (главный leaf/group proxy) — меняется только вход,
таблицы `fieldStateHandlers` / group-`handlers` остаются с internal-ключами:

```ts
get(_target, key: string | symbol) {
  if (key === CONFIG_NODE) return node;
  if (typeof key === "symbol") return undefined;

  const ikey = kernel.externalToInternal[key] ?? key;   // ← единственное добавление

  if (ikey === "onValueChange") { /* как сейчас, но проверяем ikey */ }

  // group handlers: `if (ikey in handlers) return handlers[ikey]()`
  // fieldStateHandlers: `if (ikey in fieldStateHandlers) …`
  //   translatableHandler читает node[ikey], currentNode[ikey] — тоже по ikey

  const child = node[key];   // навигация к дочернему узлу — по ОРИГИНАЛЬНОМУ key
  if (child && typeof child === "object") return builder.build(child);
  return child;
}
```

`SET`-trap: перевести и сверять с internal-`"value"`:

```ts
set(_target, key, newValue) {
  const ikey = kernel.externalToInternal[key as string] ?? key;
  if (ikey !== "value") return false;
  // ... остальное без изменений ...
}
```

### 3. Паттерн на выходе: `ownKeys` проецирует internal → external

Единообразно для листа, группы и списка — одна и та же операция `map`:

```ts
// store/buildProxy/computeProxyKeys.ts
export function computeProxyKeys(node: unknown, fwd: FieldMapping): string[] {
  const map = (keys: string[]) => keys.map(k => fwd[k as MappableKey] ?? k);

  if (nodeUtils.isListNode(node)) return map(LIST_SPREAD_KEYS);

  const configNode = node as AnyConfigNode;
  return isLeafNode(configNode)
    ? map([
        ...SPREADABLE_FIELD_STATE_PROPS,
        ...Object.keys((configNode.componentProps as Record<string, unknown>) ?? {}),
      ])
    : map(GROUP_SPREAD_KEYS);
}
```

`fwd[k] ?? k` сам разбирается, что переименовывать: `value`/`dirty`/`loading` в
`GROUP_SPREAD_KEYS` и `loading`/`dirty` в `LIST_SPREAD_KEYS` спроецируются;
`submit`/`reset`/`items`/`map` — нет (их в карте не бывает). `componentProps`
никогда не в карте → остаются как есть.

### 4. Tracking: перевести перед проверкой `FIELD_STATE_PROPS`

```ts
// react/createTrackingProxy.ts — GET
const ikey = store.externalToInternal[key as string] ?? key;

// list-ветка:
if (ikey === "length" || ikey === "loading" || ikey === "dirty") { …track…; return target[key]; }

// field-ветка:
if (FIELD_STATE_PROPS.has(ikey) || ikey === "submitting") { …track…; return target[key]; }
```

Возвращаем `target[key]` по **оригинальному** external-ключу — source-proxy сам
переведёт его обратно. Отдельный `externalFieldProps: Set` из прежнего RFC не
нужен: обратная карта + существующий `FIELD_STATE_PROPS` покрывают всё.

---

## Изменения по файлам

| # | Файл | Что делать |
|---|---|---|
| 1 | `store/constants.ts` | `FIELD_STATE_KEYS` (canonical tuple) → вывести из него `FIELD_STATE_PROPS`; добавить `MAPPABLE_KEYS`, `MappableKey` |
| 2 | `store/store/types.ts` | Добавить `FieldMapping`; добавить `fieldMapping?` в `ProxyStoreOptions`; добавить `@internal externalToInternal` в `ProxyStore` |
| 3 | `store/store/palistor.ts` | Построить `fieldMapping` (sparse fwd) и `externalToInternal` (reverse) в конструкторе |
| 4 | `store/buildProxy/buildProxy.ts` | **Два** trap-а: главный proxy и `_buildEntityLeafProxy`. В каждом: `ikey` в GET, перевод в SET, `ownKeys` через `.map`. Главный GET/SET уже использует `computeProxyKeys(node, kernel.fieldMapping)` |
| 5 | `store/buildProxy/computeProxyKeys.ts` | Принять `fwd: FieldMapping`, обернуть возврат в `map(keys)` |
| 6 | `store/buildProxy/buildEntityProjectionProxy.ts` | GET: `ikey` (влияет на `loading`/`dirty`); `ownKeys`/`getOwnPropertyDescriptor` через `.map` |
| 7 | `store/buildProxy/buildListProxy.ts` | GET: `ikey` в `switch` (влияет на `loading`/`dirty`); `spreadKeys` через `.map` |
| 8 | `react/createTrackingProxy.ts` | Перевести `key → ikey` перед list- и field-проверками |
| 9 | `index.ts` | Экспортировать тип `FieldMapping` |

> **Правка к прежнему RFC:** entity-leaf proxy больше не в
> `buildEntityProjectionProxy.ts` — он переехал в `ProxyBuilder._buildEntityLeafProxy`
> внутри `buildProxy.ts`. Плюс `buildListProxy.ts` тоже отдаёт mappable-ключи
> (`loading`, `dirty`) и раньше в списке файлов отсутствовал.

### Файлы, которые НЕ меняются

`compute/*` (FieldState, computeFieldState, fieldStateChanged), `init/*`,
`registerNodes`, `writePipeline/*`, `dirtyTracking/*`, `resetPipeline/*`,
`submitPipeline/*`, `onChangePipeline/*`, `resolvePipeline/*`, `valuesCache/*` —
вся internal-логика оперирует internal-именами, маппинг её не касается.

---

## Граница маппинга

Маппинг живёт **только на границе proxy** (GET/SET/ownKeys) и в tracking-proxy.
Всё внутри — по internal-именам.

```
Пользователь → [external] → Proxy-граница → [internal] → FieldState / compute / nodeState
                             ↑ маппинг здесь (reverse на входе, forward на выходе)
```

---

## 7. Область применения и escape hatch

Этот RFC решает **переименование 1:1**. Оно покрывает Chakra, HTML-native, и
бóльшую часть Ant/MUI. Осознанно **вне** охвата (и почему):

| Кейс | Пример | Почему не решается переименованием |
|---|---|---|
| **Трансформация значения** | Ant `isInvalid: true → status: 'error'` | Меняется не имя, а тип/значение (boolean → энум). Не биекция имён. |
| **Many-to-one** | MUI `helperText = isInvalid ? errorMessage : description` | Два internal-источника в один external-ключ; для чтения неоднозначно, для SET необратимо. |
| **One-to-many / доп. пропсы** | добавить `aria-invalid` из `isInvalid` | Порождение новых ключей — не переименование. |

**Ограничение-инвариант:** `fieldMapping` — биекция. External-имя не должно
совпадать с именем соседнего дочернего поля и не должно указывать на два разных
internal-ключа (many-to-one запрещён). При желании — провалидировать в
конструкторе (dev-warning на дубликаты значений).

**Escape hatch сегодня:** трансформации закрываются тонким per-компонентным
адаптером поверх уже-переименованного spread, например:

```tsx
// Ant status из уже-переименованного error
const antStatus = form.email.error ? 'error' : undefined;
<Input {...form.email} status={antStatus} />
```

**Путь к полной универсальности (Phase 2, необязательно).** Поскольку перевод уже
централизован в двух точках границы, значение карты можно расширить со `string`
(переименование) до `string | { name: string; transform?: (v) => unknown }` — и
применять `transform` **только на выходе** (GET/spread), оставляя SET за
переименовываемыми (1:1) ключами. Это включит Ant `status` и MUI `helperText` без
переписывания обработчиков — ровно потому, что архитектура «reverse-на-входе /
forward-на-выходе» уже изолировала границу. Явно вне охвата Phase 1.

---

## Порядок реализации

1. **Constants** → `FIELD_STATE_KEYS`, `MAPPABLE_KEYS`, `MappableKey`; `FIELD_STATE_PROPS` из tuple.
2. **Типы** → `FieldMapping`; `fieldMapping?` в `ProxyStoreOptions`; `@internal externalToInternal` в `ProxyStore`.
3. **Kernel** → построить `fieldMapping` + `externalToInternal`.
4. **computeProxyKeys** → принять `fwd`, обернуть в `map`.
5. **buildProxy** → `ikey` в двух GET/SET; `ownKeys` через `computeProxyKeys(node, fwd)` и `.map` (для leaf-proxy).
6. **buildEntityProjectionProxy** → `ikey` в GET; `.map` в ownKeys.
7. **buildListProxy** → `ikey` в switch; `.map` в spreadKeys.
8. **createTrackingProxy** → `ikey` перед list/field проверками.
9. **index.ts** → экспорт `FieldMapping`.
10. **Тесты** → GET/SET/spread/tracking с кастомным маппингом; проверить, что при
    пустом `fieldMapping` поведение идентично текущему (snapshot старых тестов);
    проверить, что internal-имена по-прежнему читаются напрямую, а из spread видны
    только external.
