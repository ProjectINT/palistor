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
// Rules, messages and semantics follow store/filtering (FilteringPlan.md).
// ─────────────────────────────────────────────────────────────────────────────

import { isEmpty, isPlainObject, type CubeConfig, type Values } from "./config";
import { Cube } from "./cube";
import type { Hub } from "./hub";
import type { ListCube } from "./listCube";
import { CUBE, type PublicNode } from "./node";
import { track, untracked } from "./track";

type Where = (item: unknown, value: unknown) => boolean;
type All = (item: unknown, values: Values) => boolean;
type ToParams = (values: Values, context: Record<string, unknown>) => unknown;

/** Members of `list.filter`: a field cannot take these names. */
export const FILTER_BUILTINS: ReadonlySet<string> = new Set([
  "values", "set", "reset", "clear", "isActive", "activeCount", "isPending",
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

/**
 * store/filtering/normalizeFilterBlock.ts: `$` keys are block options, every
 * other key is a field; a value that is not a `{ value }` object is a literal
 * default; dead config that looks live throws.
 */
function normalize(block: Values, list: string): { fields: FieldSpec[]; all?: All; toParams?: ToParams } {
  const fields: FieldSpec[] = [];
  let all: All | undefined;
  let toParams: ToParams | undefined;
  const fail = (msg: string): never => { throw new Error(`[palistor] ${msg}`); };

  for (const key of Object.keys(block)) {
    const raw = block[key];
    if (key.startsWith("$")) {
      if (key === "$all" || key === "$toParams") {
        if (typeof raw !== "function") fail(`filter "${key}" on list "${list}" must be a function.`);
        if (key === "$all") all = raw as All;
        else toParams = raw as ToParams;
      } else if (key !== "$persist") {
        fail(`unknown filter block option "${key}" on list "${list}" (known: $all, $toParams, $persist). Field names must not start with "$".`);
      }
      continue; // $persist: accepted and ignored, as in store (its `__filters` blob is FilteringPlan Phase 2, never shipped)
    }
    if (FILTER_BUILTINS.has(key)) {
      fail(`filter field "${key}" on list "${list}" collides with a built-in member of list.filter (${[...FILTER_BUILTINS].join(", ")}).`);
    }
    if (Array.isArray(raw) && raw.some((el) => isPlainObject(el) && ("resolve" in el || "template" in el))) {
      fail(`filter field "${key}" on list "${list}" looks like a list config — nested lists are not valid filter fields.`);
    }

    const config = (isPlainObject(raw) && "value" in raw ? raw : { value: raw }) as CubeConfig;
    const { where, param, debounce } = config as { where?: unknown; param?: unknown; debounce?: unknown };
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

    fields.push({
      key, config, derived,
      where: where as Where | undefined,
      param: param as string | undefined,
      debounce: debounce as number | undefined,
      dflt: derived ? undefined : config.value,
    });
  }
  return { fields, all, toParams };
}

/** A filter field: its default is kept verbatim (null included), a derived one is read-only. */
class FilterField extends Cube {
  constructor(readonly spec: FieldSpec, readonly block: FilterCube, hub: Hub) {
    super(spec.config, block, spec.key, hub);
    if (!spec.derived) this.init(spec.dflt === undefined ? "" : spec.dflt);
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
  /** Server fields: their values are the request identity. */
  private readonly server: FilterField[] = [];
  private readonly all?: All;
  private readonly toParams?: ToParams;
  /** Server field → its version at the last gate check. */
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
      if (spec.where) hasClient = true;
      else if (!spec.derived) { this.server.push(f); this.seen.set(f, f.version); }
    }
    this.hasClient = hasClient;
    // Nothing to issue without a resolver or without server fields (an all-`where` block).
    if (this.server.length && list.rs) hub.gates.add(this);
  }

  override get node(): PublicNode { return (this.filterNode ??= filterNode(this)); }

  /** A filter is not part of the form: a field's onChange does not bubble past it. */
  protected override get bubbleTo(): Cube | null { return null; }

  // ── reads ────────────────────────────────────────────────────────────────

  /** `filter.values`: every field, derived included; one object per change. */
  current(): Values {
    return this.memo("current", () => {
      const out: Values = {};
      for (const f of this.fields) out[f.key] = f.value;
      return out;
    });
  }

  /** Non-empty non-derived fields of both classes. */
  get activeCount(): number {
    return this.memo("activeCount", () => {
      let n = 0;
      for (const f of this.fields) if (!f.spec.derived && !isFilterEmpty(f.value)) n++;
      return n;
    });
  }

  get isActive(): boolean { return this.activeCount > 0; }

  /** The block has fields whose values reach the resolver (a paginated list keys its pages on them). */
  get hasServer(): boolean { return this.server.length > 0; }

  /** A server field changed and its debounce has not run out yet. */
  get isPending(): boolean { track(this); return this.timer !== null; }

  protected override signature(): unknown[] {
    const sig: unknown[] = [this.isPending];
    for (const f of this.fields) sig.push(f.value);
    return sig;
  }

  // ── client projection ────────────────────────────────────────────────────

  /**
   * The visible ids (store's applyClientFilter): a `where` is skipped while
   * its field is empty, the rest are ANDed, `$all` runs last and always. An
   * id outside the last loaded membership (added locally) is always visible.
   * `item` is the registry row, as store's projection object was.
   */
  project(ids: string[], loaded: string[], row: (id: string) => Values | undefined): string[] {
    const values = this.current();
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

  /** The list resolver's third argument; its server key becomes the issued one. */
  launch(): { filter: { values: Values; params: unknown; key: string }; queryKey: string } {
    return untracked(() => {
      const values = { ...this.current() };
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

  /** The server fields' values as one key (what a request is identified by). */
  serverKey(): string {
    return untracked(() => {
      const out: Values = {};
      for (const f of this.server) out[f.key] = f.value;
      return stableStringify(out);
    });
  }

  /**
   * After every notification cycle (hub): a server field moved → issue now,
   * or after the longest debounce among the moved fields. An undebounced
   * change (or set / reset / clear) issues at once and carries the debounced
   * fields' current values: one request per list.
   */
  check() {
    let delay = 0;
    let now = this.forcing;
    let moved = false;
    for (const f of this.server) {
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
   * Re-issue iff the current server key differs from the last launched one
   * (typing and reverting inside the debounce issues nothing). A lazy list
   * that never ran reads the current values on its first run anyway.
   */
  private issue() {
    const rs = this.list.rs;
    if (!rs || rs.status === "idle" || this.serverKey() === this.issuedKey) return;
    rs.invalidate();
  }

  /**
   * A paginated list re-keyed on the current server values without launching
   * (a retained family served from cache): those values are what the list
   * shows now, so the next issue compares against them. (store kept the key of
   * the last launch: a→""→a left the list on the unfiltered family.)
   */
  markIssued() { this.issuedKey = this.serverKey(); }

  private stopTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.hub.batch(() => this.bump());
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /** filter.set: one write, one notification; the issue it causes is immediate (debounce belongs to keystrokes). */
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
    for (const f of this.server) this.seen.set(f, f.version);
    this.stopTimer();
    this.issue();
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
 * builtins, all own enumerable keys. No list data is reachable here: the list
 * carries the rows, the filter carries the controls.
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
  const node: PublicNode = {};
  for (const [key, get] of reads) {
    Object.defineProperty(node, key, { enumerable: true, configurable: true, get, set: refuse(key) });
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
