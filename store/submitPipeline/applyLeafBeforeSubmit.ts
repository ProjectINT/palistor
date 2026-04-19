import { configKeys, isLeafNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";

/**
 * Применяет leaf-level `beforeSubmit` трансформации к snapshot'у значений.
 * Не мутирует store — работает с копией.
 */
export function applyLeafBeforeSubmit(
  node: AnyConfigNode,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...values };

  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if (isLeafNode(child)) {
      if (typeof (child as AnyConfigNode).beforeSubmit === "function") {
        result[key] = (
          (child as AnyConfigNode).beforeSubmit as (v: unknown, vals: Record<string, unknown>) => unknown
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
