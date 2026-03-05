/**
 * Ключи конфига, которые НЕ должны утекать при spread-операции ({...proxy}).
 * Это внутренние свойства конфига (validate, formatter, setter, …), которые
 * могут конфликтовать с пропсами UI-компонентов (например, HeroUI Input
 * имеет свой `validate` и вызовет конфиг-функцию с неправильными аргументами).
 */
export const INTERNAL_CONFIG_KEYS = new Set<string>([
  "validate",
  "formatter",
  "setter",
  "types",
  "dependencies",
  "nested",
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
