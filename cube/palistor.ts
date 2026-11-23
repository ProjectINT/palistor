import {
  Cube, FieldMap, FlowCube, Hub, Persist, applyInitialData, cubeOf, formCube,
  type CubeConfig, type NotifyFn, type Registry, type SubmitResult, type Translate, type Values,
} from "./core";

export interface PalistorOptions {
  config: CubeConfig;
  initialValues?: Values;
  context?: Record<string, unknown>;
  /** One public vocabulary for field-state names (internal → external): the config is written in it, nodes answer it. */
  fieldMapping?: Record<string, string>;
  /**
   * Results the server already has, in the shape of `getValues()`: the tree of
   * values, lists as arrays of rows (nested lists inside the rows), a paginated
   * list as the array or the `{ items, total, nextCursor, hasMore }` of its
   * first page. A node with `resolve` that gets data starts as `resolved`, with
   * the state its resolver's result would have left; it re-runs on its declared
   * `deps` / `contextDeps`, a filter or page-key change, and `reload()`.
   * Constructor only: request data cannot reach a store that outlives the request.
   */
  initialData?: Values;
  /** The translation function, from the first render on (store.setTranslator replaces it later). */
  translator?: Translate;
  /** The notification function resolver `onError` callbacks reach as `ctx.notify` (store.setNotifier replaces it later). */
  notifier?: NotifyFn;
  /**
   * Server mode: the store starts nothing by itself — no resolver, no page
   * fetch, no flow entry — until `start()`. Whatever would have started reads
   * `loading: true`. Default: `typeof window === "undefined"`.
   */
  server?: boolean;
}

/** The `new Palistor({ config })` store surface over a root Cube. */
export class Palistor {
  /** @internal */
  readonly hub = new Hub();
  /** @internal */
  readonly root: Cube;
  /** Hydration and autosave through a storage driver (store.persist). */
  readonly persist: Persist;
  /** @internal The fieldMapping option as passed (internal → external); {} without one. */
  readonly fieldMapping: Record<string, string>;
  /** @internal The reverse map (external → internal). */
  readonly externalToInternal: Record<string, string>;

  constructor(options: PalistorOptions) {
    const hub = this.hub;
    hub.store = this;
    hub.held = options.server ?? typeof window === "undefined";
    const map = new FieldMap(options.fieldMapping ?? {});
    this.fieldMapping = options.fieldMapping ?? {};
    this.externalToInternal = map.e2i;
    if (!map.empty) hub.map = map;
    // Before the tree: computed values and their baseline are evaluated with them.
    if (options.translator) hub.t = options.translator;
    if (options.notifier) hub.notifier = options.notifier;
    if (options.context) hub.context = options.context;
    this.persist = hub.persist = new Persist(hub);
    this.root = formCube(map.normalize(options.config), null, "", hub);
    if (options.initialValues) this.root.seed(options.initialValues);
    if (options.initialData) hub.construct(() => applyInitialData(hub, options.initialData));
    this.root.settleComputed();
    this.root.walk((c) => { if (c instanceof FlowCube) hub.flows.push(c); });
    hub.settle();
    for (const rs of hub.resolving) if (!rs.lazy && rs.status === "idle") hub.deferred.add(rs);
    if (hub.held) {
      // Server mode: the active steps' resolves are marked as the ones start() runs; nothing is called.
      for (const flow of hub.flows) flow.enterCurrent();
    } else this.start();
  }

  /**
   * Runs what the store starts by itself: every flow enters its active step
   * (onEnter → resolve → onReady), then the eager resolves start, as in store.
   * Outside server mode the constructor calls it. In server mode it is the
   * explicit start (a script or a test in Node) and also runs every resolve
   * that was read or asked to run meanwhile. Idempotent.
   */
  start(): void {
    const hub = this.hub;
    if (hub.started) return;
    hub.started = true;
    hub.held = false;
    for (const flow of hub.flows) flow.enterCurrent();
    const due = [...hub.deferred];
    hub.deferred.clear();
    for (const rs of due) if (rs.status !== "pending") rs.start();
  }

  get proxy(): any { return this.root.node; }
  /** The config object the store was built from (store.rootConfig). */
  get rootConfig(): CubeConfig { return this.root.config; }
  /** The entity registry: rows, ownership, template bindings and the resolved cache. */
  get entityRegistry(): Registry { return this.hub.registry; }

  get context(): Record<string, unknown> { return this.hub.context; }
  setContext(ctx: Record<string, unknown>): void { this.hub.setContext(ctx); }

  subscribe(node: object, listener: () => void): () => void {
    const cube = this.cubeFor(node);
    return cube ? this.hub.watch(cube, listener) : () => {};
  }

  subscribeGlobal(listener: () => void) { return this.hub.subscribe(listener); }
  getVersion(): number { return this.hub.cycle; }
  getNodeVersion(node: object): number { return this.cubeFor(node)?.stateVersion() ?? 0; }

  getValues(): Values { return this.root.getValues(); }
  setValues(patch: Values): void { this.root.setValues(patch); }
  submit(): Promise<SubmitResult> { return this.root.submit(); }
  reset(values?: Values): void { this.root.reset(values); }

  setTranslator(t: Translate | null): void { this.hub.setTranslator(t); }
  setNotifier(fn: NotifyFn | null): void { this.hub.notifier = fn; }

  /** Create or update entities (recursive merge; a row without an id gets a `_tmp_` one). One notification. */
  set(data: Values | Values[]): void {
    this.hub.setRows(Array.isArray(data) ? data : [data]);
  }
  /** Move an entity to a new id everywhere it is referenced (lists, views, ownership, bindings). */
  rekey(oldId: string, newId: string): void { this.hub.rekeyEntity(oldId, newId); }
  /** Remove an entity: its owned children go too, every list drops it, its views and resolves are released. */
  delete(id: string): void { this.hub.deleteEntity(id); }
  /** Forget that (entity, template) was resolved, so the next useForm(entity, template) mount resolves again. */
  invalidate(id: string, templateNode?: object): void { this.hub.registry.clearResolved(id, templateNode); }

  /** A config node (store's subscription key) or a public node → its cube. */
  private cubeFor(node: object): Cube | undefined {
    return this.hub.byConfig.get(node) ?? cubeOf(node);
  }
}
