import type { AnyConfigNode, ListState } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ComputeEntry } from "../store/registerNodes";
import { recomputeDirtyTargeted } from "../dirtyTracking/recomputeDirtyTargeted";

// ─── Types ────────────────────────────────────────────────────────────────

/** Dependencies needed to recompute dirty flags during notification. */
export interface DirtyDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<AnyConfigNode, FieldState>;
  initialValueMap: WeakMap<AnyConfigNode, unknown>;
  /** ListStates for list-membership dirty tracking. */
  listStates?: WeakMap<AnyConfigNode, ListState>;
  nodeParents: WeakMap<AnyConfigNode, AnyConfigNode>;
  nodePaths: WeakMap<AnyConfigNode, string>;
}

export interface NotificationHubDeps {
  computeNodes: ComputeEntry[];
  /** Node → dot-path mapping (filled by buildNodeMaps). */
  nodePaths: WeakMap<object, string>;
}

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * The store's notification system.
 *
 * Consolidates:
 * - per-node and global subscriptions
 * - versioning (global + per-node)
 * - the post-notify hook for external subsystems (resolve re-trigger)
 */
export class NotificationHub {
  private readonly computeNodes: ComputeEntry[];
  private readonly nodePaths: WeakMap<object, string>;

  /** Per-field change subscribers. */
  private readonly nodeListeners = new WeakMap<AnyConfigNode, Set<() => void>>();

  /** Global subscribers — notified on ANY change. */
  private readonly globalListeners = new Set<() => void>();

  /** Global version — incremented on every change. */
  private version = 0;

  /** Per-node versions — for targeted subscriptions. */
  private readonly nodeVersions = new WeakMap<AnyConfigNode, number>();

  /** Hook invoked after every notifyChanged (resolve re-trigger etc.). */
  private postNotifyHook: ((changedPaths: Set<string>) => void) | null = null;

  /**
   * Re-entrancy guard: prevents recursive postNotifyHook invocation.
   * Paths accumulated while a hook is active are deferred and processed
   * sequentially after the current call completes.
   */
  private isDispatchingHook = false;
  private pendingHookPaths: Set<string> | null = null;

  constructor(deps: NotificationHubDeps) {
    this.computeNodes = deps.computeNodes;
    this.nodePaths = deps.nodePaths;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private notifyNode(node: AnyConfigNode): void {
    this.nodeListeners.get(node)?.forEach((fn) => fn());
  }

  private notifyGlobals(): void {
    this.globalListeners.forEach((fn) => fn());
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Process a set of changed nodes:
   * 1. Recompute dirty flags (leaf + group + root)
   * 2. Increment the global version
   * 3. Update per-node versions + notify per-node subscribers
   * 4. Notify global subscribers
   * 5. Invoke the postNotifyHook (resolve re-triggers etc.)
   */
  notifyChanged(changed: Set<AnyConfigNode>, dirtyDeps: DirtyDeps): void {
    if (changed.size === 0) return;

    // Recompute dirty flags targeted to changed nodes only
    const { rootConfig, nodeState, initialValueMap, listStates, nodeParents, nodePaths } = dirtyDeps;
    const dirtyResult = recomputeDirtyTargeted(changed, rootConfig, nodeState, initialValueMap, nodeParents, nodePaths, listStates);
    for (const n of dirtyResult.changed) changed.add(n as AnyConfigNode);

    // Increment the global version
    this.version++;

    // Update the changed nodes' versions + notify per-node subscribers
    for (const node of changed) {
      this.nodeVersions.set(node, this.version);
      this.notifyNode(node);
    }

    this.notifyGlobals();

    // Post-notify hook (resolve re-triggers etc.)
    // Re-entrancy guard: when notifyChanged is called recursively (e.g. from
    // executeListResolve during the postNotifyHook), the paths accumulate and
    // are processed sequentially after the outer call completes.
    if (this.postNotifyHook) {
      const changedPaths = new Set<string>();
      for (const n of changed) {
        const p = this.nodePaths.get(n);
        if (p) changedPaths.add(p);
      }
      if (changedPaths.size > 0) {
        if (this.isDispatchingHook) {
          // Recursive call: defer the paths
          if (!this.pendingHookPaths) this.pendingHookPaths = new Set();
          for (const p of changedPaths) this.pendingHookPaths.add(p);
        } else {
          this.isDispatchingHook = true;
          try {
            this.postNotifyHook(changedPaths);
            // Drain the paths accumulated during the hook invocation
            while (this.pendingHookPaths !== null && this.pendingHookPaths.size > 0) {
              const pending = this.pendingHookPaths;
              this.pendingHookPaths = null;
              this.postNotifyHook(pending);
            }
          } finally {
            this.isDispatchingHook = false;
            this.pendingHookPaths = null;
          }
        }
      }
    }
  }

  /** Subscribe to changes of a specific node. */
  subscribe = (node: AnyConfigNode, listener: () => void): (() => void) => {
    if (!this.nodeListeners.has(node)) this.nodeListeners.set(node, new Set());
    this.nodeListeners.get(node)!.add(listener);
    return () => this.nodeListeners.get(node)!.delete(listener);
  };

  /** Subscribe to any store change. */
  subscribeGlobal = (listener: () => void): (() => void) => {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  };

  /** Global store version. */
  getVersion = (): number => {
    return this.version;
  };

  /** Version of a specific node. */
  getNodeVersion = (node: AnyConfigNode): number => {
    return this.nodeVersions.get(node) ?? 0;
  };

  /**
   * Bump the version of all leaf nodes + notify global subscribers.
   * Used on translator change — all components re-render.
   */
  bumpLeafVersions(): void {
    this.version++;
    for (const { node } of this.computeNodes) {
      this.nodeVersions.set(node, this.version);
    }
    this.notifyGlobals();
  }

  /**
   * Register a hook invoked after every notifyChanged.
   * Receives the set of dot-paths of the changed nodes.
   * Used by the resolve system for dependency-driven re-triggers.
   */
  setPostNotifyHook(hook: ((changedPaths: Set<string>) => void) | null): void {
    this.postNotifyHook = hook;
  }
}

// ─── Deprecated factory alias ────────────────────────────────────────────────

/** @deprecated Use `new NotificationHub(deps)` instead. */
export function createNotificationHub(deps: NotificationHubDeps): NotificationHub {
  return new NotificationHub(deps);
}
