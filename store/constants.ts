/**
 * Символ для доступа к исходному config-узлу из Proxy.
 * Используется tracking proxy для определения, какой узел читается.
 */
export const CONFIG_NODE: unique symbol = Symbol("configNode");

/**
 * Символ для получения исходного source-proxy (store.proxy) из tracking proxy.
 * Позволяет useForm принять tracking proxy поддерево и извлечь source.
 */
export const SOURCE_PROXY: unique symbol = Symbol("sourceProxy");

/**
 * Символ для получения ссылки на ProxyStore из tracking proxy.
 * Позволяет useForm принять tracking proxy поддерево и подписаться на store.
 */
export const STORE_REF: unique symbol = Symbol("storeRef");

/**
 * Символ для получения entity ID из EntityProjectionProxy.
 * Позволяет useForm(entity, templateSelector) извлечь entityId и store из proxy.
 */
export const ENTITY_ID: unique symbol = Symbol("entityId");

/**
 * Символ для получения объекта id-листа (EntityLeafNode) из EntityProjectionProxy.
 * Используется tracking proxy для регистрации подписки на id — чтобы rekey()
 * корректно триггерил перерендер компонентов, читающих `entity.id`.
 */
export const ENTITY_ID_LEAF: unique symbol = Symbol("entityIdLeaf");

/**
 * Свойства, относящиеся к состоянию поля. При обращении к ним прокси
 * возвращает значение из FieldState (вычисленное), а не из конфига.
 */
export const FIELD_STATE_PROPS = new Set<string>([
  "value",
  "label",
  "placeholder",
  "description",
  "isRequired",
  "isReadOnly",
  "isDisabled",
  "isVisible",
  "isInvalid",
  "errorMessage",
  "dirty",
  "loading",
]);

/**
 * Полный набор «служебных» ключей узла конфига.
 * При обходе дерева (init, buildValuesCache) — пропускаются.
 */
export const CONFIG_PROPS = new Set<string>([
  ...FIELD_STATE_PROPS,
  "validate",
  "formatter",
  "setter",
  "componentProps",
  "types",
  "dependencies",
  // Handler props (submit, reset, onChange lifecycle)
  "onSubmit",
  "beforeSubmit",
  "afterSubmit",
  "reset",
  "onChange",
  // Resolve props
  "resolve",
  "deps",
  // Node kind marker — set by registerNodes/entity factories, invisible to user code
  "__kind",
]);

export const SPREADABLE_FIELD_STATE_PROPS = [
  ...FIELD_STATE_PROPS,
  "onValueChange",
].filter(k => ![
  "dirty",
  "loading",
].includes(k));

/**
 * Статический набор ключей, которые включаются при spread группового узла:
 * состояние (submitting, dirty, revalidate, loading) и методы (submit, reset).
 * Дочерние узлы добавляются динамически в computeProxyKeys.
 */
export const GROUP_SPREAD_KEYS: string[] = [
  "value",
  "submitting",
  "dirty",
  "revalidate",
  "loading",
  "values",
  "submit",
  "reset",
];

/**
 * Статический набор ключей для proxy списка (ListNode).
 * Возвращается из computeProxyKeys вместо GROUP_SPREAD_KEYS, когда узел — массив.
 */
export const LIST_SPREAD_KEYS: string[] = [
  "items",
  "length",
  "loading",
  "dirty",
  "add",
  "remove",
  "getById",
  "setItems",
  "map",
  "getValues",
];