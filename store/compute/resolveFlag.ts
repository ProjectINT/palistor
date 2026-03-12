import { TranslateFn } from "../store/types";

/**
 * Вычисляет одно свойство-флаг из конфига: если это функция — вызывает с values,
 * иначе возвращает как есть. Если undefined — возвращает defaultValue.
 */
export function resolveFlag(
  configValue: boolean | ((values: any, translate: TranslateFn) => boolean) | undefined,
  values: Record<string, any>,
  defaultValue: boolean,
  translate: TranslateFn,
): boolean {
  if (configValue === undefined) return defaultValue;
  if (typeof configValue === "function") return configValue(values, translate);
  return configValue;
}
