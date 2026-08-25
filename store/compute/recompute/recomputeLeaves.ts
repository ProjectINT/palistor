import { type FieldState, computeFieldState, fieldStateChanged } from "../index";
import type { TranslateFn } from "../../store/types";
import type { ComputeEntry } from "../../store/registerNodes";
import { updateValuesCacheEntry, type ValuesCache } from "../../valuesCache/valuesCache";
import { topologicalSortComputed } from "./topologicalSortComputed";
import type { TrackingWrap } from "./types";

/**
 * Recompute the computed state for a given list of leaf nodes.
 *
 * Phase 1: recompute computed values (value is a function) in topological order.
 * Phase 2: recompute FieldState (isVisible, isRequired, error…) for all fields.
 *
 * Each node receives group-scoped values — the parent group's values from
 * nodeSlot. This lets a config write functions in terms of its own group
 * (no navigation from the root), even when the config is nested inside a
 * global store. Cross-group dependencies use explicit navigation through the
 * parent object.
 *
 * @param trackingWrap — optional wrapper for tracking cross-group dependencies.
 *                       When provided, group-scoped values are wrapped by it.
 *
 * Returns the Set of nodes whose state changed (for notify).
 */
export function recomputeLeaves(
  computeNodes: ComputeEntry[],
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  // ── Phase 1: recompute computed values ───────────────────────────────────
  const computedEntries = computeNodes.filter(({ node }) => typeof node.value === "function");
  const changed = new Set<object>();

  if (computedEntries.length > 0) {
    const sorted = topologicalSortComputed(computedEntries);

    for (const { node } of sorted) {
      // Group-scoped values: the parent object from nodeSlot, so the computed
      // function works in terms of its group rather than the global root.
      const groupValues = valuesCache.nodeSlot.get(node)?.parent ?? valuesCache.values;
      const currentValues = trackingWrap ? trackingWrap(node, groupValues) : groupValues;

      const state = nodeState.get(node);
      if (!state) continue; // Node not initialized yet — skip silently; Phase 2 falls back to prev?.value ?? "".

      // Compute the new value from the current snapshot.
      // node.value here is a selector like (values) => values.a + values.b.
      const computedValue = (node.value as (values: Record<string, unknown>) => unknown)(currentValues);

      // Reference comparison (===): the computed function must return a stable
      // reference when the content is unchanged; otherwise Phase 2 needlessly
      // recomputes downstream nodes.
      if (state && state.value !== computedValue) {
        nodeState.set(node, { ...state, value: computedValue });
        // Mutate valuesCache.values in place via the slot (O(1)) so nodes later
        // in the topological order already see the updated value.
        updateValuesCacheEntry(valuesCache, node, computedValue);
        changed.add(node);
      }
    }
  }

  // ── Phase 2: recompute FieldState (flags, validation, strings) ───────────

  for (const { node } of computeNodes) {
    const prev = nodeState.get(node);
    // `prev.value` is taken verbatim (null included — a filter field declared
    // as `brand: null` must stay null); "" is only the no-state fallback.
    const currentValue = prev === undefined ? "" : prev.value;
    // Preserve revalidate flag: skip validation when revalidate is false
    const revalidate = prev?.revalidate ?? false;
    // Group-scoped values: config functions see their own group's values, not
    // the global root — isVisible/validate/value are written in terms of the
    // current context regardless of nesting depth.
    const groupValues = valuesCache.nodeSlot.get(node)?.parent ?? valuesCache.values;
    const allValues = trackingWrap ? trackingWrap(node, groupValues) : groupValues;
    const next = computeFieldState(node, currentValue, allValues, revalidate, translate);

    // Preserve management flags that computeFieldState doesn't produce
    if (prev?.submitting !== undefined) next.submitting = prev.submitting;
    if (prev?.dirty !== undefined) next.dirty = prev.dirty;
    if (prev?.revalidate !== undefined) next.revalidate = prev.revalidate;

    if (prev && !fieldStateChanged(prev, next)) continue;

    nodeState.set(node, next);
    changed.add(node);
  }

  return changed;
}
