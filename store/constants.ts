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
  "error",
  "errorMessage",
  "dirty",
  "loading",
]);

/**
 * Полный набор «служебных» ключей узла конфига.
 * При обходе дерева (init, collectValues) — пропускаются.
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
]);
