import { Cube, Hub, cubeOf, type CubeConfig, type NotifyFn, type SubmitResult, type Translate, type Values } from "./core";
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
    for (const c of hub.resolving) if (!c.rs!.lazy) c.rs!.start();
  }

  get proxy(): any { return this.root.node; }

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
  /** Upsert rows into the entity registry (flat rows with an id; the rest of store.set is Phase 2.1). */
  set(data: Values | Values[]): void {
    const rows = Array.isArray(data) ? data : [data];
    if (rows.some((r) => r.id == null || r.id === "")) notImplemented("store.set() of a row without id");
    this.hub.batch(() => { for (const r of rows) this.hub.registry.set(r); });
  }
  rekey(_oldId: string, _newId: string): void { notImplemented("store.rekey()"); }
  delete(_id: string): void { notImplemented("store.delete()"); }
  invalidate(_id: string, _templateNode?: object): void { notImplemented("store.invalidate()"); }

  /** A config node (store's subscription key) or a public node → its cube. */
  private cubeFor(node: object): Cube | undefined {
    return this.hub.byConfig.get(node) ?? cubeOf(node);
  }
}
