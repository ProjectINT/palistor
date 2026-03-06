import { CONFIG_PROPS } from "./constants";
import type { AnyConfigNode } from "./collectValues";
import type { FieldState } from "./compute";

// ─── Dirty Tracking ──────────────────────────────────────────────────────────

/**
 * Compares two values for dirty checking.
 * Primitives use strict equality. Objects/arrays use JSON.stringify.
 */
function isDirtyValue(current: unknown, initial: unknown): boolean {
  if (current === initial) return false;
  if (current == null && initial == null) return false;
  if (current == null || initial == null) return true;
  if (typeof current !== typeof initial) return true;
  if (typeof current === "object") {
    try {
      return JSON.stringify(current) !== JSON.stringify(initial);
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * Captures initial values for all leaf nodes into a WeakMap.
 * Called at store creation and after reset/hydrate.
 */
export function captureInitialValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
): void {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Leaf node: capture current value as initial
      const state = nodeState.get(child);
      if (state) {
        initialValueMap.set(child, state.value);
      }
    } else {
      // Group node: recurse
      captureInitialValues(child, nodeState, initialValueMap);
    }
  }
}

/**
 * Recursively recomputes dirty flags for all nodes in the tree.
 *
 * - Leaf nodes: dirty = currentValue differs from initial
 * - Group nodes: dirty = any descendant leaf is dirty
 *
 * Updates nodeState in-place and returns the set of nodes whose dirty state changed.
 */
export function recomputeDirty(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
): { anyDirty: boolean; changed: Set<object> } {
  let anyDirty = false;
  const changed = new Set<object>();

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Leaf: compare with initial
      const state = nodeState.get(child);
      if (state) {
        const initial = initialValueMap.get(child);
        const dirty = isDirtyValue(state.value, initial);
        if (state.dirty !== dirty) {
          nodeState.set(child, { ...state, dirty });
          changed.add(child);
        }
        if (dirty) anyDirty = true;
      }
    } else {
      // Group: recurse, then set group dirty
      const result = recomputeDirty(child, nodeState, initialValueMap);
      for (const n of result.changed) changed.add(n);

      const state = nodeState.get(child);
      if (state) {
        if (state.dirty !== result.anyDirty) {
          nodeState.set(child, { ...state, dirty: result.anyDirty });
          changed.add(child);
        }
      }
      if (result.anyDirty) anyDirty = true;
    }
  }

  return { anyDirty, changed };
}

// ─── Revalidate Propagation ──────────────────────────────────────────────────

/**
 * Sets `revalidate` flag on a group node and propagates it to ALL descendants.
 * Both leaf and group children inherit the flag.
 *
 * Returns the set of nodes whose revalidate state changed.
 */
export function setGroupRevalidate(
  node: AnyConfigNode,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  const changed = new Set<object>();

  // Set on the group node itself
  const state = nodeState.get(node);
  if (state && state.revalidate !== revalidate) {
    nodeState.set(node, { ...state, revalidate });
    changed.add(node);
  }

  // Propagate to all children
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Leaf: set revalidate
      const childState = nodeState.get(child);
      if (childState && childState.revalidate !== revalidate) {
        nodeState.set(child, { ...childState, revalidate });
        changed.add(child);
      }
    } else {
      // Group: recurse
      const childChanged = setGroupRevalidate(child, revalidate, nodeState);
      for (const n of childChanged) changed.add(n);
    }
  }

  return changed;
}

// ─── Initial Snapshot Merge ──────────────────────────────────────────────────

/**
 * Incrementally merges initial values from a patch into the initialValueMap.
 * Only updates leaf nodes whose keys are present in the patch.
 *
 * Called after resolver success to make resolver data part of the initial state.
 * Optimistic resolver does NOT call this — only the real resolver result counts.
 */
export function mergeInitialValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const key of Object.keys(patch)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const patchValue = patch[key];

    if ("value" in child) {
      // Leaf node: capture current (post-applyPatch) value as initial
      const state = nodeState.get(child);
      if (state) {
        initialValueMap.set(child, state.value);
      }
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      // Group node: recurse into matching subtree
      mergeInitialValues(child, nodeState, initialValueMap, patchValue as Record<string, unknown>);
    }
  }
}

/**
 * Collects current initial values from the initialValueMap for a subtree.
 * Used by reset to restore fields to their initial state.
 *
 * Stops at reset boundaries (child groups with their own `reset` function).
 * Falls back to config default if a leaf has no entry in initialValueMap.
 */
export function collectInitialSnapshot(
  node: AnyConfigNode,
  initialValueMap: WeakMap<object, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Leaf node: prefer initial snapshot, fallback to config default
      const initial = initialValueMap.get(child);
      if (initial !== undefined) {
        result[key] = initial;
      } else {
        const raw = child.value;
        result[key] = typeof raw === "function" ? "" : raw;
      }
    } else {
      // Group node: stop at reset boundary (child has its own reset)
      if (typeof child.reset === "function") continue;
      result[key] = collectInitialSnapshot(child, initialValueMap);
    }
  }

  return result;
}
