import { TranslateFn } from "../store/types";

/**
 * Resolves a single flag property from the config: a function is called with
 * the values, anything else is returned as-is. undefined → defaultValue.
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
