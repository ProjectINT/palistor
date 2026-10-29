// ─────────────────────────────────────────────────────────────────────────────
// Cube: Palistor rebuilt around one primitive. Leaf, group and list item are
// this class; a list is a thin subclass. Every derived property is a lazy memo
// over versioned sources (track.ts), every mutation bumps a version inside a
// hub batch, and one batch is one notification cycle.
//
// The cube is internal. What user code sees is `cube.node` (node.ts): an
// object whose own enumerable keys are exactly store's spread keys and whose
// children are non-enumerable getters, so class members never shadow config
// children.
// ─────────────────────────────────────────────────────────────────────────────

import {
  childKeys, isDirtyValue, isEmpty, isLeafConfig, isPlainObject, CONFIG_PROPS,
  type CubeConfig, type ListConfig, type SubmitError, type SubmitResult, type Values,
} from "./config";
import type { Hub } from "./hub";
import { Memo } from "./memo";
import { assertChildName, makeNode, type PublicNode } from "./node";
import { ResolveState } from "./resolve";
import { track, untracked, type Source } from "./track";

type ListFactory = (config: ListConfig, parent: Cube, key: string, hub: Hub) => Cube;
let createList: ListFactory | null = null;

/** Called by listCube.ts, so that Cube builds list children without importing its own subclass. */
export function registerList(factory: ListFactory) { createList = factory; }

export type CubeKind = "leaf" | "group" | "list";

export class Cube implements Source {
  version = 0;
  readonly kind: CubeKind;
  /** The list item this cube belongs to (its leaves live in a registry row), if any. */
  readonly item: Cube | null;
  rs?: ResolveState;

  private raw: unknown;
  private initial: unknown;
  private submittingFlag = false;
  private revalidateFlag = false;
  private memos?: Map<string, Memo<unknown>>;
  private sigMemo?: Memo<unknown[]>;
  private lastSig?: unknown[];
  private sv = 0;
  private node_?: PublicNode;
  private values_?: Values;
  private children_?: Map<string, Cube>;
  private fns?: Record<string, (...args: any[]) => any>;

  constructor(
    readonly config: CubeConfig,
    readonly parent: Cube | null,
    readonly key: string,
    readonly hub: Hub,
    /** Set on a list item: id of its registry row. */
    readonly entityId?: string,
    kind?: CubeKind,
  ) {
    this.kind = kind ?? (isLeafConfig(config) ? "leaf" : "group");
    this.item = entityId !== undefined ? this : parent?.item ?? null;
    if (!parent) hub.root = this;
    if (!this.item) hub.byConfig.set(config, this);

    if (this.kind === "leaf") {
      // store seeds `initialValues[key] ?? config.value ?? ""`: null and undefined read as "".
      this.raw = this.initial = typeof config.value === "function" ? undefined : config.value ?? "";
      if (parent?.entityId !== undefined) this.initial = this.peek(); // an item leaf starts from its row
    } else if (this.kind === "group" && entityId === undefined) {
      void this.children; // the form tree is built eagerly; a list item builds its subtree on first use
    }

    const resolve = this.kind === "list" ? (config as unknown as ListConfig)[1]?.resolve : config.resolve;
    if (resolve && typeof resolve.resolver === "function") {
      this.rs = new ResolveState(this, resolve);
      hub.resolving.add(this);
    }
  }

  get node(): PublicNode { return (this.node_ ??= makeNode(this)); }

  get children(): Map<string, Cube> {
    if (this.children_) return this.children_;
    const m = (this.children_ = new Map<string, Cube>());
    if (this.kind === "group") {
      for (const k of checkedChildKeys(this.config, this)) {
        const sub = this.config[k] as CubeConfig | ListConfig;
        m.set(k, Array.isArray(sub) ? makeList(sub, this, k, this.hub) : new Cube(sub, this, k, this.hub));
      }
    }
    return m;
  }

  /** A child only if the subtree is built (registry writes skip list items nobody has opened). */
  builtChild(key: string): Cube | undefined { return this.children_?.get(key); }

  /**
   * Live values of a group: one enumerable getter per child, stable reference.
   * Reading values.email tracks only email. JSON.stringify and spread work
   * through the getters. Built on first use: most list items never need it.
   */
  get values(): Values {
    if (this.values_) return this.values_;
    const v: Values = {};
    for (const [k, child] of this.children) Object.defineProperty(v, k, { enumerable: true, get: () => child.value });
    return (this.values_ = v);
  }

  get path(): string {
    if (!this.parent) return "";
    const p = this.parent.path;
    return p ? `${p}.${this.key}` : this.key;
  }

  /** Values handed to config functions: the parent group's (store's group-scoped values). */
  get scopeValues(): Values {
    const p = this.parent;
    return p && p.kind === "group" ? p.values : this.values;
  }

  /** Values for formatter / label / onChange: the item's inside a list, else the root's. */
  get ctxValues(): Values { return (this.item ?? this.hub.root).values; }

  bump() { this.version++; this.hub.touch(); }

  /** Stable per-cube function (onValueChange, submit, …): one reference for React. */
  fn<F extends (...args: any[]) => any>(name: string, make: () => F): F {
    return ((this.fns ??= {})[name] ??= make()) as F;
  }

  find(path: string): Cube | undefined {
    let c: Cube | undefined = this;
    for (const k of path.split(".")) c = c?.children.get(k);
    return c;
  }

  /** Visits the built subtree: an unopened list item has default state anyway. */
  walk(fn: (c: Cube) => void) {
    fn(this);
    if (this.children_) for (const c of this.children_.values()) c.walk(fn);
  }

  // ── value: read ──────────────────────────────────────────────────────────

  get value(): any {
    track(this);
    if (this.kind !== "leaf") return this.values;
    if (typeof this.config.value === "function") {
      const fn = this.config.value as (v: Values) => unknown;
      return this.memo("value", () => fn(this.scopeValues));
    }
    return this.peek();
  }

  /** The stored value, untracked. */
  peek(): unknown {
    const row = this.row();
    return row && this.key in row ? row[this.key] : this.raw; // a key the row lacks reads the template default
  }

  /** A value for a resolver or getValues: plain, tracked like `value`. */
  snapshotValue(): unknown { return this.value; }

  /** A leaf inside a list item keeps its value in the registry row. */
  private row(): Values | undefined {
    const id = this.parent?.entityId;
    return id === undefined ? undefined : this.hub.registry.get(id);
  }

  // ── value: write (store's write pipeline) ────────────────────────────────

  /** `node.value = raw`: formatter → store → setter → notify → onChange. */
  write(raw: unknown) {
    if (this.kind === "group") return this.setValues(raw as Values);
    const { formatter, setter } = this.config;
    const next = formatter ? formatter(raw, this.ctxValues) : raw;
    const prev = this.peek();
    if (Object.is(prev, next)) {
      console.warn(
        "[Palistor] Write skipped: the value did not change. " +
        "Your app may be doing redundant re-renders, or you may be setting a value during render.",
      );
      return;
    }
    this.hub.batch(() => {
      this.store(next);
      if (!setter) return;
      const patch = setter(next, this.scopeValues, prev);
      if (isPlainObject(patch)) this.parent?.patch(patch);
      else console.error(`[Palistor] setter must return an object, got ${patch === null ? "null" : typeof patch}.`);
    });
    this.fireOnChange(this.peek(), prev);
  }

  private store(next: unknown): boolean {
    if (Object.is(this.peek(), next)) return false;
    const id = this.parent?.entityId;
    if (id !== undefined) this.hub.registry.set({ id, [this.key]: next }); // bumps this leaf in every view
    else { this.raw = next; this.bump(); }
    return true;
  }

  /** Apply a value without formatter / setter / onChange (patch, reset, resolve). */
  assign(v: unknown) {
    if (this.kind === "leaf") this.store(v);
    else if (isPlainObject(v)) this.patch(v);
  }

  /** setValues on a group: formatter per leaf, one notification. */
  setValues(patch: Values) {
    this.hub.batch(() => this.patch(this.format(patch)));
  }

  private format(patch: Values): Values {
    const out: Values = {};
    for (const k in patch) {
      const c = this.children.get(k);
      if (!c || CONFIG_PROPS.has(k)) continue;
      const v = patch[k];
      if (c.kind === "leaf") out[k] = c.config.formatter ? c.config.formatter(v, c.ctxValues) : v;
      else if (c.kind === "group" && isPlainObject(v)) out[k] = c.format(v);
    }
    return out;
  }

  /** store's applyPatch: unknown keys and lists are skipped. */
  patch(patch: Values) {
    this.hub.batch(() => {
      for (const k in patch) {
        const c = this.children.get(k);
        if (!c || c.kind === "list" || CONFIG_PROPS.has(k)) continue;
        c.assign(patch[k]);
      }
    });
  }

  /** onChange on the leaf itself, then on every ancestor group: fire-and-forget, as in store. */
  private fireOnChange(newValue: unknown, previousValue: unknown) {
    const path = this.path;
    for (let target: Cube | null = this; target; target = target.parent) {
      const onChange = target.config.onChange;
      if (typeof onChange !== "function") continue;
      const tp = target.path;
      const fieldKey = target === this ? this.key : tp ? path.slice(tp.length + 1) : path;
      const into = target.kind === "leaf" ? target.parent ?? this.hub.root : target;
      const allValues = this.ctxValues;
      Promise.resolve()
        .then(() => onChange({ fieldKey, newValue, previousValue, allValues }))
        .then((p) => { if (isPlainObject(p) && Object.keys(p).length) into.patch(p); })
        .catch(() => {});
    }
  }

  // ── Computed state: every getter is a lazy memo with auto-tracking ──────

  protected memo<T>(name: string, fn: () => T): T {
    const memos = (this.memos ??= new Map());
    let m = memos.get(name) as Memo<T> | undefined;
    if (!m) memos.set(name, (m = new Memo(fn)));
    return m.get();
  }

  private flag(name: "isVisible" | "isRequired" | "isDisabled" | "isReadOnly", dflt: boolean): any {
    const v = this.config[name];
    if (v === undefined) return dflt;
    if (typeof v !== "function") return v;
    return this.memo(name, () => { track(this.hub.translator); return v(this.scopeValues, this.hub.t); });
  }

  private text(name: "label" | "placeholder" | "description"): string | undefined {
    const v = this.config[name];
    if (typeof v !== "function") return v as string | undefined;
    return this.memo(name, () => { track(this.hub.translator); return v(this.hub.t, this.ctxValues); });
  }

  get isVisible() { return this.flag("isVisible", true); }
  get isRequired() { return this.flag("isRequired", false); }
  get isDisabled() { return this.flag("isDisabled", false); }
  get isReadOnly() { return this.flag("isReadOnly", false); }
  get label() { return this.text("label"); }
  get placeholder() { return this.text("placeholder"); }
  get description() { return this.text("description"); }

  /** The validation message regardless of revalidate (submit needs it). */
  get rawError(): string | undefined {
    if (this.kind === "list") return undefined;
    return this.memo("rawError", () => {
      const value = this.value;
      let message: any;
      const required = this.isRequired;
      if (required && isEmpty(value)) {
        message = typeof this.config.isRequired === "string" ? this.config.isRequired : "required";
      }
      const validate = this.config.validate;
      if (validate) {
        track(this.hub.translator);
        const r = validate(value, this.scopeValues, this.hub.t);
        if (r) message = r;
      }
      return message;
    });
  }

  get revalidate(): boolean { track(this); return this.revalidateFlag; }
  get errorMessage() { return this.revalidate ? this.rawError : undefined; }
  get isInvalid() { return this.revalidate && this.rawError ? true : undefined; }

  get dirty(): boolean {
    track(this);
    if (this.kind === "leaf") return isDirtyValue(this.value, this.initial);
    return this.memo("dirty", () => {
      for (const c of this.children.values()) if (c.dirty) return true;
      return false;
    });
  }

  get submitting(): boolean { track(this); return this.submittingFlag; }

  get loading(): boolean | undefined {
    track(this);
    if (this.rs) return this.rs.status === "pending";
    return this.kind === "leaf" ? undefined : false;
  }

  get error(): unknown { track(this); return this.rs?.error ?? null; }
  get resolveStatus() { track(this); return this.rs?.status ?? "idle"; }

  /** Everything a subscriber can observe on this node, for change detection. */
  protected signature(): unknown[] {
    const sig: unknown[] = [this.dirty, this.submitting, this.revalidate, this.isInvalid, this.errorMessage];
    if (this.kind === "leaf") sig.push(this.value); // a group's value is its stable values object
    for (const k of COMPUTED_FIELDS) if (typeof this.config[k] === "function") sig.push(this[k]); // static ones never change
    if (this.rs) sig.push(this.loading, this.error);
    return sig;
  }

  /**
   * Version of the node's observable state (store.getNodeVersion): moves only
   * when a field of the signature actually changes, not on every dependency
   * bump. Lazy: compared against the signature seen by the previous call.
   */
  stateVersion(): number {
    const sig = untracked(() => (this.sigMemo ??= new Memo(() => this.signature())).get());
    if (sig !== this.lastSig) {
      if (this.lastSig && !sameItems(sig, this.lastSig)) this.sv = ++this.hub.stateSeq;
      this.lastSig = sig;
    }
    return this.sv;
  }

  // ── submit / reset ───────────────────────────────────────────────────────

  async submit(): Promise<SubmitResult> {
    const hub = this.hub;
    hub.batch(() => {
      this.setSubmitting(true);
      this.walk((c) => c.setRevalidate(true));
    });
    try {
      let payload: unknown;
      if (this.kind === "leaf") {
        payload = this.peekValue();
        if (this.config.beforeSubmit) payload = await this.config.beforeSubmit(payload, this.scopeValues);
      } else {
        let values = this.plain() as Values;
        values = this.applyLeafBeforeSubmit(values, values);
        if (this.config.beforeSubmit) values = await this.config.beforeSubmit(values, this.scopeValues);
        payload = values;
      }

      const errors = untracked(() => this.collectErrors());
      if (errors.length) return { success: false, errors };

      const parent = this.parent ? this.parent.node : undefined;
      const result = await this.config.onSubmit?.(payload, hub.store, parent);
      if (this.config.afterSubmit) {
        const target = this.kind === "leaf" ? this.parent ?? hub.root : this;
        await this.config.afterSubmit(result, { reset: () => target.reset() });
      }
      return { success: true, result };
    } finally {
      hub.batch(() => this.setSubmitting(false));
    }
  }

  private peekValue() { return untracked(() => this.value); }

  private applyLeafBeforeSubmit(values: Values, top: Values): Values {
    for (const [k, c] of this.children) {
      if (!(k in values)) continue;
      if (c.kind === "leaf" && c.config.beforeSubmit) values[k] = c.config.beforeSubmit(values[k], top);
      else if (c.kind === "group" && isPlainObject(values[k])) c.applyLeafBeforeSubmit(values[k], top);
    }
    return values;
  }

  /** Every leaf of the subtree, hidden ones included (store's collectLeafStates). */
  private collectErrors(): SubmitError[] {
    if (this.kind === "leaf") {
      const message = this.rawError;
      return message ? [{ path: this.path, message }] : [];
    }
    const out: SubmitError[] = [];
    const walk = (c: Cube, prefix: string) => {
      for (const [k, child] of c.children) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (child.kind === "group") walk(child, p);
        else if (child.kind === "leaf" && child.rawError) out.push({ path: p, message: child.rawError });
      }
    };
    walk(this, "");
    return out;
  }

  private setSubmitting(v: boolean) {
    if (this.submittingFlag !== v) { this.submittingFlag = v; this.bump(); }
  }

  setRevalidate(v: boolean) {
    if (this.revalidateFlag !== v) { this.revalidateFlag = v; this.bump(); }
  }

  /** Back to the baseline (or to `values`, which become the new baseline); errors hidden again. */
  reset(values?: Values): void {
    if (this.kind === "leaf") return this.parent?.reset();
    this.hub.batch(() => {
      if (values !== undefined) {
        this.patch(values);
        this.walk((c) => c.captureInitial());
      } else {
        const base = this.initialSnapshot();
        this.patch(this.config.reset ? this.config.reset(base) : base);
      }
      this.walk((c) => c.setRevalidate(false));
    });
  }

  private initialSnapshot(): Values {
    const out: Values = {};
    for (const [k, c] of this.children) {
      if (c.kind === "leaf") { if (typeof c.config.value !== "function") out[k] = c.initial; }
      else if (c.kind === "group") out[k] = c.initialSnapshot();
    }
    return out;
  }

  /** The current value becomes the dirty baseline. */
  captureInitial() {
    if (this.kind !== "leaf") return;
    const v = this.peekValue();
    if (!Object.is(v, this.initial)) { this.initial = v; this.bump(); }
  }

  /** Detached deep clone (store.getValues()). */
  getValues(): Values { return structuredClone(this.plain()) as Values; }

  /** Plain (getter-free) copy of the subtree's values, untracked. */
  plain(): unknown {
    if (this.kind === "leaf") return this.peekValue();
    const out: Values = {};
    for (const [k, c] of this.children) out[k] = c.plain();
    return out;
  }

  // ── resolve ──────────────────────────────────────────────────────────────

  /** A read through the public node: wakes a lazy resolve. */
  touch() { this.rs?.touch(); }

  /** Leaf → value, group → patch, list → items; `initial` → the result is the new baseline. */
  applyResolved(result: unknown, initial: boolean) {
    if (this.kind === "leaf") {
      this.store(result);
      if (initial) this.captureInitial();
    } else if (isPlainObject(result)) {
      this.patch(result);
      if (initial) this.captureFrom(result);
    }
  }

  private captureFrom(patch: Values) {
    for (const k in patch) {
      const c = this.children.get(k);
      if (c?.kind === "leaf") c.captureInitial();
      else if (c?.kind === "group" && isPlainObject(patch[k])) c.captureFrom(patch[k]);
    }
  }

  /** The cube leaves the tree (list item removed). */
  dispose() {
    this.walk((c) => {
      if (!c.rs) return;
      c.rs.dispose();
      this.hub.resolving.delete(c);
    });
  }

  /** Construction: initialValues seed the leaves (null / undefined keep the config value, as in store). */
  seed(initialValues: Values) {
    for (const [k, c] of this.children) {
      const v = initialValues[k];
      if (v == null) continue;
      if (c.kind === "leaf") { if (typeof c.config.value !== "function") c.raw = c.initial = v; }
      else if (c.kind === "group" && isPlainObject(v)) c.seed(v);
    }
  }

  /** Construction: computed leaves are evaluated once (a bug throws here, as in store) and become the baseline. */
  settleComputed() {
    this.walk((c) => {
      if (c.kind === "leaf" && typeof c.config.value === "function") c.initial = c.peekValue();
    });
  }
}

const COMPUTED_FIELDS = ["label", "placeholder", "description", "isVisible", "isRequired", "isDisabled", "isReadOnly"] as const;

const checkedConfigs = new WeakSet<CubeConfig>();

/** A group config's child keys, checked against the reserved names once per config. */
function checkedChildKeys(config: CubeConfig, owner: Cube): string[] {
  const keys = childKeys(config);
  if (!checkedConfigs.has(config)) {
    const path = owner.path;
    for (const k of keys) assertChildName(k, path ? `${path}.${k}` : k);
    checkedConfigs.add(config);
  }
  return keys;
}

function makeList(config: ListConfig, parent: Cube, key: string, hub: Hub): Cube {
  if (!createList) throw new Error("cube/core: list children need ListCube; import the core through cube/core/index.ts");
  return createList(config, parent, key, hub);
}

function sameItems(a: unknown[], b: unknown[]) {
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return a.length === b.length;
}
