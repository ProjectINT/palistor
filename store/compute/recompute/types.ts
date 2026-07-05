import type { FieldState } from "../index";
import type { AnyConfigNode, TranslateFn } from "../../store/types";
import type { GroupComputeMap } from "../../store/registerNodes";
import type { ValuesCache } from "../../valuesCache/valuesCache";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Wrapper for tracking cross-group dependencies.
 * Takes a node (to determine the recipient group) and raw values,
 * returns the same values wrapped in a tracking proxy.
 */
export type TrackingWrap = (node: object, values: Record<string, unknown>) => Record<string, unknown>;

/**
 * Dependencies for a targeted recompute.
 */
export interface RecomputeTargetedDeps {
  rootConfig: AnyConfigNode;
  groupComputeMap: GroupComputeMap;
  nodeState: WeakMap<object, FieldState>;
  nodeParents: WeakMap<object, object>;
  nodePaths: WeakMap<object, string>;
  groupDeps: Set<string>;
  valuesCache: ValuesCache;
  translate: TranslateFn;
}
