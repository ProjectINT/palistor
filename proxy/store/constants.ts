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
]);
