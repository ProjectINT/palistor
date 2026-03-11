/**
 * Вычисляет одно свойство-флаг из конфига: если это функция — вызывает с values,
 * иначе возвращает как есть. Если undefined — возвращает defaultValue.
 */
export function resolveFlag(
  configValue: boolean | ((values: any) => boolean) | undefined,
  values: Record<string, any>,
  defaultValue: boolean,
): boolean {
  if (configValue === undefined) return defaultValue;
  if (typeof configValue === "function") return configValue(values);
  return configValue;
}
