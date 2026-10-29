// ─────────────────────────────────────────────────────────────────────────────
// Cube: Palistor rebuilt around one primitive, on classes and getters, without
// Proxy. What is reproduced here:
//   • config tree → cube tree; leaf / group / list are one class
//     (a list is a thin subclass that makes its children from an array)
//   • value / onValueChange, formatter → setter → onChange (write pipeline)
//   • computed flags and strings (isVisible, isRequired, label, …) with AUTO
//     dependency tracking, instead of groupDeps / dependencies / topologicalSort / recompute*
//   • validate + isRequired, revalidate after the first failed submit
//   • dirty, values (live snapshot with a stable reference), getValues (clone)
//   • submit (beforeSubmit → onSubmit → afterSubmit), reset, setValues
//   • resolve: optimistic + real, lazy start, restart on dependency change.
//     The same resolve resolves either information (leaf) or cubes (group/list)
//   • lists over the entity registry: one row, many views
//   • subscriptions + useForm with targeted re-render
// Deliberately NOT here: pagination, filter/sort, flow, persist, fieldMapping,
// i18n, suspense, retry, notifier, context. Those are modules around the core.
// ─────────────────────────────────────────────────────────────────────────────

import { childKeys, type CubeConfig, type MaybeFn, type Resolve, type SubmitResult, type Translate, type Values } from "./config";
import { Memo } from "./memo";
import { Registry } from "./registry";
import { observe, track, type Observer } from "./track";

type ListFactory = (template: CubeConfig, resolve: Resolve | undefined, parent: Cube, key: string) => Cube;
let createList: ListFactory | null = null;

/** Called by listCube.ts, so that Cube builds list children without importing its own subclass. */
export function registerList(factory: ListFactory) { createList = factory; }

const flag = (v: MaybeFn<boolean> | undefined, values: Values, t: Translate, dflt: boolean) =>
  v === undefined ? dflt : typeof v === "function" ? v(values, t) : v;

const str = (v: MaybeFn<string> | undefined, values: Values, t: Translate) =>
  typeof v === "function" ? v(values, t) : v;

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export class Cube {
  // ── 1. Nested cubes ──────────────────────────────────────────────────────
  readonly children = new Map<string, Cube>();
  readonly parent: Cube | null;
  readonly root: Cube;
  readonly key: string;

  /**
   * Live snapshot of the subtree's values. Stable reference, one getter per
   * child. Reading values.email tracks only email: exactly what Palistor's
   * groupDeps + createValuesTrackingProxy exist for. JSON.stringify and spread
   * work through the getters, so the object can be handed to an API as is.
   */
  readonly values: Values = {};

  // ── 2. Information ───────────────────────────────────────────────────────
  private _value: unknown;
  private _initial: unknown;
  /** Version: grows on any change of the cube OR its descendants (bump goes up). */
  version = 0;

  // ── 3. Behavior ──────────────────────────────────────────────────────────
  private readonly memos = new Map<string, Memo<any>>();
  private _submitting = false;
  private _revalidate = false;
  private rs?: { status: "idle" | "pending" | "done" | "error"; error?: unknown; deps: Map<Cube, number> };

  // Root services (unused on other cubes, see the getters below).
  private readonly _registry?: Registry;
  private readonly _listeners?: Set<() => void>;
  private readonly _resolving?: Set<Cube>;
  t: Translate = (k) => k;

  /** List item: id of the registry row its leaves read from and write to. */
  entityId?: string;

  constructor(readonly config: CubeConfig, parent: Cube | null = null, key = "") {
    this.parent = parent;
    this.root = parent ? parent.root : this;
    this.key = key;
    if (!parent) {
      this._registry = new Registry();
      this._listeners = new Set();
      this._resolving = new Set();
    }

    this._initial = this._value = typeof config.value === "function" ? undefined : config.value;

    // Children become properties: form.address.city without Proxy. A getter,
    // not a value, so that reaching a child wakes the group's lazy resolve
    // (like GET in Palistor). The price is the same reserved names (a child
    // called `submit` is impossible).
    for (const k of childKeys(config)) {
      const sub = config[k] as CubeConfig | [CubeConfig, { resolve?: Resolve }?];
      const child = Array.isArray(sub) ? makeList(sub[0], sub[1]?.resolve, this, k) : new Cube(sub, this, k);
      this.children.set(k, child);
      Object.defineProperty(this, k, { enumerable: true, get: () => { this.touchResolve(); return child; } });
      Object.defineProperty(this.values, k, { enumerable: true, get: () => child.value });
    }

    if (config.resolve) {
      this.rs = { status: "idle", deps: new Map() };
      this.root.resolving.add(this);
      if (config.resolve.lazy === false) this.runResolve();
    }
  }

  get isLeaf() { return "value" in this.config; }
  get registry(): Registry { return this.root._registry!; }
  private get listeners() { return this.root._listeners!; }
  private get resolving() { return this.root._resolving!; }

  /** Value scope for validate/isVisible/…: the nearest list item or the root. */
  get scope(): Cube {
    let c: Cube = this;
    while (c.parent && c.entityId === undefined) c = c.parent;
    return c;
  }

  // ── value: read ──────────────────────────────────────────────────────────

  get value(): any {
    track(this);
    this.touchResolve();
    if (!this.isLeaf) return this.values;
    if (typeof this.config.value === "function") {
      // a computed leaf is just another memo, no dependencies/topo-sort
      return this.memo("value", () => (this.config.value as Function)(this.scope.values));
    }
    const row = this.row();
    return row ? row[this.key] : this._value;
  }

  /** A leaf inside a list item keeps its value not on itself but in the registry row. */
  private row(): Values | undefined {
    const id = this.scope.entityId;
    return id === undefined ? undefined : this.registry.get(id);
  }

  // ── value: write (Palistor's write pipeline one-to-one) ──────────────────

  set value(raw: unknown) { this.write(raw, false); }
  readonly onValueChange = (v: unknown) => { this.value = v; };

  private write(raw: unknown, silent: boolean) {
    const { formatter, setter } = this.config;
    const values = this.scope.values;
    const prev = this.isLeaf ? (this.row() ? this.row()![this.key] : this._value) : undefined;
    const next = !silent && formatter ? formatter(raw, values) : raw;        // 1. formatter
    if (Object.is(prev, next)) return;

    const row = this.row();
    if (row) { row[this.key] = next; this.registry.set(row); } else this._value = next; // 2. store
    this.bump();                                                               // 3. version++ up the tree
    if (!silent && setter) this.parent?.patch(setter(next, values, prev), true); // 4. setter → patch siblings
    if (!silent) this.emitChange(this.key, next, prev);                        // 5. onChange up the group chain
    this.root.notify();                                                        // 6. subscribers (+ resolve restart)
  }

  /** setValues: bulk patch without formatter/setter/onChange. */
  patch(values: Values | void, silent = true) {
    if (!values) return;
    for (const k in values) {
      const child = this.children.get(k);
      if (!child) continue;
      if (child.isLeaf) child.write(values[k], silent);
      else child.assign(values[k], silent);
    }
  }
  setValues(values: Values) { this.patch(values, true); }

  /** How a parent's patch writes this subtree. Group → patch children; list → setItems. */
  protected assign(value: unknown, silent: boolean) { this.patch(value as Values, silent); }

  /** How a parent's getValues snapshots this subtree. */
  protected snapshot(forSubmit: boolean): unknown { return this.getValues(forSubmit); }

  bump() {
    for (let c: Cube | null = this; c; c = c.parent) c.version++;
  }

  private emitChange(fieldKey: string, newValue: unknown, previousValue: unknown) {
    for (let g = this.parent; g; g = g.parent) {
      const r = g.config.onChange?.({ fieldKey, newValue, previousValue, allValues: g.values });
      if (r) Promise.resolve(r).then((p) => g.patch(p)); // fire-and-forget, as in Palistor
    }
  }

  // ── Computed state: every getter is a lazy memo with auto-tracking ──────

  private memo<T>(name: string, fn: () => T): T {
    let m = this.memos.get(name);
    if (!m) this.memos.set(name, (m = new Memo(fn)));
    return m.get();
  }

  get isVisible()  { return this.memo("isVisible",  () => flag(this.config.isVisible,  this.scope.values, this.root.t, true)); }
  get isRequired() { return this.memo("isRequired", () => flag(this.config.isRequired, this.scope.values, this.root.t, false)); }
  get isDisabled() { return this.memo("isDisabled", () => flag(this.config.isDisabled, this.scope.values, this.root.t, false)); }
  get isReadOnly() { return this.memo("isReadOnly", () => flag(this.config.isReadOnly, this.scope.values, this.root.t, false)); }
  get label()       { return this.memo("label",       () => str(this.config.label,       this.scope.values, this.root.t)); }
  get placeholder() { return this.memo("placeholder", () => str(this.config.placeholder, this.scope.values, this.root.t)); }
  get description() { return this.memo("description", () => str(this.config.description, this.scope.values, this.root.t)); }

  /** The error is always computed (submit needs it) but SHOWN only after revalidate. */
  private get rawError(): string | undefined {
    return this.memo("rawError", () => {
      if (!this.isLeaf) {
        for (const c of this.children.values()) if (c.isVisible && c.rawError) return c.rawError;
        return undefined;
      }
      const v = this.value;
      if (this.isRequired && isEmpty(v)) return "required";
      const r = this.config.validate?.(v, this.scope.values, this.root.t);
      return r || undefined;
    });
  }

  get revalidate(): boolean {
    track(this);
    return this._revalidate || (this.parent?.revalidate ?? false);
  }
  get errorMessage() { return this.revalidate ? this.rawError : undefined; }
  get isInvalid()    { return this.revalidate ? this.rawError !== undefined : undefined; }

  get dirty(): boolean {
    track(this);
    if (this.isLeaf) return !Object.is(this.value, this._initial);
    for (const c of this.children.values()) if (c.dirty) return true;
    return false;
  }

  get submitting() { track(this); return this._submitting; }

  // ── submit / reset ───────────────────────────────────────────────────────

  async submit(): Promise<SubmitResult> {
    this._revalidate = true;
    this.bump();
    const errors = this.collectErrors();
    if (errors.length) { this.root.notify(); return { success: false, errors }; }

    this._submitting = true; this.bump(); this.root.notify();
    try {
      let payload = this.isLeaf ? this.value : this.getValues(true);
      if (this.config.beforeSubmit) payload = this.config.beforeSubmit(payload, this.scope.values);
      const result = await this.config.onSubmit?.(payload, this.root);
      await this.config.afterSubmit?.(result, { reset: () => this.reset() });
      return { success: true, result };
    } finally {
      this._submitting = false; this.bump(); this.root.notify();
    }
  }

  private collectErrors(path: string[] = []): Array<{ path: string; message: string }> {
    if (!this.isVisible) return [];
    if (this.isLeaf) return this.rawError ? [{ path: path.join("."), message: this.rawError }] : [];
    const out: Array<{ path: string; message: string }> = [];
    for (const [k, c] of this.children) out.push(...c.collectErrors([...path, k]));
    return out;
  }

  reset(values?: Values) {
    const defaults = values ?? (this.config.reset ? this.config.reset(this.defaults()) : this.defaults());
    this.walk((c) => { c._revalidate = false; c.rs && (c.rs.status = "idle"); });
    this.patch(defaults, true);
    this.walk((c) => { if (c.isLeaf) c._initial = c.value; }); // new baseline for dirty
    this.root.notify();
  }

  private defaults(): Values {
    const out: Values = {};
    for (const [k, c] of this.children) out[k] = c.isLeaf ? c._initial : c.defaults();
    return out;
  }

  /** Detached deep clone (store.getValues()). forSubmit → applies the leaves' beforeSubmit. */
  getValues(forSubmit = false): Values {
    const out: Values = {};
    for (const [k, c] of this.children) {
      if (c.isLeaf) out[k] = forSubmit && c.config.beforeSubmit ? c.config.beforeSubmit(c.value, c.scope.values) : c.value;
      else out[k] = c.snapshot(forSubmit);
    }
    return out;
  }

  walk(fn: (c: Cube) => void) {
    fn(this);
    for (const c of this.children.values()) c.walk(fn);
  }

  // ── resolve: one mechanism for information and for cubes ─────────────────
  // Leaf → the result becomes value. Group → the result patches children.
  // List → the result becomes items (see ListCube.apply).

  get loading() { track(this); this.touchResolve(); return this.rs?.status === "pending"; }
  get error()   { track(this); return this.rs?.error; }
  reload()      { if (this.rs) this.runResolve(); }

  /** Lazy start: the first read of value/loading on a cube with resolve starts it. */
  private touchResolve() {
    if (this.rs?.status === "idle" && this.config.resolve!.lazy !== false) this.runResolve();
  }

  private runResolve() {
    const { resolver, optimisticResolver } = this.config.resolve!;
    const rs = this.rs!;
    const obs: Observer = { deps: new Set() };
    rs.status = "pending"; // before the optimistic apply: its write must not restart us via notify
    rs.error = undefined;

    // Optimistic: synchronously, right now.
    if (optimisticResolver) this.apply(observe(obs, () => optimisticResolver(this.scope.values)), false);
    this.bump();
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(observe(obs, () => resolver(this.scope.values, this.root)));
    } catch (e) {
      pending = Promise.reject(e);
    }

    // Dependencies are whatever the resolver read before its first await. Reads
    // after an await need a values object bound to obs rather than to `current`:
    // exactly what createContextTrackingProxy does, only on defineProperty.
    rs.deps = new Map([...obs.deps].map((c) => [c, c.version]));

    pending
      .then(
        (r) => { this.apply(r, true); rs.status = "done"; },
        (e) => { rs.error = e; rs.status = "error"; },
      )
      .finally(() => { this.bump(); this.root.notify(); });
  }

  /** Restart resolve if the version of at least one dependency has moved. */
  private checkDeps() {
    const rs = this.rs;
    if (!rs || rs.status === "pending") return;
    for (const [c, v] of rs.deps) if (c.version !== v) { this.runResolve(); return; }
  }

  protected apply(result: unknown, captureInitial: boolean) {
    if (this.isLeaf) {
      this.write(result, true);
      if (captureInitial) this._initial = this.value;
    } else {
      this.patch(result as Values, true);
      if (captureInitial) this.walk((c) => { if (c.isLeaf) c._initial = c.value; });
    }
  }

  // ── Subscriptions (root only) ────────────────────────────────────────────

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  notify() {
    for (const c of this.resolving) c.checkDeps();
    this.listeners.forEach((fn) => fn());
  }
}

function makeList(template: CubeConfig, resolve: Resolve | undefined, parent: Cube, key: string): Cube {
  if (!createList) throw new Error("cube/core: list children need ListCube; import the core through cube/core/index.ts");
  return createList(template, resolve, parent, key);
}
