/**
 * Свойства, которые резолвятся лениво через зарегистрированный translator.
 * Если в конфиге это функция (t) => t(«key») и translator есть —
 * вызываем прямо в GET trap, иначе fallback на FieldState (ключ).
 */
export const TRANSLATABLE_PROPS = new Set<string>(["label", "placeholder", "description"]);
