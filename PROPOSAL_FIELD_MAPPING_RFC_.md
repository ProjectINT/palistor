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

---

## Суть решения

Добавить необязательный маппер `fieldMapping` в опции `Palistor`. Маппер определяет, под какими именами свойства будут видны через proxy (GET + ownKeys/spread). Внутренний `FieldState` и вся логика compute остаются без изменений.

```ts
const store = new Palistor({
  config: orderConfig,
  fieldMapping: {
    isRequired: 'required',
    isDisabled: 'disabled',
    isReadOnly: 'readOnly',
    isInvalid:  'error',
    errorMessage: 'helperText',
    description: 'helpText',
    // не указанные ключи — остаются как есть (value, label, placeholder, dirty, loading)
  },
});
```

После маппинга:

```tsx
// Spread напрямую — без адаптеров
<Input {...form.email} />
// form.email.required     === true
// form.email.helperText   === "Email is required"
// form.email.error        === true
// form.email.value        === ""
// form.email.label        === "Email"
```

---

## Дизайн

### 1. Новый тип `FieldMapping`

```ts
// store/store/types.ts

/**
 * Карта переименования: internal name → external name.
 * Ключи — имена из FIELD_STATE_PROPS. Значения — имена, под которыми
 * свойство будет доступно через proxy.
 *
 * Не указанные ключи сохраняют оригинальное имя.
 */
export type FieldMapping = Partial<Record<
  | 'value'
  | 'label'
  | 'placeholder'
  | 'description'
  | 'isRequired'
  | 'isReadOnly'
  | 'isDisabled'
  | 'isVisible'
  | 'isInvalid'
  | 'errorMessage'
  | 'dirty'
  | 'loading'
  | 'onValueChange',
  string
>>;
```
### Концепт маппинга

1. Мы создаем дефолтный маппер:

```ts
const defaultFieldMapping: FieldMapping = {
  value: 'value',
  label: 'label',
  placeholder: 'placeholder',
  description: 'description',
  isRequired: 'isRequired',
  isReadOnly: 'isReadOnly',
  isDisabled: 'isDisabled',
  isVisible: 'isVisible',
  isInvalid: 'isInvalid',
  errorMessage: 'errorMessage',
  dirty: 'dirty',
  loading: 'loading',
  onValueChange: 'onValueChange',
};

const fieldMapping = { ...defaultFieldMapping, ...options.fieldMapping };

```

Дальше где бы мне обращаться к полю, я буду использовать `fieldMapping`:

```ts
const externalKey = fieldMapping[key as keyof FieldMapping];
```
Т.е. доступ к полю получается всегда программный. Таким образом если в инициализацию добавлен маппер,
то через proxy мы будем видеть уже переименованные ключи. Если маппера нет — всё работает как сейчас, с дефолтными именами.

---

## Анализ: что меняется, что нет

### Граница маппинга

Маппинг работает **только на proxy-выходе** — слой, через который пользователь обращается к полям.
Всё, что внутри (FieldState, compute, dirty tracking, nodeState, registerNodes) — без изменений.

```
Пользователь → [external names] → Proxy слой → [internal names] → FieldState / compute / nodeState
                                   ↑ маппинг здесь
```

### Файлы, которые МЕНЯЮТСЯ

| # | Файл | Что делать |
|---|---|---|
| 1 | `store/store/types.ts` | Добавить `FieldMapping`, `ResolvedFieldMapping` типы. Добавить `fieldMapping?` в `ProxyStoreOptions` |
| 2 | `store/constants.ts` | Добавить `defaultFieldMapping` объект (identity mapping). Добавить функцию `resolveFieldMapping(options?)` |
| 3 | `store/store/palistor.ts` | В конструкторе: `this.fieldMapping = resolveFieldMapping(options.fieldMapping)`. Хранить `externalFieldProps: Set<string>` (для tracking proxy) |
| 4 | `store/buildProxy/buildProxy.ts` | GET trap: `fieldStateHandlers` с external ключами. SET trap: проверять `m.value`. `onValueChange`: проверять `m.onValueChange` |
| 5 | `store/buildProxy/computeProxyKeys.ts` | Leaf: возвращать mapped `SPREADABLE_FIELD_STATE_PROPS`. Принимать `fieldMapping` параметром |
| 6 | `store/buildProxy/buildEntityProjectionProxy.ts` | Entity leaf: switch → object dispatch с external ключами. SET trap: `m.value`. ownKeys: mapped имена |
| 7 | `react/createTrackingProxy.ts` | `FIELD_STATE_PROPS.has(key)` → `store.externalFieldProps.has(key)`. List tracking: `m.loading`, `m.dirty` |
| 8 | `index.ts` | Экспортировать `FieldMapping` тип |

### Файлы, которые НЕ МЕНЯЮТСЯ

| Файл | Почему |
|---|---|
| `compute/types.ts` (FieldState) | Internal интерфейс, proxy читает из него по internal именам |
| `compute/computeFieldState.ts` | Вычисляет internal FieldState из конфига |
| `compute/fieldStateChanged.ts` | Shallow-compare двух internal FieldState |
| `init/initGroupSubmitting.ts` | Пишет internal FieldState в nodeState |
| `store/registerNodes.ts` | Регистрирует ноды, пишет internal FieldState |
| `writePipeline/*` | Работает с nodeState/values по internal именам |
| `dirtyTracking/*` | Читает internal `dirty` из FieldState |
| `resetPipeline/*` | Работает с internal state |
| `submitPipeline/*` | Работает с internal state |
| `onChangePipeline/*` | Работает с internal state |
| `resolvePipeline/*` | Работает с internal state |
| `valuesCache/*` | Работает с `value` напрямую из nodeState |

---

## Детальный план изменений по файлам

### 1. `store/store/types.ts` — типы

```ts
export type FieldMapping = Partial<Record<
  | 'value' | 'label' | 'placeholder' | 'description'
  | 'isRequired' | 'isReadOnly' | 'isDisabled' | 'isVisible'
  | 'isInvalid' | 'errorMessage'
  | 'dirty' | 'loading' | 'onValueChange',
  string
>>;

/** Полностью резолвленный маппинг — все ключи заполнены. */
export type ResolvedFieldMapping = Required<Record<
  | 'value' | 'label' | 'placeholder' | 'description'
  | 'isRequired' | 'isReadOnly' | 'isDisabled' | 'isVisible'
  | 'isInvalid' | 'errorMessage'
  | 'dirty' | 'loading' | 'onValueChange',
  string
>>;

// В ProxyStoreOptions:
export interface ProxyStoreOptions<TConfig> {
  config: TConfig;
  // ... существующие поля ...
  fieldMapping?: FieldMapping;
}
```

### 2. `store/constants.ts` — defaultFieldMapping

```ts
export const defaultFieldMapping: ResolvedFieldMapping = {
  value: 'value',
  label: 'label',
  placeholder: 'placeholder',
  description: 'description',
  isRequired: 'isRequired',
  isReadOnly: 'isReadOnly',
  isDisabled: 'isDisabled',
  isVisible: 'isVisible',
  isInvalid: 'isInvalid',
  errorMessage: 'errorMessage',
  dirty: 'dirty',
  loading: 'loading',
  onValueChange: 'onValueChange',
};

export function resolveFieldMapping(custom?: FieldMapping): ResolvedFieldMapping {
  if (!custom) return defaultFieldMapping;
  return { ...defaultFieldMapping, ...custom };
}
```

### 3. `store/store/palistor.ts` — хранение

```ts
class Palistor<TConfig> {
  readonly fieldMapping: ResolvedFieldMapping;
  readonly externalFieldProps: Set<string>;  // для createTrackingProxy

  constructor(options) {
    this.fieldMapping = resolveFieldMapping(options.fieldMapping);
    // Set из всех external имён (кроме onValueChange — он не в FIELD_STATE_PROPS)
    this.externalFieldProps = new Set(
      Object.entries(this.fieldMapping)
        .filter(([k]) => k !== 'onValueChange')
        .map(([, v]) => v)
    );
    // ...
  }
}
```

### 4. `store/buildProxy/buildProxy.ts` — GET/SET trap

**GET trap — `fieldStateHandlers` с external ключами:**

```ts
get(_target, key: string | symbol) {
  // ... символы ...
  const m = kernel.fieldMapping;

  // onValueChange — через маппинг
  if (key === m.onValueChange) {
    return getCached(caches.onValueChange, node, () => (v: unknown) => {
      proxyNode[m.value] = v;  // SET через external имя value
    });
  }

  // ... группа: submitting/submit/reset — без маппинга (group-only) ...
  // ... НО dirty и loading в группе тоже маппятся:
  if (isGroupNode) {
    const groupHandlers: Record<string, () => unknown> = {
      "submitting": () => currentNode?.submitting ?? false,
      [m.dirty]:    () => currentNode?.dirty ?? false,
      "revalidate": () => currentNode?.revalidate ?? false,
      [m.loading]:  () => currentNode?.loading ?? false,
      "submit":     () => getCached(...),
      "reset":      () => getCached(...),
      "setValues":  () => getCached(...),
    };
    if (key in groupHandlers) return groupHandlers[key]();
    // ...handleLazyResolve...
  }

  // ── Вычисленное состояние поля ─────────────────────────────────
  // ВАЖНО: translatableHandler параметризован internal-ключом,
  // потому что node[externalKey] === undefined для remapped ключей
  const mkTranslatable = (internalKey: string) => () => {
    const configValue = node[internalKey];
    if (typeof configValue === "function") {
      return configValue(kernel.services.translate, kernel.values.values);
    }
    return currentNode ? currentNode[internalKey as keyof FieldState] : configValue;
  };

  const fieldStateHandlers: Record<string, (() => unknown) | unknown> = {
    [m.value]:        currentNode ? currentNode.value        : node.value,
    [m.label]:        mkTranslatable("label"),
    [m.placeholder]:  mkTranslatable("placeholder"),
    [m.description]:  mkTranslatable("description"),
    [m.isRequired]:   currentNode ? currentNode.isRequired   : node.isRequired,
    [m.isReadOnly]:   currentNode ? currentNode.isReadOnly   : node.isReadOnly,
    [m.isDisabled]:   currentNode ? currentNode.isDisabled   : node.isDisabled,
    [m.isVisible]:    currentNode ? currentNode.isVisible    : node.isVisible,
    [m.isInvalid]:    currentNode ? currentNode.isInvalid    : node.isInvalid,
    [m.errorMessage]: currentNode ? currentNode.errorMessage : node.errorMessage,
    [m.dirty]:        currentNode?.dirty,
    [m.loading]:      currentNode?.loading,
  };

  if (key in fieldStateHandlers) {
    const field = fieldStateHandlers[key];
    if (typeof field === "function") return field();
    return field;
  }

  // Дочерний узел → рекурсивный прокси
  // ...
}
```

**SET trap:**

```ts
set(_target, key: string | symbol, newValue: unknown) {
  if (key !== kernel.fieldMapping.value) return false;
  // ... остальное без изменений ...
}
```

### 5. `store/buildProxy/computeProxyKeys.ts` — ownKeys

```ts
export function computeProxyKeys(node: unknown, m: ResolvedFieldMapping): string[] {
  if (nodeUtils.isListNode(node)) return LIST_SPREAD_KEYS;

  const configNode = node as AnyConfigNode;
  if (nodeUtils.isLeaf(configNode)) {
    // Маппированный SPREADABLE: все кроме dirty и loading, плюс onValueChange
    return [
      m.value, m.label, m.placeholder, m.description,
      m.isRequired, m.isReadOnly, m.isDisabled, m.isVisible,
      m.isInvalid, m.errorMessage,
      m.onValueChange,
      ...Object.keys((configNode.componentProps as Record<string, unknown>) ?? {}),
    ];
  }

  return GROUP_SPREAD_KEYS;  // group keys не маппятся (Phase 1)
}
```

### 6. `store/buildProxy/buildEntityProjectionProxy.ts` — entity leaf proxy

**switch → object dispatch:**

```ts
const m = kernel.fieldMapping;

const handlers: Record<string, () => unknown> = {
  [m.value]: () =>
    (nodeState.get(entityLeaf as object) as any)?.value ?? entityLeaf.value,

  [m.label]: () => {
    const v = templateField.label;
    return typeof v === "function" ? v(translate, entityValues) : v;
  },
  [m.placeholder]: () => { /* аналогично */ },
  [m.description]: () => { /* аналогично */ },
  [m.isRequired]: () => { /* аналогично */ },
  [m.isReadOnly]: () => { /* аналогично */ },
  [m.isDisabled]: () => { /* аналогично */ },
  [m.isVisible]:  () => { /* аналогично */ },
  [m.errorMessage]: () => { /* validate logic */ },
  [m.isInvalid]:    () => { /* validate logic */ },
  [m.dirty]: () =>
    (nodeState.get(entityLeaf as object) as any)?.dirty ?? false,
  [m.onValueChange]: () =>
    (v: unknown) => writeEntityLeafValue(...),
};

if (key in handlers) return handlers[key]();
return undefined;
```

**SET trap:**
```ts
set(_target, key, newValue) {
  if (key !== kernel.fieldMapping.value) return false;
  // ...
}
```

**ownKeys:**
```ts
ownKeys() {
  const m = kernel.fieldMapping;
  return [
    m.value, m.label, m.placeholder, m.description,
    m.isRequired, m.isReadOnly, m.isDisabled, m.isVisible,
    m.isInvalid, m.errorMessage, m.dirty, m.onValueChange,
  ];
}
```

### 7. `react/createTrackingProxy.ts` — tracking

```ts
// store.externalFieldProps — Set<string> из Palistor
// store.fieldMapping — ResolvedFieldMapping из Palistor

// Было:
if (FIELD_STATE_PROPS.has(key) || key === "submitting") { ... }

// Стало:
if (store.externalFieldProps.has(key) || key === "submitting") { ... }

// List tracking:
// Было:
if (key === "length" || key === "loading" || key === "dirty") { ... }

// Стало:
const m = store.fieldMapping;
if (key === "length" || key === m.loading || key === m.dirty) { ... }
```

### 8. `index.ts` — экспорт

```ts
export type { FieldMapping, ResolvedFieldMapping } from "./store/store/types";
```

---

## Порядок реализации

1. **Типы** → `types.ts`: `FieldMapping`, `ResolvedFieldMapping`, расширить `ProxyStoreOptions`
2. **Constants** → `constants.ts`: `defaultFieldMapping`, `resolveFieldMapping()`
3. **Kernel** → `palistor.ts`: хранить `fieldMapping` + `externalFieldProps`
4. **buildProxy** → GET/SET trap с маппингом, `translatableHandler` параметризован
5. **computeProxyKeys** → принять `fieldMapping`, вернуть external имена
6. **buildEntityProjectionProxy** → switch → object dispatch, ownKeys, SET trap
7. **createTrackingProxy** → `externalFieldProps.has(key)`, list tracking
8. **index.ts** → экспорт типов
9. **Тесты** → proxy GET/SET/spread/tracking с кастомным маппингом

