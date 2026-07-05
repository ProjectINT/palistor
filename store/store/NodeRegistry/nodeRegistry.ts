import { type FieldState } from "../../compute/index";
import { registerNodes, type GroupComputeMap, type ComputeEntry, type InitialSlice } from "../registerNodes";
import { buildNodeMaps } from "../nodeMap";
import { initGroupSubmitting } from "../../init/initGroupSubmitting";
import { getNodeGroupPath } from "../../groupDeps/getNodeGroupPath";
import { CONFIG_PROPS } from "../../constants";
import type { AnyConfigNode, TranslateFn, ListState } from "../types";
import { isLeafNode, isGroupNode, isListNode } from "./nodeUtils";
import { type NodeView, type NodeViewKernel, makeIdentityView } from "./nodeView";
import { collectFlowStates, type FlowState } from "../../flow/flowState";

/**
 * Recursively build the reverse index `listConfigNode → fieldPath` for ALL
 * lists in the config, including lists nested inside a list template
 * (per-entity lists) and inside nested groups.
 *
 * The path is stored as an array of keys **relative to the nearest entity
 * scope**:
 * - a list directly under a template → `["contacts"]`;
 * - a list inside a nested group    → `["profile", "contacts"]`.
 * The path resets at every list boundary (`child[0]` opens a new entity
 * scope — its items are separate entities with their own projectionObj).
 * This lets `syncListValuesCache` (per-entity branch) write the membership
 * into the right nested spot of the owner's projectionObj.
 */
function collectListFieldKeys(
  node: AnyConfigNode,
  map: WeakMap<object, string[]>,
  prefix: string[] = [],
): void {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;
    const child = (node as Record<string, unknown>)[key];
    if (!child || typeof child !== "object") continue;

    if (Array.isArray(child)) {
      map.set(child, [...prefix, key]);
      const template = child[0];
      if (template && typeof template === "object") {
        // New entity scope — the path resets.
        collectListFieldKeys(template as AnyConfigNode, map, []);
      }
      continue;
    }

    if (isGroupNode(child as object)) {
      collectListFieldKeys(child as AnyConfigNode, map, [...prefix, key]);
    }
  }
}

/**
 * Registry of config nodes.
 *
 * Bundles the data used by `Palistor`: nodeState, nodePaths, nodeParents,
 * computeNodes, groupComputeMap, proxyCache.
 *
 * Runs initialization (registerNodes + buildNodeMaps + initGroupSubmitting)
 * in the constructor.
 *
 * @internal used by pipelines and subsystems via the kernel
 */
export class NodeRegistry {
  // ─── Initialization ──────────────────────────────────────────────────────

  constructor(
    rootConfig: AnyConfigNode,
    initialValues: Record<string, unknown>,
    translate: TranslateFn,
  ) {
    // Phase 1: register all leaf nodes and set initial values
    registerNodes(
      rootConfig,
      initialValues as InitialSlice<AnyConfigNode>,
      this.computeNodes,
      this.nodeState,
      "",
      this.groupComputeMap,
      translate,
      this.listStates,
      this.allListStates,
    );

    // Phase 2: initialize submitting/dirty/revalidate for groups
    initGroupSubmitting(rootConfig, this.nodeState);

    // Phase 3: build path and parent mappings
    buildNodeMaps(rootConfig, this.nodePaths, this.nodeParents);

    // Phase 4: reverse index listConfigNode → fieldKey, needed to
    // materialize per-entity lists into projectionObj (getValues).
    collectListFieldKeys(rootConfig, this.listFieldKeys);

    // Phase 5 (defineFlow): register FlowState for nodes carrying the
    // __flowSteps marker. Runs after buildNodeMaps — flow node paths are
    // already assigned (needed for the persist snapshot and reset scope).
    collectFlowStates(rootConfig, this);
  }

  // ─── Data ────────────────────────────────────────────────────────────────

  /**
   * Computed state of every config node.
   * Key — the node object, value — its FieldState.
   */
  readonly nodeState: WeakMap<object, FieldState> = new WeakMap();

  /**
   * Absolute dot-path of every config node.
   * e.g. passport.number → "passport.number".
   * The root node has no entry in this map ("" is used).
   */
  readonly nodePaths: WeakMap<object, string> = new WeakMap();

  /**
   * Direct parent of every config node.
   * The root node has no entry.
   */
  readonly nodeParents: WeakMap<object, object> = new WeakMap();

  /**
   * All compute nodes in traversal (DFS) order.
   * Contains leaf nodes and group nodes with computed props.
   * Used by NotificationHub for bumpLeafVersions().
   */
  readonly computeNodes: ComputeEntry[] = [];

  /**
   * Group node → array of its direct child entries (leaves + groups with computed props).
   * Used by recomputeTargeted to recompute a subtree.
   */
  readonly groupComputeMap: GroupComputeMap = new WeakMap();

  /**
   * Proxy object cache — one proxy per config node.
   * Guarantees stable (===) proxy references.
   */
  readonly proxyCache: WeakMap<object, unknown> = new WeakMap();

  /**
   * ListState for every ListNode in the config.
   * Key — the config array object (the ListNode itself).
   * Populated during registerNodes.
   */
  readonly listStates: WeakMap<object, ListState> = new WeakMap();

  /**
   * All ListState objects in registration order.
   * Used by Palistor to register lists in EntityRegistry.rekey().
   */
  readonly allListStates: ListState[] = [];

  /**
   * Single list-proxy cache (root + per-entity) — keyed by the `ListState` object.
   * Guarantees stable list-proxy references for React (like proxyCache for groups).
   * Every (owner, listConfigNode) pair and every root list has its own
   * `ListState`, so keying by it gives correct isolation.
   */
  readonly listProxyCache: WeakMap<object, object> = new WeakMap();

  /**
   * Reverse index `listConfigNode → fieldPath`.
   * The path is an array of keys relative to the owner's entity scope
   * (`["contacts"]`, or `["profile", "contacts"]` for a list in a nested group).
   * Used to write per-entity list membership into the right nested spot of
   * the owner's projectionObj — so `store.getValues()` includes nested lists.
   */
  readonly listFieldKeys: WeakMap<object, string[]> = new WeakMap();

  /**
   * FlowState for every flow node (defineFlow) in the config.
   * Key — the flow's config node. Populated in collectFlowStates.
   */
  readonly flowStates: WeakMap<object, FlowState> = new WeakMap();

  /** All FlowStates in registration order (persist, reset, init lifecycle). */
  readonly allFlowStates: FlowState[] = [];

  /**
   * Reverse index: step config node → FlowState of the owning flow.
   * Used by the group proxy to compute step.status / step.isInvalid.
   */
  readonly stepToFlow: WeakMap<object, FlowState> = new WeakMap();

  /**
   * NodeView per storage node.
   * - Config-mode: populated lazily via getView (identity views cached in _identityViews).
   * - Entity-mode: populated by Palistor._setEntitiesRaw per (entityLeaf, templateField) pair.
   *   Map key = templateField (rules); supports multiple template bindings for one entity leaf.
   */
  readonly nodeViews: WeakMap<object, Map<object, NodeView>> = new WeakMap();

  private _kernel?: NodeViewKernel;
  private readonly _identityViews: WeakMap<object, NodeView> = new WeakMap();

  /** Called by Palistor after construction to wire the kernel reference. */
  setKernel(kernel: NodeViewKernel): void {
    this._kernel = kernel;
  }

  /**
   * Get NodeView for a node.
   * - via absent → identity view (storage === rules === node), cached.
   * - via present → entity view registered by _setEntitiesRaw; throws if not found.
   */
  getView(storage: AnyConfigNode, via?: object): NodeView {
    if (via !== undefined) {
      const view = this.nodeViews.get(storage as object)?.get(via);
      if (!view) {
        throw new Error("[NodeRegistry] NodeView not found for via — register it before calling getView");
      }
      return view;
    }

    let view = this._identityViews.get(storage as object);
    if (!view) {
      if (!this._kernel) {
        throw new Error("[NodeRegistry] getView called before setKernel");
      }
      view = makeIdentityView(storage, this._kernel);
      this._identityViews.set(storage as object, view);
    }
    return view;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  /** Get the computed state of a node. */
  getState(node: object): FieldState | undefined {
    return this.nodeState.get(node);
  }

  /** Set the state of a node. */
  setState(node: object, state: FieldState): void {
    this.nodeState.set(node, state);
  }

  /** Get the absolute dot-path of a node. undefined for the root. */
  getPath(node: object): string | undefined {
    return this.nodePaths.get(node);
  }

  /** Get the direct parent of a node. */
  getParent(node: object): object | undefined {
    return this.nodeParents.get(node);
  }

  /**
   * Get the path of the group a node belongs to.
   * - Leaf node  → the parent group's path
   * - Group node → its own path
   * - Root       → ""
   */
  getGroupPath(node: object): string {
    return getNodeGroupPath(node, this.nodeParents, this.nodePaths);
  }

  /** Find a node by dot-path. Scans computeNodes and checks their paths. */
  findByPath(path: string): object | undefined {
    for (const entry of this.computeNodes) {
      if (entry.path === path) return entry.node;
    }
    return undefined;
  }

  /** Iterate over all compute nodes. */
  forEachCompute(callback: (entry: ComputeEntry) => void): void {
    for (const entry of this.computeNodes) {
      callback(entry);
    }
  }

  isLeafNode = isLeafNode;
  isGroupNode = isGroupNode;
  isListNode = isListNode;

  /**
   * Register a leaf node created at runtime (e.g. an entity leaf on store.set()).
   *
   * Updates all registry WeakMaps and appends an entry to `computeNodes`,
   * so `bumpLeafVersions` (NotificationHub) automatically picks up the new node.
   *
   * @param node    Node object (`{ value }`)
   * @param path    Absolute dot-path, e.g. "users.0.name"
   * @param parent  Direct parent node object
   * @param state   Initial FieldState
   */
  registerDynamicLeaf(
    node: object,
    path: string,
    parent: object,
    state: import("../../compute/index").FieldState,
  ): void {
    const entry: ComputeEntry = { node: node as import("../types").AnyConfigNode, path };
    this.computeNodes.push(entry);
    this.nodeState.set(node, state);
    this.nodePaths.set(node, path);
    this.nodeParents.set(node, parent);
    // groupComputeMap: append to the parent group's list
    let list = this.groupComputeMap.get(parent);
    if (!list) {
      list = [];
      this.groupComputeMap.set(parent, list);
    }
    list.push(entry);
  }

  /**
   * Unregister a leaf node (e.g. when an entity is deleted).
   *
   * Removes the entry from `computeNodes` and from the parent's
   * `groupComputeMap`. WeakMap entries (nodeState, nodePaths, nodeParents)
   * are reclaimed by the GC automatically.
   *
   * @param node  Leaf node object
   */
  unregisterLeaf(node: object): void {
    const idx = this.computeNodes.findIndex((e) => e.node === node);
    if (idx !== -1) {
      this.computeNodes.splice(idx, 1);
    }
    const parent = this.nodeParents.get(node);
    if (parent) {
      const list = this.groupComputeMap.get(parent);
      if (list) {
        const listIdx = list.findIndex((e) => e.node === node);
        if (listIdx !== -1) list.splice(listIdx, 1);
      }
    }
  }
}
