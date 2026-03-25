import type { AnyConfigNode } from "./types";
import type { FieldState } from "../compute/index";
import { captureInitialValues } from "../dirtyTracking/captureInitialValues";
import { mergeInitialValues } from "../dirtyTracking/mergeInitialValues";
import { collectInitialSnapshot } from "../dirtyTracking/collectInitialSnapshot";

/**
 * Encapsulates dirty tracking state for the store.
 *
 * Owns the `initialValueMap` WeakMap and provides methods to:
 * - `capture`: record current node values as the baseline (called after init/reset)
 * - `merge`: update baseline from a resolve result patch
 * - `recompute`: recompute dirty flags for the whole tree
 * - `collectSnapshot`: read a subtree's initial snapshot (used by reset)
 */
export class DirtyTracker {
  private readonly _initialValues = new WeakMap<object, unknown>();

  /** Capture initial values for all leaf nodes. Called after init and after reset with explicit values. */
  capture(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>): void {
    captureInitialValues(node, nodeState, this._initialValues);
  }

  /** Merge a resolver result patch into the initial snapshot (makes resolver data part of baseline). */
  merge(
    node: AnyConfigNode,
    nodeState: WeakMap<object, FieldState>,
    patch: Record<string, unknown>,
  ): void {
    mergeInitialValues(node, nodeState, this._initialValues, patch);
  }

  /** Collect initial snapshot for a subtree — used by reset to restore to initial state. */
  collectSnapshot(node: AnyConfigNode): Record<string, unknown> {
    return collectInitialSnapshot(node, this._initialValues);
  }

  /**
   * Raw WeakMap — retained for backward compatibility with existing deps interfaces
   * (ResetDeps, DirtyDeps, ResolveDeps) that still accept `initialValueMap` directly.
   * @internal
   */
  get initialValueMap(): WeakMap<object, unknown> {
    return this._initialValues;
  }
}
