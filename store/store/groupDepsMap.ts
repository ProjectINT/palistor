import type { AnyConfigNode } from "./types";
import { createGroupDeps } from "../groupDeps/createGroupDeps";
import { createTrackingValues } from "../groupDeps/createTrackingValues";
import { getNodeGroupPath } from "../groupDeps/getNodeGroupPath";
import type { TrackingWrap } from "../compute/recompute";
import { isLeafNode } from "../traversal";

/**
 * Map of dependencies between groups.
 *
 * Combines:
 * - a `Set<string>` of donor→recipient pairs (cross-group dependencies)
 * - a tracking-proxy cache and the "dependencies built" flag
 * - the `createTrackingValues` logic during the first full recomputeAll
 *
 * @internal used by `Palistor` and the compute pipelines
 */
export class GroupDepsMap {
  private readonly _deps: Set<string>;
  private readonly _proxyCache = new Map<string, Record<string, unknown>>();
  private _built = false;
  private readonly _nodeParents: WeakMap<object, object>;
  private readonly _nodePaths: WeakMap<object, string>;

  constructor(
    rootConfig: AnyConfigNode,
    nodePaths: WeakMap<object, string>,
    nodeParents: WeakMap<object, object>,
  ) {
    this._deps = createGroupDeps(rootConfig, nodePaths);
    this._nodePaths = nodePaths;
    this._nodeParents = nodeParents;
  }

  /**
   * Raw `Set<string>` of dependency pairs — for compatibility with
   * `recomputeTargeted` and other functions taking `groupDeps` directly.
   * @internal
   */
  get deps(): Set<string> {
    return this._deps;
  }

  /** Whether cross-group dependencies were already built in the first recomputeAll. */
  get isBuilt(): boolean {
    return this._built;
  }

  /**
   * Returns a `TrackingWrap` function that intercepts READ accesses to other
   * groups' values and records the dependencies into `deps`.
   *
   * Use ONLY during the first `recomputeAll` (`isBuilt === false`).
   * Call `markBuilt()` when done.
   *
   * Receives group-scoped values (parent from nodeSlot):
   * - For leaf nodes: values = the parent group's scope,
   *   currentGroupPath = recipientPath (= the parent group's path).
   * - For group nodes (with isVisible etc.): values = the group's parent
   *   scope (grandparent scope), currentGroupPath = the parent's path.
   *   recipientPath is then the group's own path.
   *
   * The cache uses the composite key `currentGroupPath\0recipientPath` to
   * avoid collisions between leaf and group nodes with the same recipientPath.
   */
  getTrackingWrap(): TrackingWrap {
    return (node: object, values: Record<string, unknown>): Record<string, unknown> => {
      const isLeaf = isLeafNode(node);

      // The path of the group UNDER which this compute entry lives in
      // groupComputeMap — that group is what recomputeTargeted recomputes, so
      // it must be the recipient of the cross-group dependency:
      // - a leaf is stored under its parent group → getNodeGroupPath(leaf) = its path;
      // - a group node (isVisible etc.) is also stored under its PARENT group,
      //   so we take the parent's path, not the node's own path. Otherwise the
      //   dependency is recorded on the group's own path, and recomputing that
      //   group only touches its CHILDREN — not its own isVisible entry (which
      //   lives under the parent) — so a neighbor's cross-group isVisible would
      //   never be recomputed.
      // `values` here is the scope of that same parent group, so
      // currentGroupPath (nesting root) equals ownerGroupPath.
      const ownerGroupPath: string = isLeaf
        ? getNodeGroupPath(node, this._nodeParents, this._nodePaths)
        : (() => {
            const parent = this._nodeParents.get(node);
            return parent ? (this._nodePaths.get(parent) ?? "") : "";
          })();

      const cached = this._proxyCache.get(ownerGroupPath);
      if (cached) return cached;

      const proxy = createTrackingValues(values, ownerGroupPath, this._deps, ownerGroupPath);
      this._proxyCache.set(ownerGroupPath, proxy);
      return proxy;
    };
  }

  /**
   * Mark the dependencies as built and release the proxy cache.
   * Called exactly once — after the first full `recomputeAll`.
   */
  markBuilt(): void {
    this._built = true;
    this._proxyCache.clear();
  }
}
