import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify as _recomputeAndNotify } from "../compute/recompute";
import { recomputeTargeted, collectGroupComputeNodes, recomputeLeaves } from "../compute/recompute";
import { ProxyBuilder } from "../buildProxy/buildProxy";
import { PersistManager } from "../persist/persistManager";
import { ResetPipeline } from "../resetPipeline/resetPipeline";
import { SubmitPipeline } from "../submitPipeline/submitPipeline";
import type { SubmitResult } from "../submitPipeline/submitPipeline";
import { OnChangePipeline } from "../onChangePipeline/onChangePipeline";
import { WritePipeline } from "../writePipeline/writePipeline";
import { formatPatch } from "../writePipeline/writePipeline";
import { NotificationHub } from "../init/createNotificationHub";
import { ResolveManager } from "../init/createResolveManager";
import type { NotifyFn } from "../resolvePipeline";
import { buildValuesCache, updateValuesCacheEntry } from "../valuesCache/valuesCache";
import type { ValuesCache } from "../valuesCache/valuesCache";
import { NodeRegistry } from "./NodeRegistry/nodeRegistry";
import { ServiceRegistry } from "./serviceRegistry";
import { DirtyTracker } from "./dirtyTracker";
import { GroupDepsMap } from "./groupDepsMap";
import { EntityRegistry } from "../entityRegistry";
import { generateTmpId } from "../entityRegistry";
import type { EntityData } from "../entityRegistry";
import type { EntityNode } from "../entityRegistry/types";
import { isLeafNode, isListNode, isGroupNode, configKeys } from "../traversal";
import { normalizeConfig } from "../normalizeConfig";
import { initFlows } from "../flow/flowNavigation";

import type {
  AnyConfigNode,
  DeepPartialValues,
  ExtractValues,
  FieldMapping,
  ListState,
  ProxyStore,
  ProxyStoreOptions,
  RawStoreProxy,
  TranslateFn,
  Unsubscribe,
} from "./types";
import type { MappableKey } from "../constants";
import { FILTER_SPREAD_KEYS, PAGINATION_SPREAD_KEYS, SORT_SPREAD_KEYS } from "../constants";
import type { FieldState } from "../compute/index";
import {
  clearFamilies,
  deleteIdEverywhere,
  rekeyPagination,
} from "../pagination/paginationController";
import { seedFamilyFromWindow } from "../pagination/paginationPersist";

// ─── Palistor ─────────────────────────────────────────────────────────────────

/**
 * The public form class. Acts as the DI container for all internal
 * subsystems and implements the public `ProxyStore` interface.
 *
 * @example
 * const store = new Palistor({ config: myConfig, initialValues: {...} });
 * store.proxy.email.value = "test@example.com";
 * store.submit();
 */
export class Palistor<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  const TMapping extends FieldMapping = {},
> implements ProxyStore<TConfig, TMapping> {
  // ─── @internal subsystems ─────────────────────────────────────────────────

  /** @internal Node registry: nodeState, nodePaths, nodeParents, computeNodes, groupComputeMap, proxyCache. */
  readonly nodes: NodeRegistry;

  /** @internal Global services: translator, notifier and their delegates. */
  readonly services: ServiceRegistry;

  /** @internal Dirty-flag tracking. */
  readonly dirty: DirtyTracker;

  /** @internal Mutable values cache. */
  readonly values: ValuesCache;

  /** @internal Cross-group dependency map. */
  readonly groupDepsMap: GroupDepsMap;

  /** @internal Registry of entity objects. */
  readonly entityRegistry: EntityRegistry;

  /**
   * @internal Plain POJO mirrors for each entity — used in valuesCache.values
   * (list arrays) and nodeSlot for O(1) updates.
   * Key: entityId, Value: plain object `{ id, field1, field2, ... }`.
   */
  readonly entityProjectionObjs: Map<string, Record<string, unknown>> = new Map();

  /** @internal Notification system: versions, subscriptions, post-notify hook. */
  readonly hub: NotificationHub;

  /** @internal Resolve subsystem manager. */
  readonly resolveManager: ResolveManager;

  // ─── @internal pipeline classes ──────────────────────────────────────────

  /** @internal Write pipeline. */
  readonly writePipeline: WritePipeline;

  /** @internal Reset pipeline. */
  readonly resetPipeline: ResetPipeline;

  /** @internal Submit pipeline. */
  readonly submitPipeline: SubmitPipeline;

  /** @internal onChange pipeline. */
  readonly onChangePipeline: OnChangePipeline;

  /** @internal ProxyBuilder. */
  readonly proxyBuilder: ProxyBuilder;

  // ─── Private data ─────────────────────────────────────────────────────────

  /** @internal Root config, immutable. */
  readonly rootConfig: AnyConfigNode;

  /**
   * @internal internal → external rename map (sparse).
   * Projects keys on proxy output (ownKeys/spread).
   */
  readonly fieldMapping: FieldMapping;

  /**
   * @internal Reverse map, external → internal (sparse).
   * Translates incoming keys on proxy input (GET/SET/tracking).
   */
  readonly externalToInternal: Record<string, string>;

  private readonly _proxy: RawStoreProxy<TConfig, TMapping>;
  private readonly _persist: PersistManager;

  /**
   * Non-reactive context — arbitrary data available via `store.context`.
   * Set via `setContext()` or the `useStoreContext()` hook.
   */
  private _context: Record<string, unknown> = {};

  // ─── Constructor ──────────────────────────────────────────────────────────

  constructor(options: ProxyStoreOptions<TConfig, TMapping>) {
    const { config, initialValues = {} } = options;

    // ─── Field mapping (two projections of the map) ──────────────────────────
    // fwd: internal → external (for ownKeys/spread).
    // externalToInternal: external → internal (for GET/SET/tracking).
    // Both are empty when fieldMapping is not provided → `?? key` returns the
    // key as-is → zero overhead by default.
    const fwd: FieldMapping = options.fieldMapping ?? {};
    this.fieldMapping = fwd;
    this.externalToInternal = {};
    for (const internal in fwd) {
      const external = fwd[internal as MappableKey];
      if (external !== undefined) this.externalToInternal[external] = internal;
    }

    // Reserved list-proxy keys (filter surface + the future sort block): these
    // are matched RAW on the list proxy, so a fieldMapping renaming anything TO
    // one of them would silently rewrite the read into a miss — throw instead.
    for (const external of Object.keys(this.externalToInternal)) {
      if (
        FILTER_SPREAD_KEYS.includes(external) ||
        SORT_SPREAD_KEYS.includes(external) ||
        PAGINATION_SPREAD_KEYS.includes(external)
      ) {
        throw new Error(
          `[palistor] fieldMapping renames "${this.externalToInternal[external]}" to "${external}", ` +
            `which is a reserved list key (${[...FILTER_SPREAD_KEYS, ...SORT_SPREAD_KEYS, ...PAGINATION_SPREAD_KEYS].join(", ")}).`,
        );
      }
    }

    // ─── Config normalization (external → internal) ──────────────────────────
    // The config is authored in PUBLIC (mapped) names. A single pass converts
    // it to internal names BEFORE init/compute/traversal — everything below
    // works with internal names unchanged. Empty map → the original config is
    // returned without copying (zero overhead).
    const rootConfig = normalizeConfig(config, this.externalToInternal, fwd) as AnyConfigNode;
    this.rootConfig = rootConfig;

    // ─── Services ────────────────────────────────────────────────────────────

    this.services = new ServiceRegistry();
    const { translate, notify } = this.services;

    // ─── NodeRegistry ────────────────────────────────────────────────────────

    this.nodes = new NodeRegistry(rootConfig, initialValues as Record<string, unknown>, translate);
    this.nodes.setKernel(this);
    const { nodeState, nodePaths, nodeParents, computeNodes } = this.nodes;

    // ─── DirtyTracker + ValuesCache ──────────────────────────────────────────

    this.dirty = new DirtyTracker();
    this.values = buildValuesCache(rootConfig, nodeState, this.nodes.listStates);

    // ─── EntityRegistry ──────────────────────────────────────────────────────

    this.entityRegistry = new EntityRegistry();

    // Register all list states so EntityRegistry.rekey() can update itemIds
    for (const ls of this.nodes.allListStates) {
      this.entityRegistry.registerList(ls);
    }

    // ─── GroupDepsMap + first recompute ──────────────────────────────────────

    this.groupDepsMap = new GroupDepsMap(rootConfig, nodePaths, nodeParents);
    this.recompute(); // first full recompute — builds the dependency map
    this.dirty.capture(rootConfig, nodeState);

    // Filter fields live outside rootConfig — seed their dirty baseline
    // explicitly (dirty.capture walks the config tree only).
    for (const ls of this.nodes.allListStates) {
      const fs = ls.filter;
      if (!fs) continue;
      for (const rt of fs.fields.values()) {
        this.dirty.initialValueMap.set(rt.node, nodeState.get(rt.node)?.value);
      }
    }

    // ─── NotificationHub ────────────────────────────────────────────────────

    this.hub = new NotificationHub({ computeNodes, nodePaths });

    // ─── ResolveManager ──────────────────────────────────────────────────────

    this.resolveManager = new ResolveManager({
      rootConfig,
      nodeState,
      recompute: () => this.recompute(),
      notifyChanged: (c) => this.notifyChanged(c),
      notify,
      initialValueMap: this.dirty.initialValueMap,
      valuesCache: this.values,
      store: this,
      listStates: this.nodes.listStates,
      allListStates: this.nodes.allListStates,
      setEntitiesRaw: (items, listNode) => this._setEntitiesRaw(items, listNode),
      syncListValuesCache: (listState) => this.syncListValuesCache(listState),
      entityRegistry: this.entityRegistry,
    });

    // ─── Pipeline classes ─────────────────────────────────────────────────────

    this.writePipeline = new WritePipeline(this);
    this.resetPipeline = new ResetPipeline(this);
    this.submitPipeline = new SubmitPipeline(this);
    this.onChangePipeline = new OnChangePipeline(this);
    this.proxyBuilder = new ProxyBuilder(this);

    this._proxy = this.proxyBuilder.build(rootConfig) as RawStoreProxy<TConfig, TMapping>;

    // ─── PersistManager ───────────────────────────────────────────────────────

    this._persist = new PersistManager(this);

    // ─── Wire resolve retrigger ──────────────────────────────────────────────

    const postNotifyHook = this.resolveManager.createPostNotifyHook();
    if (postNotifyHook) this.hub.setPostNotifyHook(postNotifyHook);

    // ─── Initial context ─────────────────────────────────────────────────────

    if (options.context) {
      this._context = options.context;
    }

    // ─── Flow: entry lifecycle of the first step ─────────────────────────────
    // The first step of every flow is "entered" at store creation:
    // onEnter → resolve (eager) → onReady. Runs before launchEager so the flow
    // itself triggers the step's idle resolve and attaches onReady correctly.

    initFlows(this);

    // ─── Launch eager resolvers ──────────────────────────────────────────────

    this.resolveManager.launchEager();
  }

  // ─── @internal facade methods ─────────────────────────────────────────────

  /**
   * Recompute node state.
   *
   * - `changedNodes` provided and non-empty → targeted recompute (fast)
   * - otherwise → full recompute of the whole tree (init, reset, resolve completion)
   *
   * The first call without changedNodes builds the group dependency map.
   *
   * @internal
   */
  recompute(changedNodes?: Set<object>): Set<object> {
    const { nodeState, nodePaths, nodeParents, groupComputeMap } = this.nodes;
    const { translate } = this.services;

    // Tracking must stay active on EVERY recompute, not only the first full
    // one. A cross-group read that lives inside a conditional branch which is
    // inactive at init (e.g. isVisible reads another group's field only in the
    // "courier" branch) is not observed during the first recomputeAll, so its
    // donor→recipient edge is missing. It can only be discovered later, when
    // the branch first runs during a targeted recompute — hence the wrap is
    // passed to both paths. The dependency set (`groupDeps`) grows monotonically.
    const trackingWrap = this.groupDepsMap.getTrackingWrap();

    if (changedNodes && changedNodes.size > 0) {
      const result = recomputeTargeted(changedNodes, {
        rootConfig: this.rootConfig,
        groupComputeMap,
        nodeState,
        nodeParents,
        nodePaths,
        groupDeps: this.groupDepsMap.deps,
        valuesCache: this.values,
        translate,
        trackingWrap,
      });
      // Filter groups live outside rootConfig ($filters.*), so the targeted
      // path's resolveGroupByPath can't reach them — recompute a filter group
      // directly when one of its own fields changed (derived fields update).
      for (const ls of this.nodes.allListStates) {
        const fs = ls.filter;
        if (!fs) continue;
        let touched = false;
        for (const n of changedNodes) {
          if (fs.nodeSet.has(n)) { touched = true; break; }
        }
        if (!touched) continue;
        const entries = groupComputeMap.get(fs.groupNode) ?? [];
        const filterChanged = recomputeLeaves(entries, nodeState, this.values, translate, trackingWrap);
        for (const n of filterChanged) result.add(n);
      }
      return result;
    }

    const computeNodes = collectGroupComputeNodes(this.rootConfig, groupComputeMap);
    // Filter groups are outside the rootConfig walk — append their entries so
    // a full recompute (init, reset, resolve completion) covers derived filter fields.
    for (const ls of this.nodes.allListStates) {
      const fs = ls.filter;
      if (!fs) continue;
      const entries = groupComputeMap.get(fs.groupNode);
      if (entries) computeNodes.push(...entries);
    }
    const result = recomputeLeaves(computeNodes, nodeState, this.values, translate, trackingWrap);
    this.groupDepsMap.markBuilt();
    return result;
  }

  /**
   * Notify subscribers about changed nodes.
   * Recomputes dirty flags and bumps versions.
   *
   * @internal
   */
  notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed as Set<AnyConfigNode>, {
      rootConfig: this.rootConfig,
      nodeState: this.nodes.nodeState as WeakMap<AnyConfigNode, FieldState>,
      initialValueMap: this.dirty.initialValueMap as WeakMap<AnyConfigNode, unknown>,
      listStates: this.nodes.listStates as WeakMap<AnyConfigNode, ListState>,
      nodeParents: this.nodes.nodeParents as WeakMap<AnyConfigNode, AnyConfigNode>,
      nodePaths: this.nodes.nodePaths as WeakMap<AnyConfigNode, string>,
    });
  }

  // ─── @internal pipeline methods ───────────────────────────────────────────

  /** @internal Apply a bulk patch to a node (single recompute + notify). */
  setValuesNode(node: AnyConfigNode, patch: Record<string, unknown>): void {
    const formatted = formatPatch(node, patch, this.values.values);
    const changed = applyPatch(node, this.nodes.nodeState, formatted, new Set(), this.values);
    _recomputeAndNotify(changed, () => this.recompute(), (c) => this.notifyChanged(c));
  }

  // ─── ProxyStore — public API ──────────────────────────────────────────────

  get proxy(): RawStoreProxy<TConfig, TMapping> {
    return this._proxy;
  }

  get context(): Record<string, unknown> {
    return this._context;
  }

  setContext(ctx: Record<string, unknown>): void {
    const changedKeys = new Set<string>();
    for (const key of Object.keys(ctx)) {
      if (this._context[key] !== ctx[key]) changedKeys.add(key);
    }

    this._context = { ...this._context, ...ctx };

    if (changedKeys.size > 0) {
      const changedPaths = new Set<string>();
      for (const key of changedKeys) changedPaths.add(`$context.${key}`);
      this.resolveManager.retriggerByPaths(changedPaths);
    }
  }

  get persist(): PersistManager {
    return this._persist;
  }

  subscribe(node: object, listener: () => void): Unsubscribe {
    return this.hub.subscribe(node as AnyConfigNode, listener);
  }

  subscribeGlobal(listener: () => void): Unsubscribe {
    return this.hub.subscribeGlobal(listener);
  }

  getVersion(): number {
    return this.hub.getVersion();
  }

  getNodeVersion(node: object): number {
    return this.hub.getNodeVersion(node as AnyConfigNode);
  }

  getValues(): ExtractValues<TConfig> {
    const clone = structuredClone(this.values.values) as Record<string, unknown>;
    // $filters is view state, not form data — never part of getValues/submit/persist.
    delete clone["$filters"];
    return clone as ExtractValues<TConfig>;
  }

  setTranslator(t: TranslateFn | null): void {
    if (this.services.setTranslator(t)) this.hub.bumpLeafVersions();
  }

  setNotifier(fn: NotifyFn | null): void {
    this.services.setNotifier(fn);
  }

  submit(): Promise<SubmitResult> {
    return this.submitPipeline.execute(this.rootConfig);
  }

  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void {
    this.resetPipeline.execute(this.rootConfig, values as Record<string, unknown> | undefined);
  }

  setValues(patch: DeepPartialValues<ExtractValues<TConfig>>): void {
    this.setValuesNode(this.rootConfig, patch as Record<string, unknown>);
  }

  /**
   * Create or update an entity (or an array of entities) in the registry.
   *
   * - If no entity with the id exists — it is created and its leaf nodes registered.
   * - If it exists — recursive merge; updated leaf nodes are marked as changed.
   * - Batch mode: an array of entities is processed in one recompute + notifyChanged.
   */
  set(data: EntityData | EntityData[]): void {
    const items = Array.isArray(data) ? data : [data];
    const changed = this._setEntitiesRaw(items);

    if (changed.size === 0) return;
    const recomputed = this.recompute(changed);
    // Merge original changed: entity leaves have no computed props,
    // so recomputed may be empty — still need to notify about the entity values.
    for (const n of changed) recomputed.add(n);
    this.notifyChanged(recomputed);
  }

  /**
   * Rename an entity: move it from oldId to newId.
   *
   * - Updates EntityRegistry (entities Map, bindings, resolvedCache, id leaf value).
   * - Updates itemIds in all ListState objects.
   * - Updates entityProjectionObjs (moves the POJO mirror).
   * - Notifies subscribers about the id leaf change.
   *
   * No-op when no entity with oldId exists.
   */
  rekey(oldId: string, newId: string): void {
    const entity = this.entityRegistry.get(oldId);
    if (!entity) return;

    // EntityRegistry.rekey() updates: entities Map, id.value, bindings, resolvedCache, allRegisteredLists.itemIds
    this.entityRegistry.rekey(oldId, newId);

    // Move entityProjectionObjs entry
    const projObj = this.entityProjectionObjs.get(oldId);
    if (projObj) {
      this.entityProjectionObjs.delete(oldId);
      this.entityProjectionObjs.set(newId, projObj);
    }

    // Notify: id leaf changed
    const idLeaf = entity.id as object;
    const changed = new Set<object>([idLeaf]);
    // Update nodeState value for id leaf
    const leafState = this.nodes.nodeState.get(idLeaf);
    if (leafState) {
      this.nodes.nodeState.set(idLeaf, { ...leafState, value: newId });
      if (projObj) projObj["id"] = newId;
    }
    // Paginated lists: the registry rewrote only the visible window — reach
    // every cached page (ids + initialIds, with confirmed-add promotion).
    for (const ls of this.nodes.allListStates) {
      if (!ls.pagination || ls.ownerEntity !== null) continue;
      if (rekeyPagination(ls, oldId, newId)) {
        this.syncListValuesCache(ls);
        changed.add(ls as unknown as object);
        changed.add(ls.listConfigNode as object);
      }
    }
    // Paginated NESTED instances (the registry never registers per-entity lists).
    this.entityRegistry.forEachEntityList((owner, ls) => {
      if (!ls.pagination) return;
      if (rekeyPagination(ls, oldId, newId)) {
        this.syncListValuesCache(ls);
        changed.add(ls as unknown as object);
        changed.add(owner as unknown as object);
      }
    });
    const recomputed = this.recompute(changed);
    for (const n of changed) recomputed.add(n);
    this.notifyChanged(recomputed);
  }

  /**
   * Delete an entity from the registry by ID.
   *
   * - Removes the entity's leaf nodes from NodeRegistry (computeNodes, groupComputeMap).
   * - Clears bindings and resolvedCache.
   * - Notifies subscribers.
   *
   * No-op when the entity does not exist.
   */
  delete(id: string): void {
    const entityNode = this.entityRegistry.get(id);
    if (!entityNode) return;

    // Cascade-delete child entities owned by this entity.
    // Copy the set — childrenByOwner is mutated during the recursive delete.
    const childIds = this.entityRegistry.getChildrenByOwner(id);
    if (childIds && childIds.size > 0) {
      for (const childId of [...childIds]) {
        this.delete(childId);
      }
    }

    // Remove the id from every list membership that still references it —
    // root/config lists plus the owner's per-entity list — mirroring the
    // itemIds maintenance rekey() already does. Without this the id stays in
    // itemIds while syncListValuesCache silently drops it from getValues(),
    // so length/items/dirty disagree. Captured BEFORE entityRegistry.delete()
    // clears the owner pointer.
    const affectedLists = new Set<ListState>();
    for (const ls of this.nodes.allListStates) {
      // Paginated: the id may sit on an off-screen cached page — splice it out
      // of every page of every family (server-truth accounting included), then
      // the window re-projects.
      if (ls.pagination && ls.ownerEntity === null) {
        if (deleteIdEverywhere(ls, id)) affectedLists.add(ls);
        continue;
      }
      const idx = ls.itemIds.indexOf(id);
      if (idx >= 0) {
        ls.itemIds.splice(idx, 1);
        affectedLists.add(ls);
      }
    }
    const owner = entityNode.owner;
    if (owner) {
      const ownerNode = this.entityRegistry.get(owner.ownerId);
      const ownerList = ownerNode?.lists?.get(owner.ownerListNode);
      if (ownerList && !ownerList.pagination) {
        const idx = ownerList.itemIds.indexOf(id);
        if (idx >= 0) {
          ownerList.itemIds.splice(idx, 1);
          affectedLists.add(ownerList);
        }
      }
    }
    // Paginated nested instances: the id may sit on an off-screen cached page
    // of any owner's list (re-parenting leaves the old copy behind) — splice
    // it out everywhere, server-truth accounting included.
    this.entityRegistry.forEachEntityList((_o, ls) => {
      if (ls.pagination && deleteIdEverywhere(ls, id)) affectedLists.add(ls);
    });
    // The deleted entity's own paginated lists die with it — release their
    // retention timers so a cache eviction never outlives its owner.
    if (entityNode.lists) {
      for (const ls of entityNode.lists.values()) {
        if (ls.pagination) clearFamilies(ls);
      }
    }

    // Collect all leaf nodes of the entity
    const deletedLeaves = new Set<object>();
    this.collectEntityLeaves(entityNode, deletedLeaves);

    // Remove leaf nodes from NodeRegistry (prevents a memory leak)
    for (const leaf of deletedLeaves) {
      this.nodes.unregisterLeaf(leaf);
    }

    // Cleanup per-entity field resolve states
    this.resolveManager.cleanupEntityResolveStates(id);

    // Remove the entity from the registry (clears bindings + resolvedCache)
    this.entityRegistry.delete(id);

    // Drop the plain projection object (rekey() cleans its old key the same
    // way; without this the Map grows unboundedly under entity churn)
    this.entityProjectionObjs.delete(id);

    // Re-sync affected lists and include them in the notification, keyed the
    // same way list mutations notify: the ListState (tracking key) + the
    // listConfigNode (backward-compat bridge)
    for (const ls of affectedLists) {
      this.syncListValuesCache(ls);
      deletedLeaves.add(ls as unknown as object);
      deletedLeaves.add(ls.listConfigNode as object);
    }

    this.notifyChanged(deletedLeaves);
  }

  /**
   * Clear the resolved cache for an entity (all templates or a specific one).
   *
   * - `invalidate(id)` — clear the whole cache for the entity
   * - `invalidate(id, templateNode)` — clear only for that specific pair
   *
   * On the next mount of useForm(entity, template) the resolve re-runs.
   */
  invalidate(id: string, templateNode?: object): void {
    this.entityRegistry.clearResolved(id, templateNode);
  }

  /**
   * Submit an entity through a template.
   * Called from EntityProjectionProxy.submit().
   *
   * 1. submitting: true → notify
   * 2. Validation via template field rules (validate)
   * 3. templateNode.onSubmit(entityProxy, store)
   * 4. templateNode.afterSubmit(result, { reset })
   * 5. submitting: false → notify
   *
   * @internal
   */
  async executeEntityTemplateSubmit(
    entityId: string,
    templateNode: AnyConfigNode,
    entityProxy: object,
  ): Promise<SubmitResult> {
    const entityNode = this.entityRegistry.get(entityId);
    if (!entityNode) {
      return {
        success: false,
        errors: [{ path: "", message: `Entity "${entityId}" not found` }],
      };
    }

    // Binding state { loading, submitting } for the (entityId, templateNode)
    // pair — read by EntityProjectionProxy to render a spinner in the UI.
    const bindingState = this.resolveManager.entityStates.getOrCreate(entityId, templateNode as object);
    const entityNodeObj = entityNode as unknown as object;

    bindingState.submitting = true;
    this.notifyChanged(new Set<object>([entityNodeObj]));

    try {
      // Validation — recursively walk template fields and call validate() on
      // every leaf that has one. Current values come from the entity's nodeState.
      const errors: Array<{ path: string; message: string }> = [];
      this.collectEntityTemplateErrors(
        templateNode,
        entityNode as unknown as Record<string, unknown>,
        errors,
        "",
      );

      if (errors.length > 0) {
        return { success: false, errors };
      }

      // User onSubmit(entityProxy, store) — typically the API call.
      let result: unknown;
      if (typeof templateNode.onSubmit === "function") {
        result = await (
          templateNode.onSubmit as (
            proxy: object,
            store: unknown,
          ) => Promise<unknown> | unknown
        )(entityProxy, this);
      }

      if (typeof templateNode.afterSubmit === "function") {
        const reset = () => void 0; // entity template has no built-in reset
        await (
          templateNode.afterSubmit as (
            r: unknown,
            actions: { reset: () => void },
          ) => void | Promise<void>
        )(result, { reset });
      }

      return { success: true, result };
    } finally {
      // Always clear submitting, even when onSubmit/afterSubmit throws.
      bindingState.submitting = false;
      this.notifyChanged(new Set<object>([entityNodeObj]));
    }
  }

  // ─── Private entity helpers ──────────────────────────────────────────────

  /**
   * Upsert entities in EntityRegistry and register/update their leaf nodes.
   * Returns Set of changed leaf nodes. Does NOT call recompute or notifyChanged.
   *
   * Used internally by `set()` and by `executeListResolve` via the
   * `setEntitiesRaw` callback in ResolveManagerDeps.
   *
   * When `listNode` is provided, triggers entity field resolves for
   * each template field entry belonging to that list.
   *
   * @internal
   */
  _setEntitiesRaw(items: EntityData[], listNode?: object): Set<object> {
    const changed = new Set<object>();

    for (const item of items) {
      // Create a new EntityNode or update the existing one (recursive merge).
      // When item.id is missing, EntityRegistry generates a temporary _tmp_* id.
      const entityNode = this.entityRegistry.upsert(item);
      const entityId = entityNode.id.value as string;
      // All entity nodes live in the "_entity_." namespace, isolated from form config nodes.
      const entityPrefix = `_entity_.${entityId}`;

      // projectionObj — the entity's plain-POJO mirror { id, field1, field2 }.
      // Used in valuesCache.values as a list array element.
      // The POJO's referential identity survives upserts; only values change.
      let projectionObj = this.entityProjectionObjs.get(entityId);
      if (!projectionObj) {
        projectionObj = {};
        this.entityProjectionObjs.set(entityId, projectionObj);
      }

      // DFS over the entity tree: register new leaf nodes
      // or detect changes in existing ones.
      this.walkAndSyncEntityNode(entityNode, entityPrefix, entityNode, changed, projectionObj);

      // Entity field resolves are lazy-only: triggered when a component first reads
      // field.value or field.loading (via queueMicrotask in buildEntityProjectionProxy).
      // This avoids N×M concurrent requests for large lists where N = entities, M = resolve fields.
    }

    return changed;
  }

  /**
   * Sync valuesCache with list membership — a SINGLE method (root + per-entity).
   *
   * Branches on `listState.ownerEntity`:
   *   - `null`  → root: write the array of POJO mirrors into the config node's
   *     `nodeSlot` (`valuesCache.values.users = [{id:"u1",…}, …]` — the same
   *     array that `proxy.users.value` reads, so React sees the update);
   *   - entity  → per-entity: materialize the membership into the owner's
   *     projectionObj at the list path (`["contacts"]` or `["profile","contacts"]`).
   *     This includes the nested list in `store.getValues()` — the owner's
   *     projectionObj is referenced by the root list array, and child
   *     projectionObjs materialize their lists recursively.
   *
   * No-op when the slot/path/owner projectionObj is missing.
   *
   * @internal
   */
  syncListValuesCache(listState: ListState): void {
    const materialized = listState.itemIds
      .map((id) => this.entityProjectionObjs.get(id))
      .filter((obj): obj is Record<string, unknown> => obj !== undefined);

    if (listState.ownerEntity === null) {
      // Root: the valuesCache slot ({ parent, key } pair) keyed by config node.
      const slot = this.values.nodeSlot.get(listState.listConfigNode);
      if (!slot) return;
      slot.parent[slot.key] = materialized;
      return;
    }

    // Per-entity: descend to the parent POJO along the path and write the membership.
    const listConfigNode = listState.listConfigNode;
    const path = this.nodes.listFieldKeys.get(listConfigNode);
    if (!path || path.length === 0) return;

    const ownerId = this._entityId(listState.ownerEntity);
    const projectionObj = this.entityProjectionObjs.get(ownerId);
    if (!projectionObj) return;

    let target = projectionObj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      let next = target[k];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        next = {};
        target[k] = next;
      }
      target = next as Record<string, unknown>;
    }
    target[path[path.length - 1]] = materialized;
  }

  /** @internal Current entity id (accounts for rekey via nodeState). */
  private _entityId(entity: EntityNode): string {
    const idLeaf = entity.id as object;
    return (
      (this.nodes.nodeState.get(idLeaf) as { value: unknown } | undefined)?.value ??
      entity.id.value
    ) as string;
  }


  /**
   * Restore the membership of root AND per-entity lists from a values
   * snapshot (persist hydrate).
   *
   * `applyPatch` skips list nodes, so list membership is restored in a
   * separate pass: for every list field we create child entities, set the
   * owner reference (for nested ones), fill `itemIds`/`initialItemIds` and
   * sync valuesCache. Handles nested-of-nested recursively.
   *
   * Returns the set of changed nodes for a subsequent notify.
   *
   * @internal
   */
  restoreLists(
    values: Record<string, unknown>,
    paginationBlobs?: Record<string, unknown>,
  ): Set<object> {
    const changed = new Set<object>();
    this._restoreListsRec(this.rootConfig, values, null, changed, "", paginationBlobs);
    return changed;
  }

  private _restoreListsRec(
    configNode: AnyConfigNode,
    valueObj: Record<string, unknown> | undefined,
    ownerEntity: EntityNode | null,
    changed: Set<object>,
    parentPath = "",
    paginationBlobs?: Record<string, unknown>,
  ): void {
    for (const key of configKeys(configNode as Record<string, unknown>)) {
      const child = (configNode as Record<string, unknown>)[key];
      if (!child || typeof child !== "object") continue;

      // Nested group (not a list): recurse to reach the lists inside it.
      if (!Array.isArray(child)) {
        if (isGroupNode(child as object)) {
          const nested = valueObj?.[key];
          if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            this._restoreListsRec(
              child as AnyConfigNode,
              nested as Record<string, unknown>,
              ownerEntity,
              changed,
              parentPath ? `${parentPath}.${key}` : key,
              paginationBlobs,
            );
          }
        }
        continue;
      }

      if (!isListNode(child as object)) continue;

      const arr = valueObj?.[key];
      if (!Array.isArray(arr)) continue;

      const listConfigNode = child as object;
      const template = (child as unknown[])[0] as AnyConfigNode;
      const ids: string[] = [];

      for (const itemObj of arr) {
        if (!itemObj || typeof itemObj !== "object") continue;
        const rawId = (itemObj as { id?: unknown }).id;
        const id =
          typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
        const flat = this._stripListFields(
          { ...(itemObj as Record<string, unknown>), id },
          template,
        );
        const leafChanged = this._setEntitiesRaw([flat]);
        for (const n of leafChanged) changed.add(n);
        ids.push(id);

        const childEntity = this.entityRegistry.get(id);
        if (childEntity) {
          if (ownerEntity) {
            this.entityRegistry.setEntityOwner(
              childEntity,
              this._entityId(ownerEntity),
              listConfigNode,
            );
          }
          // Recurse into this item's nested lists.
          this._restoreListsRec(
            template,
            itemObj as Record<string, unknown>,
            childEntity,
            changed,
          );
        }
      }

      if (ownerEntity) {
        const els = this.entityRegistry.getOrCreateEntityListState(
          ownerEntity,
          listConfigNode,
          this.nodes.listFieldKeys.get(listConfigNode)?.join("."),
        );
        if (els.pagination) {
          // Paginated nested instance: no blob is persisted for it — the
          // restored array bootstraps a synthesized stale family (rule 6)
          // and the first fetch RECONCILES it instead of replacing it.
          const seeded = seedFamilyFromWindow(this, els, ids, undefined);
          for (const n of seeded) changed.add(n);
          changed.add(ownerEntity as unknown as object);
        } else {
          els.itemIds = ids;
          els.initialItemIds = [...ids];
        }
        this.syncListValuesCache(els);
        changed.add(els as unknown as object);
      } else {
        const listState = this.nodes.listStates.get(listConfigNode);
        if (listState) {
          if (listState.pagination) {
            // Paginated root list: file the window under its page + pointer
            // (or synthesize a stale family when the blob is absent/untrusted).
            const listPath = parentPath ? `${parentPath}.${key}` : key;
            const seeded = seedFamilyFromWindow(this, listState, ids, paginationBlobs?.[listPath]);
            for (const n of seeded) changed.add(n);
          } else {
            listState.itemIds = ids;
            listState.initialItemIds = [...ids];
          }
          this.syncListValuesCache(listState);
          // ListState is the tracking key; listConfigNode is the backward-compat bridge.
          changed.add(listState as unknown as object);
          changed.add(listConfigNode);
        }
      }
    }
  }

  /**
   * Return a shallow copy of an entity data object without list fields
   * (their membership is restored separately via EntityListState). Otherwise
   * `createEntityNode` would ingest the array as a regular leaf value.
   */
  private _stripListFields(
    itemObj: Record<string, unknown>,
    template: AnyConfigNode,
  ): EntityData {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(itemObj)) {
      const tField = (template as Record<string, unknown> | undefined)?.[key];
      if (Array.isArray(tField)) continue; // skip list fields
      result[key] = itemObj[key];
    }
    return result as EntityData;
  }

  /**
   * Recursive walk over an entity node: registers new leaf nodes via
   * `registerDynamicLeaf` and accumulates changed ones in `changed`.
   *
   * Also maintains the entity projection POJO (projectionObj):
   * - New leaf nodes: register nodeSlot → projectionObj
   * - Existing leaf nodes: updated via updateValuesCacheEntry
   *
   * @param node          Current entity node being walked
   * @param prefix        Dot-path of the current node (e.g. "_entity_.u1")
   * @param parent        Parent object (for leaf registration)
   * @param changed       Accumulated set of changed nodes
   * @param projectionObj Plain POJO at the current nesting level for valuesCache
   */
  private walkAndSyncEntityNode(
    node: Record<string, unknown>,
    prefix: string,
    parent: object,
    changed: Set<object>,
    projectionObj?: Record<string, unknown>,
  ): void {
    // Register the group node's dot-path (e.g. "_entity_.u1", "_entity_.u1.address").
    // nodePaths is used by the compute subsystem to determine a leaf's "group"
    // (getNodeGroupPath) and during targeted recompute.
    if (!this.nodes.nodePaths.has(parent)) {
      this.nodes.nodePaths.set(parent, prefix);
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      // Skip primitives (not part of the entity tree)
      if (!child || typeof child !== "object") continue;

      const childObj = child as object;
      const childPath = `${prefix}.${key}`;

      if (isLeafNode(childObj)) {
        // ── Leaf node (EntityLeafNode): { value: <current value> } ──
        const leaf = childObj as { value: unknown };
        if (!this.nodes.nodeState.has(childObj)) {
          // First encounter of this leaf — register in NodeRegistry:
          // - nodeState: holds FieldState (value, isVisible, dirty, etc.)
          // - nodePaths: node → dot-path mapping
          // - nodeParents: node → parent group mapping
          // Entity leaves are always visible, never required/disabled.
          this.nodes.registerDynamicLeaf(childObj, childPath, parent, {
            value: leaf.value,
            isVisible: true,
            isRequired: false,
            isDisabled: false,
            isReadOnly: false,
            dirty: false,
            revalidate: false,
          });
          // Seed initialValueMap so recomputeDirtyTargeted compares against the entity's
          // loaded value instead of `undefined` — prevents spurious dirty=true on first load.
          this.dirty.initialValueMap.set(childObj, leaf.value);
          // Bind the leaf to the POJO mirror via nodeSlot. Subsequent
          // updateValuesCacheEntry(node, newValue) calls update the
          // projectionObj value automatically in O(1).
          if (projectionObj !== undefined) {
            this.values.nodeSlot.set(childObj, { parent: projectionObj, key });
            projectionObj[key] = leaf.value;
          }
          changed.add(childObj);
        } else {
          // Leaf already registered — check whether the value changed.
          // Happens on repeated upserts (entity refresh from the server).
          const state = this.nodes.nodeState.get(childObj)!;
          if (state.value !== leaf.value) {
            // Raw write to nodeState (bypasses writePipeline on purpose)
            state.value = leaf.value;
            updateValuesCacheEntry(this.values, childObj, leaf.value);
            changed.add(childObj);
          }
          // Unchanged values stay out of `changed` — subscribers are not notified.
        }
      } else {
        // ── Group node (EntityGroupNode): nested object without "value" ──
        // e.g. address: { city: { value: "Moscow" } }
        // Create a nested POJO in projectionObj (if needed) and recurse.
        let nestedProjectionObj: Record<string, unknown> | undefined;
        if (projectionObj !== undefined) {
          if (!projectionObj[key] || typeof projectionObj[key] !== "object") {
            projectionObj[key] = {};
          }
          nestedProjectionObj = projectionObj[key] as Record<string, unknown>;
        }
        this.walkAndSyncEntityNode(
          child as Record<string, unknown>,
          childPath,
          childObj,
          changed,
          nestedProjectionObj,
        );
      }
    }
  }

  /**
   * Recursively collect all leaf nodes from an entity node tree.
   * Used by `delete()` to clean up NodeRegistry.
   */
  private collectEntityLeaves(
    node: Record<string, unknown>,
    result: Set<object>,
  ): void {
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (!child || typeof child !== "object") continue;
      if (isLeafNode(child as object)) {
        result.add(child as object);
      } else {
        this.collectEntityLeaves(child as Record<string, unknown>, result);
      }
    }
  }

  /**
   * Collect validation errors for entity-template fields.
   * Iterates template fields recursively, calls templateField.validate() with
   * current entity values.
   *
   * @internal
   */
  private collectEntityTemplateErrors(
    templateNode: AnyConfigNode,
    entityNode: Record<string, unknown>,
    errors: Array<{ path: string; message: string }>,
    parentPath: string,
  ): void {
    const translate = this.services.translate;
    // Plain values object passed as the second argument to every validate(),
    // so validators can check cross-field dependencies, e.g.:
    // validate: (v, vals) => vals.password !== vals.confirmPassword ? "Mismatch" : undefined
    const entityValues = this.buildEntityValuesForTemplate(entityNode);

    for (const key of configKeys(templateNode as Record<string, unknown>)) {
      const templateField = (templateNode as Record<string, unknown>)[key];
      if (!templateField || typeof templateField !== "object") continue;

      // Dot-path for the error message (e.g. "address.city")
      const path = parentPath ? `${parentPath}.${key}` : key;

      if (isLeafNode(templateField as object)) {
        if (typeof (templateField as Record<string, unknown>).validate === "function") {
          // Current value: nodeState first (post write-pipeline), falling back
          // to entityField.value when the node is not registered yet.
          const entityField = entityNode[key];
          const currentValue =
            entityField && typeof entityField === "object"
              ? (
                  this.nodes.nodeState.get(entityField as object) as
                    | { value: unknown }
                    | undefined
                )?.value ?? (entityField as { value: unknown }).value
              : undefined;

          // validate(currentValue, allEntityValues, translateFn):
          // a string is an error message; undefined/false means valid.
          const result = (
            (templateField as Record<string, unknown>).validate as (
              v: unknown,
              vals: Record<string, unknown>,
              t: (...args: unknown[]) => string,
            ) => string | undefined | false
          )(currentValue, entityValues, translate);

          if (result) errors.push({ path, message: result });
        }
      } else {
        // Template group — recurse into the matching nested entity node.
        // Template and entity share the same nesting structure.
        const entityField = entityNode[key];
        if (entityField && typeof entityField === "object") {
          this.collectEntityTemplateErrors(
            templateField as AnyConfigNode,
            entityField as Record<string, unknown>,
            errors,
            path,
          );
        }
      }
    }
  }

  /**
   * Build flat values object from entity node, reading from nodeState.
   * Used in template validators (collectEntityTemplateErrors).
   *
   * @internal
   */
  private buildEntityValuesForTemplate(
    entityNode: Record<string, unknown>,
  ): Record<string, unknown> {
    // Result shape: { id: "u1", name: "Alice", address: { city: "Moscow" } }
    const values: Record<string, unknown> = {};
    for (const key of Object.keys(entityNode)) {
      const field = entityNode[key];
      if (field && typeof field === "object") {
        if (isLeafNode(field as object)) {
          // Leaf: read value from nodeState (current), fall back to field.value
          values[key] =
            (this.nodes.nodeState.get(field as object) as { value: unknown } | undefined)?.value ??
            (field as { value: unknown }).value;
        } else {
          values[key] = this.buildEntityValuesForTemplate(field as Record<string, unknown>);
        }
      }
    }
    return values;
  }
}
