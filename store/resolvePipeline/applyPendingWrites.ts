import { applyPatch } from "../applyPatch/applyPatch";
import { type AnyConfigNode } from "../store/types";
import { type PendingWrite } from "./createValuesTrackingProxy";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";

// ─── Applying buffered writes ────────────────────────────────────────────────
//
// This is the second half of the deferred-write pipeline.
//
// FLOW OVERVIEW:
//   1. The resolver runs with the proxy from createValuesTrackingProxy().
//   2. Every `values.x.y = z` inside the resolver is intercepted and stored as
//      PendingWrite { path: "x.y", value: z } — nothing is mutated.
//   3. After the resolver returns, applyPendingWrites() is called with the
//      collected PendingWrite list.
//   4. For each write, the nested patch object applyPatch() expects is rebuilt,
//      then applyPatch() performs the real store write.
//   5. applyPatch() records the config nodes that changed into the `changed` set.
//   6. The caller uses `changed` to decide which dependent resolvers to re-run.

/**
 * Flushes all writes buffered during one resolver run into the real store.
 *
 * Converts each flat (dot-separated) path back into the nested patch
 * structure applyPatch() understands, then applies it.
 *
 * Example:
 *   PendingWrite { path: "user.vehicleExists", value: false }
 *   → patch = { user: { vehicleExists: false } }
 *   → applyPatch(rootConfig, nodeState, patch, changed, valuesCache)
 *
 * Deeper nesting works the same way:
 *   path: "a.b.c" → patch = { a: { b: { c: value } } }
 *
 * @param writes      — writes buffered by createValuesTrackingProxy during the resolver run
 * @param rootConfig  — root of the field config tree (used by applyPatch to find nodes)
 * @param nodeState   — runtime node state (dirty flags, errors, etc.)
 * @param valuesCache — mutable values cache that applyPatch updates in place
 * @returns           — set of config nodes whose value actually changed (for dependency tracking)
 */
export function applyPendingWrites(
  writes: PendingWrite[],
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
): Set<object> {
  // Accumulates all config nodes whose value actually changed during this flush.
  // Returned to the caller so it can schedule re-runs of dependent resolvers.
  const changed = new Set<object>();

  for (const { path, value } of writes) {
    // ── Rebuild the nested patch from the dot-path ───────────────────────────
    // applyPatch() expects a nested object mirroring the config tree, not a
    // flat path. Build it manually by nesting objects along the path segments.
    //
    // Example: path = "user.vehicleExists"
    //   parts = ["user", "vehicleExists"]
    //   After the loop: patch = { user: { vehicleExists: <value> } }
    const parts = path.split(".");
    let patch: Record<string, unknown> = {};
    let current = patch; // the `current` cursor descends into the nested object being built
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    // Place the actual value at the leaf (the last segment).
    current[parts[parts.length - 1]] = value;

    // ── Apply the patch to the real store ────────────────────────────────────
    // applyPatch walks rootConfig following the patch shape, writes values into
    // valuesCache, updates nodeState (dirty flags etc.) and records every node
    // whose value changed into `changed`.
    applyPatch(rootConfig, nodeState, patch, changed, valuesCache);
  }

  return changed;
}
