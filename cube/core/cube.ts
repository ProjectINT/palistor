// ─────────────────────────────────────────────────────────────────────────────
// Cube: Palistor rebuilt around one primitive. Leaf, group and list item are
// this class; a list is a thin subclass. Every derived property is a lazy memo
// over versioned sources (track.ts), every mutation bumps a version inside a
// hub batch, and one batch is one notification cycle.
//
// An entity cube (a list item, or the view useForm(entity, template) opens on
// a row) keeps no values of its own: its leaves read and write the registry
// row at their path, so every view of a row sees every write.
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
import { getAt, patchAt } from "./registry";
import { ResolveState, type ResolveStatus } from "./resolve";
import { track, untracked, type Source } from "./track";

type ListFactory = (config: ListConfig, parent: Cube, key: string, hub: Hub) => Cube;
let createList: ListFactory | null = null;

/** Called by listCube.ts, so that Cube builds list children without importing its own subclass. */
export function registerList(factory: ListFactory) { createList = factory; }

export type CubeKind = "leaf" | "group" | "list";

/** useForm(entity, template): the template-level resolve of one (entity, template) pair. */
interface TemplateState {
  status: ResolveStatus;
  error: unknown;
}

export class Cube implements Source {
  version = 0;
  readonly kind: CubeKind;
  /** The entity cube this cube belongs to (its leaves live in a registry row), if any. */
  readonly item: Cube | null;
  /** Set on an entity cube: id of its registry row. Moves on store.rekey. */
  entityId?: string;
  rs?: ResolveState;
  private tpl?: TemplateState;

  private raw: unknown;
  private initial_: unknown;
  private rowPath_?: string[];
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
    entityId?: string,
    kind?: CubeKind,
  ) {
    this.kind = kind ?? (isLeafConfig(config) ? "leaf" : "group");
    this.entityId = entityId;
    this.item = entityId !== undefined ? this : parent?.item ?? null;
    if (!parent && entityId === undefined) hub.root = this;
    if (!this.item) hub.byConfig.set(config, this);

    if (this.kind === "leaf") {
      // store seeds `initialValues[key] ?? config.value ?? ""`: null and undefined read as "".
      this.raw = this.initial_ = typeof config.value === "function" ? undefined : config.value ?? "";
    } else if (this.kind === "group" && !this.item) {
      void this.children; // the form tree is built eagerly; an entity cube builds its subtree on first use
    }

    // A values resolve: the leaf's or the group's own. The entity cube itself
    // has none (its template's `resolve` is the template resolve of
    // useForm(entity, template)); its fields share theirs with every view of the row.
    if (entityId === undefined) {
      const resolve = this.kind === "list" ? (config as unknown as ListConfig)[1]?.resolve : config.resolve;
      if (resolve && typeof resolve.resolver === "function") {
        if (this.item) this.rs = hub.entityResolve(this.item.entityId!, config, this, resolve);
        else { this.rs = new ResolveState(this, resolve); hub.resolving.add(this.rs); }
      }
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
   * An entity's values start with its id, as store's entity values did.
   */
  get values(): Values {
    if (this.values_) return this.values_;
    const v: Values = {};
    if (this.entityId !== undefined) {
      Object.defineProperty(v, "id", { enumerable: true, configurable: true, get: () => this.idValue() });
    }
    for (const [k, child] of this.children) {
      Object.defineProperty(v, k, { enumerable: true, configurable: true, get: () => child.value });
    }
    return (this.values_ = v);
  }

  /** An entity cube's id, tracked (store.rekey moves it). */
  idValue(): string | undefined { track(this); return this.entityId; }

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

  /** Values for formatter / label / onChange: the entity's inside a list, else the root's. */
  get ctxValues(): Values { return (this.item ?? this.hub.root).values; }

  bump() { this.version++; this.hub.touch(); }

  /** Bumps this cube and its built subtree (a row replaced below this key). */
  bumpDeep() { this.walk((c) => c.bump()); }

  /** Stable per-cube function (onValueChange, submit, …): one reference for React. */
  fn<F extends (...args: any[]) => any>(name: string, make: () => F): F {
    return ((this.fns ??= {})[name] ??= make()) as F;
  }

  find(path: string): Cube | undefined {
    let c: Cube | undefined = this;
    for (const k of path.split(".")) c = c?.children.get(k);
    return c;
  }

  /** Visits the built subtree: an unopened list item has default state anyway. List items are not children. */
  walk(fn: (c: Cube) => void) {
    fn(this);
    if (this.children_) for (const c of this.children_.values()) c.walk(fn);
  }

  // ── entity row access ────────────────────────────────────────────────────

  /** Inside an entity: keys from the entity cube down to this cube (the leaf's address in the row). */
  private get rowPath(): string[] {
    if (this.rowPath_) return this.rowPath_;
    const p: string[] = [];
    for (let c: Cube = this; c.item && c !== c.item; c = c.parent!) p.unshift(c.key);
    return (this.rowPath_ = p);
  }

  /** A field of an entity (not the entity cube itself). */
  private get inRow(): boolean { return this.item !== null && this.item !== this; }

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

  /** The stored value, untracked. A row key the entity lacks reads the template default. */
  peek(): unknown {
    if (!this.inRow) return this.raw;
    const v = getAt(this.hub.registry.get(this.item!.entityId!), this.rowPath);
    return v === getAt.MISSING ? this.raw : v;
  }

  /** The dirty baseline: the cube's own for the form, the row's for an entity field. */
  get initial(): unknown {
    if (!this.inRow) return this.initial_;
    const v = getAt(this.hub.registry.baseline(this.item!.entityId!), this.rowPath);
    return v === getAt.MISSING ? this.raw : v;
  }

  set initial(v: unknown) {
    if (this.inRow) this.hub.registry.setBaseline(this.item!.entityId!, this.rowPath, v);
    else this.initial_ = v;
  }

  /** A value for a resolver or getValues: plain, tracked like `value`. */
  snapshotValue(): unknown { return this.value; }

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
    if (this.inRow) {
      // The row write bumps this key's cube in every view of the row.
      this.hub.registry.set(patchAt({ id: this.item!.entityId }, this.rowPath, next));
    } else {
      this.raw = next;
      this.bump();
    }
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

  /** Pending resolve: the cube's own, or (an entity cube) its template resolve. An entity field without one reads false, as in store. */
  get loading(): boolean | undefined {
    track(this);
    if (this.rs) return this.rs.status === "pending";
    if (this.entityId !== undefined) return this.tpl?.status === "pending";
    return this.kind === "leaf" && !this.item ? undefined : false;
  }

  get error(): unknown { track(this); return (this.rs ?? this.tpl)?.error ?? null; }
  get resolveStatus(): ResolveStatus { track(this); return (this.rs ?? this.tpl)?.status ?? "idle"; }

  /** Everything a subscriber can observe on this node, for change detection. */
  protected signature(): unknown[] {
    const sig: unknown[] = [this.dirty, this.submitting, this.revalidate];
    // A group validates only when its config says so; a leaf always may.
    if (this.kind === "leaf" || this.config.validate || this.config.isRequired !== undefined) sig.push(this.isInvalid, this.errorMessage);
    if (this.kind === "leaf") sig.push(this.value); // a group's value is its stable values object
    for (const k of COMPUTED_FIELDS) if (typeof this.config[k] === "function") sig.push(this[k]); // static ones never change
    if (this.rs) sig.push(this.loading, this.error);
    if (this.entityId !== undefined) sig.push(this.entityId, this.loading);
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
    if (this.entityId !== undefined) return this.submitEntity();
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
        // A form leaf's reset action resets its group; an entity field's resets the field (store's entity-leaf onReset).
        const target = this.kind === "leaf" && !this.inRow ? this.parent ?? hub.root : this;
        await this.config.afterSubmit(result, { reset: () => target.reset() });
      }
      return { success: true, result };
    } finally {
      hub.batch(() => this.setSubmitting(false));
    }
  }

  /**
   * store's entity-template submit (entity.submit()): the template's `validate`
   * rules over the row, then onSubmit(entityNode, store) and afterSubmit.
   */
  private async submitEntity(): Promise<SubmitResult> {
    const hub = this.hub;
    hub.batch(() => this.setSubmitting(true));
    try {
      const errors: SubmitError[] = [];
      untracked(() => this.collectValidateErrors(errors, ""));
      if (errors.length) return { success: false, errors };
      const result = await this.config.onSubmit?.(this.node, hub.store);
      if (this.config.afterSubmit) await this.config.afterSubmit(result, { reset: () => {} });
      return { success: true, result };
    } finally {
      hub.batch(() => this.setSubmitting(false));
    }
  }

  private collectValidateErrors(errors: SubmitError[], prefix: string) {
    for (const [k, c] of this.children) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (c.kind === "leaf") {
        const validate = c.config.validate;
        if (typeof validate !== "function") continue;
        const r = validate(c.peekValue(), c.scopeValues, this.hub.t);
        if (r) errors.push({ path: p, message: String(r) });
      } else if (c.kind === "group") c.collectValidateErrors(errors, p);
    }
  }

  /**
   * useForm(entity, template): the template's resolve runs once per (entity,
   * template) — resolver(entityNode, store) → merged into the row → marked
   * resolved until store.invalidate. `entity.loading` is this run's status.
   */
  resolveTemplate(): void {
    const r = this.config.resolve;
    if (this.entityId === undefined || !r || typeof r.resolver !== "function") return;
    const st = (this.tpl ??= { status: "idle", error: null });
    if (st.status === "pending") return;
    const hub = this.hub;
    hub.batch(() => { st.status = "pending"; st.error = null; this.bump(); });
    void (async () => {
      try {
        const result = await r.resolver(this.node, hub.store);
        hub.batch(() => {
          if (isPlainObject(result)) hub.registry.set({ ...result, id: this.entityId });
          hub.registry.markResolved(this.entityId!, this.config);
          st.status = "resolved";
          this.bump();
        });
      } catch (e) {
        st.status = "error";
        st.error = e;
        try { r.onError?.(e, { notify: hub.notify }); } catch { /* onError must not break the store */ }
        hub.batch(() => this.bump());
      }
    })();
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

  /**
   * Back to the baseline (or to `values`, which become the new baseline);
   * errors hidden again. A form leaf resets its group, an entity field resets
   * itself (store's entity-leaf onReset). The root reset also restores every
   * per-entity list and restarts entity field resolves, as store's did.
   */
  reset(values?: Values): void {
    if (this.kind === "leaf") {
      if (!this.inRow) return this.parent?.reset();
      this.hub.batch(() => { this.store(this.initial); this.setRevalidate(false); });
      return;
    }
    this.hub.batch(() => {
      if (values !== undefined) {
        this.patch(values);
        this.walk((c) => c.captureInitial());
      } else {
        const base = this.initialSnapshot();
        this.patch(this.config.reset ? this.config.reset(base) : base);
      }
      this.walk((c) => c.setRevalidate(false));
      if (this === this.hub.root) this.hub.resetEntities();
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

  /**
   * Plain (getter-free) copy of the subtree's values, untracked. An entity
   * starts with its id; a per-entity list nobody has set adds no key (store:
   * an untouched nested list had no state).
   */
  plain(): unknown {
    if (this.kind === "leaf") return this.peekValue();
    const out: Values = {};
    if (this.entityId !== undefined) out.id = this.entityId;
    for (const [k, c] of this.children) {
      if (c.kind === "list" && this.item && !(c as unknown as { touched: boolean }).touched) continue;
      out[k] = c.plain();
    }
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

  /**
   * The cube leaves the tree (list item dropped, entity deleted). Its resolves
   * stop being re-checked; a shared entity resolve keeps its status for the
   * row's other views and is released only when the last of them goes.
   */
  dispose() {
    this.walk((c) => {
      if (c.rs && c.rs.detach(c)) {
        this.hub.resolving.delete(c.rs);
        if (!c.item) c.rs.dispose();
      }
      if (c.kind === "list") (c as unknown as { release(): void }).release();
    });
  }

  /** Construction: initialValues seed the leaves (null / undefined keep the config value, as in store). */
  seed(initialValues: Values) {
    for (const [k, c] of this.children) {
      const v = initialValues[k];
      if (v == null) continue;
      if (c.kind === "leaf") { if (typeof c.config.value !== "function") c.raw = c.initial_ = v; }
      else if (c.kind === "group" && isPlainObject(v)) c.seed(v);
    }
  }

  /** Construction: computed leaves are evaluated once (a bug throws here, as in store) and become the baseline. */
  settleComputed() {
    this.walk((c) => {
      if (c.kind === "leaf" && typeof c.config.value === "function") c.initial_ = c.peekValue();
    });
  }
}

const COMPUTED_FIELDS = ["label", "placeholder", "description", "isVisible", "isRequired", "isDisabled", "isReadOnly"] as const;

const checkedGroups = new WeakSet<CubeConfig>();
const checkedTemplates = new WeakSet<CubeConfig>();

/** A group config's child keys, checked against the reserved names once per config and role (form group / entity template). */
function checkedChildKeys(config: CubeConfig, owner: Cube): string[] {
  const template = owner.item !== null;
  const keys = childKeys(config, template);
  const checked = template ? checkedTemplates : checkedGroups;
  if (!checked.has(config)) {
    const path = owner.path;
    for (const k of keys) assertChildName(k, path ? `${path}.${k}` : k, template);
    checked.add(config);
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
