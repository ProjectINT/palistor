import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { applyPatch } from "../applyPatch/applyPatch";
import type { ValuesCache } from "../valuesCache/valuesCache";
import type { Setter } from "./types";

/**
 * Extract the parent group's values from the cache.
 * Empty parentPath → return the root values.
 */
function getParentValues(
  valuesCache: ValuesCache,
  parentPath: string | undefined,
): Record<string, unknown> {
  if (!parentPath) return valuesCache.values;
  let current: unknown = valuesCache.values;
  for (const segment of parentPath.split(".")) {
    current = (current as Record<string, unknown>)?.[segment];
  }
  return (current as Record<string, unknown>) ?? {};
}

/**
 * Phase 3 (alternate branch): apply the setter.
 *
 * A setter is an extra write path: it returns a patch that updates
 * dependent (sibling) fields after the current value has been stored.
 *
 * The patch and values are scoped to the node's parent group (not the root)
 * so the setter can read and patch siblings directly.
 *
 * When the setter returns a non-object — logs an error without breaking the runtime.
 */
export function runSetter(
  node: AnyConfigNode,
  processedValue: unknown,
  parentNode: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  parentPath: string | undefined,
  previousValue?: unknown,
): Set<object> {
  const parentValues = getParentValues(valuesCache, parentPath);

  const patch = (node.setter as Setter)(
    processedValue,
    parentValues,
    previousValue,
  );

  if (!patch || typeof patch !== "object") {
    console.error(
      `[Palistor] setter must return an object, got ${patch === null ? "null" : typeof patch}.`,
      { node, value: processedValue },
    );
    return new Set();
  }

  return applyPatch(parentNode, nodeState, patch, new Set(), valuesCache);
}
