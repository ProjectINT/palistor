import type { AnyResolveEntry } from "./initResolveStates";
import type { ResolveState } from "./types";

// ─── Check if changed paths intersect with resolve dependencies ──────────────

/**
 * Given a set of changed node paths, find all resolve nodes whose dependencies
 * intersect and should be re-triggered.
 *
 * Returns nodes that need re-resolve.
 */
export function findResolvesToRetrigger(
  changedPaths: Set<string>,
  resolveStates: Map<object, ResolveState>,
  resolveEntries: AnyResolveEntry[],
): AnyResolveEntry[] {
  if (changedPaths.size === 0) return [];

  const toRetrigger: AnyResolveEntry[] = [];

  for (const entry of resolveEntries) {
    const state = resolveStates.get(entry.node as object);
    if (!state) continue;
    // Only retrigger resolved or error nodes (not idle or pending)
    if (state.status !== "resolved" && state.status !== "error") continue;

    // Check if any dependency matches a changed path
    for (const dep of state.dependencies) {
      if (changedPaths.has(dep)) {
        toRetrigger.push(entry);
        break;
      }
    }
  }

  return toRetrigger;
}
