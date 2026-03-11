import { applyPatch } from "../applyPatch";
import { type AnyConfigNode } from "../collectValues";
import { type PendingWrite } from "../createValuesTrackingProxy";
import type { FieldState } from "../compute";
import type { ValuesCache } from "../valuesCache";

// ─── Apply buffered writes ───────────────────────────────────────────────────

/**
 * Resolves a dot-path to the config node and applies value via applyPatch.
 * E.g. path "user.vehicleExists" → navigate to "user" group node → applyPatch { vehicleExists: value }
 */
export function applyPendingWrites(
  writes: PendingWrite[],
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
): Set<object> {
  const changed = new Set<object>();

  for (const { path, value } of writes) {
    // Build nested patch from dot-path
    const parts = path.split(".");
    let patch: Record<string, unknown> = {};
    let current = patch;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;

    applyPatch(rootConfig, nodeState, patch, changed, valuesCache);
  }

  return changed;
}
