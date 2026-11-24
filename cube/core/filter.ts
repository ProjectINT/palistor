// ─────────────────────────────────────────────────────────────────────────────
// List filter (`defineList({ filter })`): view state next to a root list.
// The block is a group cube outside the form tree, so getValues, reset,
// submit and the resolver's `values` never reach it. Its fields are ordinary
// leaf cubes: binding, formatter, computed flags, derived values and useForm
// tracking work as on any form field.
//
//   • server field (no `where`): its value reaches the list resolver through
//     ctx.filter; a change re-issues the resolve, after the field's
//     `debounce` when it has one. The value itself never lags.
//   • client field (`where`): a read-time projection of the loaded rows.
//     A row added locally stays visible until the next resolve.
//   • derived field (`value` is a function): read-only, in neither key.
//
// Apply mode (`$apply: "manual"` on the block, `apply` on a field; SortPlan
// decision 14): a manual field's value is a draft — what the field, its input
// and `filter.values` show — and an applied value next to it. Whatever acts
// on the list (the projection, ctx.filter, the server key, isActive,
// activeCount) reads each field's effective value: the applied one for a
// manual field, the current one otherwise. Typing in a manual field issues
// nothing; `filter.apply()` moves the drafts into the applied values.
//
// Rules, messages and semantics follow store/filtering (FilteringPlan.md).
// ─────────────────────────────────────────────────────────────────────────────

import { isDirtyValue, isEmpty, isPlainObject, type CubeConfig, type Values } from "./config";
import { Cube } from "./cube";
import type { Hub } from "./hub";
import type { ListCube } from "./listCube";
import { CUBE, type PublicNode } from "./node";
import { Signal, track, untracked } from "./track";

type Where = (item: unknown, value: unknown) => boolean;
type All = (item: unknown, values: Values) => boolean;
type ToParams = (values: Values, context: Record<string, unknown>) => unknown;
type ApplyMode = "auto" | "manual";

/** Members of `list.filter`: a field cannot take these names. */
export const FILTER_BUILTINS: ReadonlySet<string> = new Set([
  "values", "set", "reset", "clear", "isActive", "activeCount", "isPending",
  "apply", "revert", "isDraft", "applied",
]);

interface FieldSpec {
  key: string;
  config: CubeConfig;
  /** Client predicate; skipped while the field is empty. */
  where?: Where;
  /** Server param name (default: the key). */
  param?: string;
  /** ms to delay the re-issue this field's change causes. */
  debounce?: number;
  derived: boolean;
  /** Applied by `filter.apply()` only (its own `apply`, else the block's `$apply`). Never a derived field. */
  manual: boolean;
  /** Declared default, kept verbatim (null included). */
  dflt: unknown;
}

// ── emptiness and keys (store/filtering/filterController.ts) ───────────────

/** Empty for a filter: isEmpty plus `[]` (empty multi-select) and `false` (a toggle that is off). */
export function isFilterEmpty(v: unknown): boolean {
  return isEmpty(v) || v === false || (Array.isArray(v) && v.length === 0);
}

/** What `clear()` writes, typed off the declared default. */
function emptyValueFor(dflt: unknown): unknown {
  if (typeof dflt === "string") return "";
  if (Array.isArray(dflt)) return [];
  if (typeof dflt === "boolean") return false;
  return null;
}

/** Deterministic JSON: object keys sorted at every level. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "u" : s;
  }
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Values;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// ── the block ──────────────────────────────────────────────────────────────

const isApplyMode = (v: unknown): v is ApplyMode => v === "auto" || v === "manual";

/**
 * store/filtering/normalizeFilterBlock.ts: `$` keys are block options, every
 * other key is a field; a value that is not a `{ value }` object is a literal
 * default; dead config that looks live throws. `$apply` / `apply` are Cube
 * only (store rejects `$apply` as an unknown option).
 */
function normalize(block: Values, list: string): { fields: FieldSpec[]; all?: All; toParams?: ToParams } {
  const fields: FieldSpec[] = [];
  let all: All | undefined;
  let toParams: ToParams | undefined;
  const fail = (msg: string): never => { throw new Error(`[palistor] ${msg}`); };
  const blockApply = block.$apply;
  if (blockApply !== undefined && !isApplyMode(blockApply)) {
    fail(`filter "$apply" on list "${list}" must be "manual" or "auto".`);
  }

  for (const key of Object.keys(block)) {
    const raw = block[key];
    if (key.startsWith("$")) {
      if (key === "$all" || key === "$toParams") {
        if (typeof raw !== "function") fail(`filter "${key}" on list "${list}" must be a function.`);
        if (key === "$all") all = raw as All;
        else toParams = raw as ToParams;
      } else if (key !== "$persist" && key !== "$apply") {
        fail(`unknown filter block option "${key}" on list "${list}" (known: $all, $toParams, $persist, $apply). Field names must not start with "$".`);
      }
      continue; // $apply: read above. $persist: accepted and ignored, as in store (its `__filters` blob is FilteringPlan Phase 2, never shipped)
    }
    if (FILTER_BUILTINS.has(key)) {
      fail(`filter field "${key}" on list "${list}" collides with a built-in member of list.filter (${[...FILTER_BUILTINS].join(", ")}).`);
    }
    if (Array.isArray(raw) && raw.some((el) => isPlainObject(el) && ("resolve" in el || "template" in el))) {
      fail(`filter field "${key}" on list "${list}" looks like a list config — nested lists are not valid filter fields.`);
    }

    const config = (isPlainObject(raw) && "value" in raw ? raw : { value: raw }) as CubeConfig;
    const { where, param, debounce, apply } = config as { where?: unknown; param?: unknown; debounce?: unknown; apply?: unknown };
    const derived = typeof config.value === "function";
    const dead = param !== undefined ? "param" : debounce !== undefined ? "debounce" : null;
    if (where !== undefined && typeof where !== "function") fail(`filter field "${key}" on list "${list}": "where" must be a function.`);
    if (where !== undefined && dead) {
      fail(`filter field "${key}" on list "${list}" declares "where" together with "${dead}" — a client field never issues a request, so that option can never apply.`);
    }
    if (derived && dead) {
      fail(`derived filter field "${key}" on list "${list}" declares "${dead}" — a derived field is excluded from the request identity, so that option can never apply.`);
    }
    if (param !== undefined && typeof param !== "string") fail(`filter field "${key}" on list "${list}": "param" must be a string.`);
    if (debounce !== undefined && typeof debounce !== "number") fail(`filter field "${key}" on list "${list}": "debounce" must be a number (ms).`);
    if (apply !== undefined && !isApplyMode(apply)) fail(`filter field "${key}" on list "${list}": "apply" must be "auto" or "manual".`);
    if (derived && apply !== undefined) {
      fail(`derived filter field "${key}" on list "${list}" declares "apply" — a derived field is read-only and follows the fields it is computed from, so that option can never apply.`);
    }
    const manual = !derived && (apply ?? blockApply) === "manual";
    if (manual && debounce !== undefined) {
      const why = apply === "manual" ? `declares apply: "manual"` : `follows the block's $apply: "manual"`;
      fail(`filter field "${key}" on list "${list}" ${why} and "debounce" — typing in a manual field issues no request, so that option can never apply.`);
    }

    fields.push({
      key, config, derived, manual,
      where: where as Where | undefined,
      param: param as string | undefined,
      debounce: debounce as number | undefined,
      dflt: derived ? undefined : config.value,
    });
  }
  if (blockApply === "manual" && !fields.some((f) => f.manual)) {
    fail(`filter "$apply": "manual" on list "${list}" reaches no field — every field is derived or declares apply: "auto", so that option can never apply.`);
  }
  return { fields, all, toParams };
}

/** A filter field: its default is kept verbatim (null included), a derived one is read-only. */
class FilterField extends Cube {
  /**
   * A manual field: the value the list is filtered by, while `value` is the
   * draft. Starts as the default; only `filter.apply()` moves it (read it
   * through FilterCube, which tracks it).
   */
  applied: unknown;

  constructor(readonly spec: FieldSpec, readonly block: FilterCube, hub: Hub) {
    super(spec.config, block, spec.key, hub);
    if (!spec.derived) this.init(spec.dflt === undefined ? "" : spec.dflt);
    if (spec.manual) this.applied = this.peek();
  }

  override write(raw: unknown) {
    if (this.spec.derived) {
      throw new Error(`[palistor] filter field "${this.key}" on list "${this.block.list.path}" is derived and read-only.`);
    }
    super.write(raw);
  }
}

/**
 * The filter of one root list: a group cube (its fields' scope values for
 * derived values and computed flags) that is nobody's child. `list.filter`
 * is its node.
 */
export class FilterCube extends Cube {
  readonly fields: FilterField[] = [];
  readonly hasClient: boolean;
  /** Server fields: their effective values are the request identity. */
  private readonly server: FilterField[] = [];
  /** Automatic server fields: the ones the gate watches (a keystroke in a manual field issues nothing). */
  private readonly gated: FilterField[] = [];
  /** Manual fields (`$apply` / `apply`): a draft and an applied value each. Empty in automatic mode. */
  private readonly manual: FilterField[] = [];
  /** Moves when `apply()` changes an applied value: what reads of applied values track. */
  private readonly appliedSource = new Signal();
  private readonly all?: All;
  private readonly toParams?: ToParams;
  /** Gated field → its version at the last gate check. */
  private readonly seen = new Map<FilterField, number>();
  /** Server key the resolver last launched with. */
  private issuedKey: string | null = null;
  /** Debounce handle: `isPending === (timer !== null)`. */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** set / reset / clear in progress: the issue they cause skips the debounce. */
  private forcing = false;
  private filterNode?: PublicNode;

  constructor(block: Values, readonly list: ListCube, hub: Hub) {
    super({}, list, "filter", hub);
    const { fields, all, toParams } = normalize(block, list.path);
    this.all = all;
    this.toParams = toParams;
    let hasClient = false;
    for (const spec of fields) {
      const f = new FilterField(spec, this, hub);
      this.children.set(spec.key, f);
      this.fields.push(f);
      if (spec.manual) this.manual.push(f);
      if (spec.where) hasClient = true;
      else if (!spec.derived) {
        this.server.push(f);
        if (!spec.manual) { this.gated.push(f); this.seen.set(f, f.version); }
      }
    }
    this.hasClient = hasClient;
    // Nothing to issue without a resolver or without automatic server fields (an all-`where`
    // block, or every server field manual: apply() issues by itself).
    if (this.gated.length && list.rs) hub.gates.add(this);
  }

  override get node(): PublicNode { return (this.filterNode ??= filterNode(this)); }

  /** A filter is not part of the form: a field's onChange does not bubble past it. */
  protected override get bubbleTo(): Cube | null { return null; }

  // ── reads ────────────────────────────────────────────────────────────────

  /** `filter.values`: every field, derived included; one object per change. A manual field shows its draft. */
  current(): Values {
    return this.memo("current", () => {
      const out: Values = {};
      for (const f of this.fields) out[f.key] = f.value;
      return out;
    });
  }

  /** A non-derived field's value as the list sees it: the applied one for a manual field, the current one otherwise. Tracked. */
  private effectiveOf(f: FilterField): unknown {
    if (!f.spec.manual) return f.value;
    track(this.appliedSource);
    return f.applied;
  }

  /**
   * `filter.applied`: the values the list is filtered by — every field, a
   * derived one computed from these values rather than from the drafts; one
   * object per change. Without manual fields it is `current()` itself.
   */
  effective(): Values {
    if (this.manual.length === 0) return this.current();
    return this.memo("effective", () => {
      const scope: Values = {};
      for (const f of this.fields) {
        if (!f.spec.derived) { scope[f.key] = this.effectiveOf(f); continue; }
        const fn = f.config.value as (values: Values) => unknown;
        let state: "idle" | "computing" | "done" = "idle";
        let result: unknown;
        Object.defineProperty(scope, f.key, {
          enumerable: true,
          get: () => {
            if (state === "done") return result;
            if (state === "computing") throw new Error("palistor/cube: computed cycle (a computed value reads itself)");
            state = "computing";
            result = fn(scope);
            state = "done";
            return result;
          },
        });
      }
      const out: Values = {};
      for (const f of this.fields) out[f.key] = scope[f.key];
      return out;
    });
  }

  /** Non-empty non-derived fields of both classes, by their effective values. */
  get activeCount(): number {
    return this.memo("activeCount", () => {
      let n = 0;
      for (const f of this.fields) if (!f.spec.derived && !isFilterEmpty(this.effectiveOf(f))) n++;
      return n;
    });
  }

  get isActive(): boolean { return this.activeCount > 0; }

  /** A manual field's draft differs from its applied value (the rule `dirty` uses: objects and arrays by content). */
  get isDraft(): boolean {
    if (this.manual.length === 0) return false;
    return this.memo("isDraft", () => {
      track(this.appliedSource);
      return this.manual.some((f) => isDirtyValue(f.value, f.applied));
    });
  }

  /** The block has fields whose values reach the resolver (a paginated list keys its pages on them). */
  get hasServer(): boolean { return this.server.length > 0; }

  /** A server field changed and its debounce has not run out yet. */
  get isPending(): boolean { track(this); return this.timer !== null; }

  protected override signature(): unknown[] {
    const sig: unknown[] = [this.isPending];
    for (const f of this.fields) sig.push(f.value);
    if (this.manual.length) sig.push(this.effective(), this.isDraft);
    return sig;
  }

  // ── client projection ────────────────────────────────────────────────────

  /**
   * The visible ids (store's applyClientFilter): a `where` is skipped while
   * its field is empty, the rest are ANDed, `$all` runs last and always. An
   * id outside the last loaded membership (added locally) is always visible.
   * `item` is the registry row, as store's projection object was. Runs on the
   * effective values: a draft keystroke does not re-run it.
   */
  project(ids: string[], loaded: string[], row: (id: string) => Values | undefined): string[] {
    const values = this.effective();
    const active = this.fields.filter((f) => f.spec.where && !isFilterEmpty(values[f.key]));
    const all = this.all;
    if (active.length === 0 && !all) return ids;
    const base = new Set(loaded);
    return ids.filter((id) => {
      if (!base.has(id)) return true;
      const item = row(id);
      if (!item) return true;
      for (const f of active) if (!f.spec.where!(item, values[f.key])) return false;
      return !all || all(item, values);
    });
  }

  // ── server fields: the resolver context and the issue gate ───────────────

  /** The list resolver's third argument, from the effective values; its server key becomes the issued one. */
  launch(): { filter: { values: Values; params: unknown; key: string }; queryKey: string } {
    return untracked(() => {
      const values = { ...this.effective() };
      const key = this.serverKey();
      this.issuedKey = key;
      return { filter: { values, params: this.params(values), key }, queryKey: key };
    });
  }

  private params(values: Values): unknown {
    if (this.toParams) return this.toParams(values, this.hub.context);
    if (this.server.length === 0) return undefined;
    const out: Values = {};
    for (const f of this.server) out[f.spec.param ?? f.key] = values[f.key];
    return out;
  }

  /** The server fields' effective values as one key (what a request is identified by). */
  serverKey(): string {
    return untracked(() => {
      const out: Values = {};
      for (const f of this.server) out[f.key] = this.effectiveOf(f);
      return stableStringify(out);
    });
  }

  /**
   * After every notification cycle (hub): an automatic server field moved →
   * issue now, or after the longest debounce among the moved fields. An
   * undebounced change (or set / reset / clear) issues at once and carries
   * the debounced fields' current values: one request per list. Manual
   * fields are not watched: their drafts reach no request until apply().
   */
  check() {
    let delay = 0;
    let now = this.forcing;
    let moved = false;
    for (const f of this.gated) {
      if (f.version === this.seen.get(f)) continue;
      this.seen.set(f, f.version);
      moved = true;
      const d = f.spec.debounce ?? 0;
      if (d > 0) delay = Math.max(delay, d);
      else now = true;
    }
    if (!moved) return;
    if (now) {
      this.stopTimer();
      this.issue();
      return;
    }
    const wasPending = this.timer !== null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.hub.batch(() => { this.bump(); this.issue(); });
    }, delay);
    if (!wasPending) this.hub.batch(() => this.bump());
  }

  /**
   * Re-issue iff the effective server key differs from the last launched one
   * (typing and reverting inside the debounce issues nothing, nor does typing
   * in a manual field). A lazy list that never ran reads the effective values
   * on its first run anyway.
   */
  private issue() {
    const rs = this.list.rs;
    if (!rs || rs.status === "idle" || this.serverKey() === this.issuedKey) return;
    rs.invalidate();
  }

  /**
   * A paginated list re-keyed on the effective server values without launching
   * (a retained family served from cache), or `initialData` answered them:
   * those values are what the list shows now, so the next issue compares
   * against them. (store kept the key of the last launch: a→""→a left the
   * list on the unfiltered family.)
   */
  markIssued() { this.issuedKey = this.serverKey(); }

  private stopTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.hub.batch(() => this.bump());
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * filter.set: one write, one notification; the issue it causes is immediate
   * (debounce belongs to keystrokes). A manual field takes the value as its
   * draft: only apply() brings it to the list.
   */
  setFields(patch: Values) {
    for (const k of Object.keys(patch)) {
      if ((this.children.get(k) as FilterField | undefined)?.spec.derived) {
        throw new Error(
          `[palistor] filter field "${k}" on list "${this.list.path}" is derived (its "value" is a function) and read-only.`,
        );
      }
    }
    this.forcing = true;
    try {
      this.hub.batch(() => {
        for (const k of Object.keys(patch)) {
          const f = this.children.get(k);
          if (!f) continue;
          const v = patch[k];
          f.assign(f.config.formatter ? f.config.formatter(v, f.ctxValues) : v);
        }
      });
    } finally {
      this.forcing = false;
    }
    // Inside an outer batch the cycle has not run yet: take the change in here.
    // A debounced change queued before this call is not lost either.
    for (const f of this.gated) this.seen.set(f, f.version);
    this.stopTimer();
    this.issue();
  }

  /** Manual fields whose draft differs from the applied value. */
  private drafted(): FilterField[] {
    return untracked(() => this.manual.filter((f) => isDirtyValue(f.peek(), f.applied)));
  }

  /**
   * filter.apply: the drafts become the applied values — one notification,
   * and one request when the effective server key moved (none when nothing
   * differs: no notification either). A paginated list goes back to its first
   * page through the filter key. Like set(), the request carries a debounced
   * change queued before the call, and the debounce stops.
   */
  apply() {
    const moved = this.drafted();
    if (moved.length === 0) return;
    this.hub.batch(() => {
      for (const f of moved) f.applied = f.peek();
      this.appliedSource.bump();
      this.hub.touch();
      for (const f of this.gated) this.seen.set(f, f.version);
      this.stopTimer();
    });
    this.issue();
  }

  /** filter.revert: the drafts go back to the applied values (no formatter, no onChange — as reset()); no request. */
  revert() {
    const moved = this.drafted();
    if (moved.length) this.hub.batch(() => { for (const f of moved) f.assign(f.applied); });
  }

  /** filter.reset: back to the declared defaults (active again iff a default is non-empty). */
  resetFields() {
    const patch: Values = {};
    for (const f of this.fields) if (!f.spec.derived) patch[f.key] = f.spec.dflt;
    this.setFields(patch);
  }

  /** filter.clear(field?): to the empty value of the default's type; always ends inactive. */
  clearFields(key?: string) {
    const patch: Values = {};
    for (const f of this.fields) {
      if (f.spec.derived || (key !== undefined && f.key !== key)) continue;
      patch[f.key] = emptyValueFor(f.spec.dflt);
    }
    if (Object.keys(patch).length) this.setFields(patch);
  }
}

/**
 * `list.filter`: the fields (leaf nodes, bindable like `form.name`) and the
 * builtins, all own enumerable keys — store's spread. The apply-mode members
 * (`apply`, `revert`, `isDraft`, `applied`) are Cube only and off the spread,
 * on every block: in automatic mode they answer as a block with nothing to
 * apply. No list data is reachable here: the list carries the rows, the
 * filter carries the controls.
 */
function filterNode(f: FilterCube): PublicNode {
  const refuse = (key: string) => () => {
    throw new Error(
      `[palistor] cannot assign to list.filter.${key} — write through the field (filter.${key}.value = …) or filter.set({ … }).`,
    );
  };
  const reads: Array<[string, () => unknown]> = f.fields.map((field) => [field.key, () => field.node]);
  reads.push(
    ["values", () => f.current()],
    ["set", () => f.fn("set", () => (patch: Values) => f.setFields(patch))],
    ["reset", () => f.fn("reset", () => () => f.resetFields())],
    ["clear", () => f.fn("clear", () => (key?: string) => f.clearFields(key))],
    ["isActive", () => f.isActive],
    ["activeCount", () => f.activeCount],
    ["isPending", () => f.isPending],
  );
  const hidden: Array<[string, () => unknown]> = [
    ["apply", () => f.fn("apply", () => () => f.apply())],
    ["revert", () => f.fn("revert", () => () => f.revert())],
    ["isDraft", () => f.isDraft],
    ["applied", () => f.effective()],
  ];
  const node: PublicNode = {};
  for (const [key, get] of reads) {
    Object.defineProperty(node, key, { enumerable: true, configurable: true, get, set: refuse(key) });
  }
  for (const [key, get] of hidden) {
    Object.defineProperty(node, key, { enumerable: false, configurable: true, get, set: refuse(key) });
  }
  Object.defineProperty(node, CUBE, { value: f });
  return Object.preventExtensions(node);
}

/**
 * store: a filter on a per-entity (nested) list is a later phase: warned once
 * at construction and ignored. Walks a root list's template, nested ones included.
 */
export function warnNestedFilters(template: CubeConfig, path: string) {
  for (const k of Object.keys(template)) {
    const sub = template[k];
    if (Array.isArray(sub)) {
      const opts = sub[1] as { filter?: unknown } | undefined;
      if (opts?.filter) {
        console.warn(
          `[palistor] filter on nested list "${path}.${k}" is not supported yet — ignored (per-entity list filters are a later phase).`,
        );
      }
      if (isPlainObject(sub[0])) warnNestedFilters(sub[0] as CubeConfig, `${path}.${k}[]`);
    } else if (isPlainObject(sub) && !("value" in sub) && k !== "resolve" && k !== "componentProps") {
      warnNestedFilters(sub as CubeConfig, `${path}.${k}`);
    }
  }
}
