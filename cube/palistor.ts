import { Cube, Hub, cubeOf, type CubeConfig, type NotifyFn, type Registry, type SubmitResult, type Translate, type Values } from "./core";
import { notImplemented } from "./notImplemented";

export interface PalistorOptions {
  config: CubeConfig;
  initialValues?: Values;
  context?: Record<string, unknown>;
  fieldMapping?: Record<string, string>;
}

/**
 * The `new Palistor({ config })` store surface over a root Cube. Whatever the
 * core doesn't cover yet throws NotImplementedError, so the contract tests
 * list the remaining work.
 */
export class Palistor {
  /** @internal */
  readonly hub = new Hub();
  /** @internal */
  readonly root: Cube;

  constructor(options: PalistorOptions) {
    if (options.fieldMapping) notImplemented("option `fieldMapping`");
    const hub = this.hub;
    hub.store = this;
    this.root = new Cube(options.config, null, "", hub);
    if (options.initialValues) this.root.seed(options.initialValues);
    this.root.settleComputed();
    if (options.context) hub.context = options.context;
    hub.settle();
    for (const rs of hub.resolving) if (!rs.lazy) rs.start();
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

  get persist(): never { return notImplemented("store.persist"); }

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
