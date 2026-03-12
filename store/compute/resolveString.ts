import type { TranslateFn } from "../store/types";

/**
 * Вычисляет строковое свойство (label, placeholder, description) из конфига.
 * Может быть строкой или функцией `(t: TranslateFn, values) => string`.
 *
 * Если translator зарегистрирован — реальный резолв происходит лениво
 * в proxy GET trap (buildProxy.ts). Здесь сохраняем fallback:
 * для функций — вызываем с identity → возвращаем ключ перевода.
 */
export function resolveString(
  configValue: string | ((t: TranslateFn, values: Record<string, any>) => string) | undefined,
  values: Record<string, any> = {},
): string | undefined {
  if (configValue === undefined) return undefined;
  if (typeof configValue === "function") {
    // identity — вернёт ключ как есть (fallback до регистрации translator)
    return configValue((v: string) => v, values);
  }
  return configValue;
}
