import type { FieldMapping } from "./store/types";

/**
 * Хелпер для объявления переиспользуемой карты `fieldMapping` с сохранением
 * литеральных значений в типе.
 *
 * Зачем нужен: при вынесении карты в отдельную константу литеральные значения
 * (`"required"`, …) обычно расширяются до `string`, и статическое переименование
 * полей перестаёт работать (рантайм при этом не страдает). Два способа этого
 * избежать — `as const` или этот хелпер. `defineFieldMapping` предпочтительнее,
 * так как ещё и проверяет карту на соответствие {@link FieldMapping} (ключи —
 * только mappable-имена, значения — строки).
 *
 * > ⚠️ НЕ используйте `... satisfies FieldMapping` для переиспользуемой карты:
 * > `satisfies` расширяет значения до `string`, и типизация переименования
 * > не сработает. Для inline-литерала прямо в `new Palistor({ fieldMapping })`
 * > хелпер не нужен — `const`-параметр класса сам захватывает литералы.
 *
 * @example
 * const fieldMapping = defineFieldMapping({
 *   isRequired:   "required",
 *   isInvalid:    "error",
 *   errorMessage: "helperText",
 * });
 * const store = new Palistor({ config, fieldMapping });
 * store.proxy.email.required;   // boolean — типизировано
 */
export function defineFieldMapping<const M extends FieldMapping>(mapping: M): M {
  return mapping;
}
