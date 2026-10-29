import { Cube, type CubeConfig, type Values } from "./core";
import { notImplemented } from "./notImplemented";

export interface PalistorOptions {
  config: CubeConfig;
  initialValues?: Values;
  context?: Record<string, unknown>;
  fieldMapping?: Record<string, string>;
}

/**
 * The `new Palistor({ config })` store surface over a root Cube. The proxy
 * *is* the root cube. Whatever the core doesn't cover yet throws
 * NotImplementedError, so the contract tests list the remaining work.
 */
export class Palistor {
  readonly proxy: Cube;

  constructor(options: PalistorOptions) {
    if (options.fieldMapping) notImplemented("option `fieldMapping`");
    if (options.context) notImplemented("option `context`");
    this.proxy = new Cube(options.config);
    if (options.initialValues) this.proxy.reset(options.initialValues);
  }

  getValues(): Values { return this.proxy.getValues(); }
  setValues(patch: Values): void { this.proxy.setValues(patch); }
  submit() { return this.proxy.submit(); }
  reset(values?: Values): void { this.proxy.reset(values); }
  subscribeGlobal(listener: () => void) { return this.proxy.subscribe(listener); }
  getVersion(): number { return this.proxy.version; }

  get context(): Record<string, unknown> { return notImplemented("store.context"); }
  setContext(_ctx: Record<string, unknown>): void { notImplemented("store.setContext()"); }
  get persist(): never { return notImplemented("store.persist"); }
  subscribe(_node: object, _listener: () => void): () => void { return notImplemented("store.subscribe(node)"); }
  getNodeVersion(_node: object): number { return notImplemented("store.getNodeVersion()"); }
  setTranslator(_t: unknown): void { notImplemented("store.setTranslator()"); }
  setNotifier(_fn: unknown): void { notImplemented("store.setNotifier()"); }
  set(_data: Values | Values[]): void { notImplemented("store.set()"); }
  rekey(_oldId: string, _newId: string): void { notImplemented("store.rekey()"); }
  delete(_id: string): void { notImplemented("store.delete()"); }
  invalidate(_id: string, _templateNode?: object): void { notImplemented("store.invalidate()"); }
}
