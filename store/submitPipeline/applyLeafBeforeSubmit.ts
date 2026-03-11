import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../types";

/**
 * Применяет leaf-level `beforeSubmit` трансформации к snapshot'у значений.
 * Не мутирует store — работает с копией.
 */
export function applyLeafBeforeSubmit(
  node: AnyConfigNode,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...values };

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      if (typeof child.beforeSubmit === "function") {
        result[key] = (
          child.beforeSubmit as (v: unknown, vals: Record<string, unknown>) => unknown
        )(result[key], values);
      }
    } else {
      const childValues = result[key];
      if (childValues && typeof childValues === "object" && !Array.isArray(childValues)) {
        result[key] = applyLeafBeforeSubmit(child, childValues as Record<string, unknown>);
      }
    }
  }

  return result;
}
