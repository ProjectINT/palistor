// ─────────────────────────────────────────────────────────────────────────────
// List sort (`defineList({ sort })`): view state next to a root list, outside
// the form tree like the filter, so getValues, reset, submit, persist and the
// resolver's `values` never reach it. `list.sort` is its node.
//
//   • client class (a list that holds all its rows): the list orders them
//     itself. The order is a snapshot (experiments/SortPlan.md, decision 8):
//     computed when the sort changes, when a resolve lands, when setItems or
//     restore replace the membership, and on refresh(). In between an id that
//     joins the membership goes to the end, one that leaves is taken out, and
//     a value edit moves nothing: no value is compared.
//   • server class (`resolve.pagination`, or `$server: true`): the resolver
//     sorts; the list shows the rows in the order they came. The sort reaches
//     it as ctx.sort (`{ by: [{ key, param, dir }], key }`) and is part of the
//     request identity, like the filter's server fields: after every
//     notification cycle (hub.gates) a sort whose key differs from the one
//     last launched re-issues the resolve — a plain list runs again (once
//     after a run in flight), a paginated one changes its query key through
//     the `$sort` pseudo-dependency and starts over at its first page.
//     `initialData` answers the sort the store starts with (`$default`).
//
// Visible rows = sort(filter(membership)): the filter narrows the ordered
// snapshot and keeps its order (ListCube.visibleIds).
// ─────────────────────────────────────────────────────────────────────────────

import { childKeys, isLeafConfig, isPlainObject, type CubeConfig, type ResolveConfig, type Values } from "./config";
import { Cube } from "./cube";
import { stableStringify } from "./filter";
import type { Hub } from "./hub";
import type { ListCube } from "./listCube";
import { CUBE, type PublicNode } from "./node";
import { getAt } from "./registry";
import { Signal, track, untracked } from "./track";

export type SortDir = "asc" | "desc";

/** One entry of the sort state (`list.sort.by`). Replaced, never mutated. */
export interface SortEntry {
  readonly key: string;
  readonly dir: SortDir;
}

/** The resolver's `ctx.sort` (store/store/types.ts, SortRequest). */
export interface SortRequest {
  by: Array<{ key: string; param: string; dir: SortDir }>;
  key: string;
}

/** React Aria / HeroUI `SortDescriptor`. */
interface SortDescriptor {
  column: string | number;
  direction: "ascending" | "descending";
}

/** A sortable key of the block. */
interface Column {
  key: string;
  /** Value sort: the leaf's address in a registry row. */
  path?: string[];
  /** Value sort: what a row without the leaf reads (the template default, as Cube.peek). */
  dflt?: unknown;
  by?: (row: Values) => unknown;
  compare?: (a: Values, b: Values) => number;
  /** Server class: the name the resolver gets (default: the key). */
  param: string;
}

const OPTIONS = ["$default", "$server", "$locale"];
const FIELD_OPTIONS = new Set(["by", "compare", "param"]);
const NO_SORT: readonly SortEntry[] = Object.freeze([]);

// ── the block ──────────────────────────────────────────────────────────────

interface Parsed {
  server: boolean;
  columns: Map<string, Column>;
  dflt: readonly SortEntry[];
  locale?: string | string[];
}

/**
 * Leaves of a template by path ("address.city" for a leaf in a group); a
 * nested list is not a leaf. A row without the key reads the template
 * default, `""` for null / undefined, as Cube.peek does.
 */
function templateLeaves(template: CubeConfig, prefix: string[] = [], out = new Map<string, { path: string[]; dflt: unknown }>()) {
  for (const k of childKeys(template, true)) {
    const sub = template[k];
    if (Array.isArray(sub) || !isPlainObject(sub)) continue;
    const path = [...prefix, k];
    if (isLeafConfig(sub)) out.set(path.join("."), { path, dflt: sub.value ?? "" });
    else templateLeaves(sub as CubeConfig, path, out);
  }
  return out;
}

/**
 * `true` or an object: a `$` key is a block option, every other key is a
 * field — `true`, `{ by }`, `{ compare }` (client class) or `{ param }`
 * (server class). A block without fields makes every template leaf sortable.
 * Config that can never take effect throws (SortPlan decision 3).
 */
function parse(block: unknown, list: ListCube, resolve: ResolveConfig | undefined): Parsed {
  const name = list.path;
  const fail = (msg: string): never => { throw new Error(`[palistor] ${msg}`); };
  if (block !== true && !isPlainObject(block)) fail(`sort on list "${name}" must be true or an object of fields and $ options.`);
  const raw = (block === true ? {} : block) as Values;

  const opts: Values = {};
  const fields: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!key.startsWith("$")) { fields.push(key); continue; }
    if (!OPTIONS.includes(key)) {
      fail(`unknown sort block option "${key}" on list "${name}" (known: ${OPTIONS.join(", ")}). Field names must not start with "$".`);
    }
    opts[key] = raw[key];
  }

  const $server = opts.$server;
  if ($server !== undefined && typeof $server !== "boolean") fail(`sort "$server" on list "${name}" must be a boolean.`);
  if ($server === false && resolve?.pagination) {
    fail(`sort on list "${name}" declares "$server: false", but a paginated list holds one page: only the server can sort it.`);
  }
  const server = $server === true || !!resolve?.pagination;
  if (server && typeof resolve?.resolver !== "function") {
    fail(`sort on list "${name}" is a server sort ("$server: true"), but the list has no resolver to send it to.`);
  }

  let locale: string | string[] | undefined;
  if (opts.$locale !== undefined) {
    const l = opts.$locale;
    if (typeof l !== "string" && !(Array.isArray(l) && l.every((x) => typeof x === "string"))) {
      fail(`sort "$locale" on list "${name}" must be a locale tag or an array of them.`);
    }
    if (server) fail(`sort "$locale" on list "${name}" can never apply: the server sorts this list, not the browser.`);
    try { new Intl.Collator(l); } catch (e) { fail(`sort "$locale" on list "${name}": ${(e as Error).message}.`); }
    locale = l;
  }

  const leaves = templateLeaves(list.template);
  const columns = new Map<string, Column>();
  const named = fields.length > 0;
  for (const key of named ? fields : [...leaves.keys()]) {
    const value = named ? raw[key] : true;
    const col: Column = { key, param: key };
    if (isPlainObject(value)) {
      for (const k of Object.keys(value)) {
        if (!FIELD_OPTIONS.has(k)) fail(`sort field "${key}" on list "${name}": unknown option "${k}" (known: by, compare, param).`);
      }
      const { by, compare, param } = value as { by?: unknown; compare?: unknown; param?: unknown };
      if (by !== undefined && compare !== undefined) {
        fail(`sort field "${key}" on list "${name}" declares both "by" and "compare" — only one of them can order the rows.`);
      }
      if (by !== undefined && typeof by !== "function") fail(`sort field "${key}" on list "${name}": "by" must be a function.`);
      if (compare !== undefined && typeof compare !== "function") fail(`sort field "${key}" on list "${name}": "compare" must be a function.`);
      if (param !== undefined && typeof param !== "string") fail(`sort field "${key}" on list "${name}": "param" must be a string.`);
      const client = by !== undefined ? "by" : compare !== undefined ? "compare" : null;
      if (server && client) {
        fail(
          `sort field "${key}" on list "${name}" declares "${client}", but the server sorts this list ` +
          `(${resolve?.pagination ? "resolve.pagination" : "$server: true"}): a client "${client}" can never apply. Use true or { param }.`,
        );
      }
      if (!server && param !== undefined) {
        fail(
          `sort field "${key}" on list "${name}" declares "param", but this list holds all its rows and sorts them itself: ` +
          `a server param can never apply. Add "$server: true" if the resolver sorts.`,
        );
      }
      if (by) col.by = by as Column["by"];
      if (compare) col.compare = compare as Column["compare"];
      if (param) col.param = param as string;
    } else if (value !== true) {
      fail(`sort field "${key}" on list "${name}" must be true, { by }, { compare } or { param }.`);
    }
    if (!server && !col.by && !col.compare) {
      // Every registry row has its `id`, declared in the template or not.
      const leaf = leaves.get(key) ?? (key === "id" ? { path: ["id"], dflt: "" } : undefined);
      if (!leaf) {
        fail(
          `sort field "${key}" on list "${name}" is not a leaf of the template, so there is no value to sort by — ` +
          `name a leaf ("address.city" for one in a group) or give the field { by } or { compare }.`,
        );
      }
      col.path = leaf!.path;
      col.dflt = leaf!.dflt;
    }
    columns.set(key, col);
  }

  let dflt: readonly SortEntry[] = NO_SORT;
  const d = opts.$default;
  if (d !== undefined) {
    if (typeof d !== "string") fail(`sort "$default" on list "${name}" must be a key, or "-key" for descending.`);
    const desc = d.startsWith("-");
    const key = desc ? d.slice(1) : d;
    if (!columns.has(key)) fail(`sort "$default" on list "${name}": "${key}" is not a sortable key (sortable: ${[...columns.keys()].join(", ")}).`);
    dflt = Object.freeze([Object.freeze({ key, dir: desc ? "desc" : "asc" } as SortEntry)]);
  }
  return { server, columns, dflt, locale };
}

// ── comparison (SortPlan decisions 4–6) ────────────────────────────────────

/** No value to order by: last in both directions. */
function isSortEmpty(v: unknown): boolean {
  return v == null || v === "" || (typeof v === "number" && Number.isNaN(v)) || (v instanceof Date && Number.isNaN(v.getTime()));
}

/** A value as text for a comparison across types; a Date as ISO, the same on the server and in the browser. */
const asText = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * Two non-empty values: numbers as numbers, strings through the collator
 * ("Item 2" before "Item 10", case and accents ignored), false before true,
 * dates by time; values of different types as text.
 */
export function compareValues(a: unknown, b: unknown, collator: Intl.Collator): number {
  const t = typeof a;
  if (t === typeof b) {
    if (t === "string") return collator.compare(a as string, b as string);
    if (t === "number" || t === "bigint") return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
    if (t === "boolean") return a === b ? 0 : a ? 1 : -1;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  }
  return collator.compare(asText(a), asText(b));
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameEntries(a: readonly SortEntry[], b: readonly SortEntry[]) {
  return a.length === b.length && a.every((e, i) => e.key === b[i].key && e.dir === b[i].dir);
}

// ── the cube ───────────────────────────────────────────────────────────────

/**
 * The sort of one root list: its state (`by`) and, for the client class, the
 * order snapshot the list shows. A cube that is nobody's child (no children,
 * no value), so useForm tracks its node like any other: `stateVersion` moves
 * when `by` changes.
 */
export class SortCube extends Cube {
  /** The resolver sorts (the list is paginated, or `$server: true`). */
  readonly server: boolean;
  /** The sortable keys, in block order (template order for a block without fields). */
  readonly sortKeys: readonly string[];
  private readonly columns: Map<string, Column>;
  /** `$default`: the state at creation and after reset(). */
  private readonly dflt: readonly SortEntry[];
  private readonly collator: Intl.Collator;
  private state: readonly SortEntry[];

  /** Client class: the ids in the order shown; null while that is the membership's own order (unsorted, or sorted into it). */
  private order: string[] | null = null;
  /** The membership array `order` was last brought in line with. */
  private orderOf: string[] | null = null;
  /** Moves when `order` is recomputed: the list's visible ids read it. */
  private readonly orderSignal = new Signal();
  /** Server class: the key the resolver last launched with (or that initialData / a cached family answered). */
  private issuedKey: string | null = null;
  /** The cube's version at the last gate check: only a change of the state issues (a run starting is no reason to). */
  private seen = 0;
  private sortNodeRef?: PublicNode;

  constructor(block: unknown, readonly list: ListCube, resolve: ResolveConfig | undefined, hub: Hub) {
    super({}, list, "sort", hub);
    const { server, columns, dflt, locale } = parse(block, list, resolve);
    this.server = server;
    this.columns = columns;
    this.sortKeys = Object.freeze([...columns.keys()]);
    this.dflt = dflt;
    this.state = dflt;
    this.collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    // Nothing to issue for a client sort, or without a resolver (a server sort requires one: parse()).
    if (server && list.rs) hub.gates.add(this);
  }

  override get node(): PublicNode { return (this.sortNodeRef ??= sortNode(this)); }

  /** The sort is not part of the form. */
  protected override get bubbleTo(): Cube | null { return null; }

  /** The list orders its rows itself. */
  get client(): boolean { return !this.server; }

  // ── reads ────────────────────────────────────────────────────────────────

  get entries(): readonly SortEntry[] { track(this); return this.state; }
  get currentKey(): string | null { track(this); return this.state[0]?.key ?? null; }
  get currentDir(): SortDir | null { track(this); return this.state[0]?.dir ?? null; }

  dirOf(key: string): SortDir | null {
    track(this);
    return this.state.find((e) => e.key === key)?.dir ?? null;
  }

  /** React Aria / HeroUI `sortDescriptor`: one object per state, undefined while unsorted. */
  get descriptor(): SortDescriptor | undefined {
    return this.memo("descriptor", () => {
      const first = this.entries[0];
      return first ? { column: first.key, direction: first.dir === "asc" ? "ascending" : "descending" } : undefined;
    });
  }

  protected override signature(): unknown[] { return [this.entries]; }

  // ── server class: the resolver context and the issue gate ────────────────

  /**
   * The sort as the server applies it, as one key — what a request is
   * identified by: the params and directions, in order. `""` without a server
   * sort (a client sort, or no sort at all), so the query key of a list
   * without one stays what it was.
   */
  serverKey(): string {
    if (!this.server || this.state.length === 0) return "";
    return stableStringify(this.state.map((e) => [this.columns.get(e.key)!.param, e.dir]));
  }

  /** The resolver's `ctx.sort`, fresh for every run. A client sort never reaches the resolver (SortPlan decision 11). */
  request(): SortRequest {
    if (!this.server) return { by: [], key: "" };
    const by = this.state.map((e) => ({ key: e.key, param: this.columns.get(e.key)!.param, dir: e.dir }));
    return { by, key: this.serverKey() };
  }

  /** `ctx.sort` of a run being launched: its key becomes the issued one. */
  launch(): SortRequest {
    const req = this.request();
    if (this.server) this.issuedKey = req.key;
    return req;
  }

  /**
   * The list shows rows that answer the current sort without a launch: a
   * paginated list re-keyed onto a cached family, or `initialData` (which
   * answers `$default`). The next change is compared against it.
   */
  markIssued() { if (this.server) this.issuedKey = this.serverKey(); }

  /**
   * After every notification cycle (hub.gates): a server sort that differs
   * from the one last launched re-issues the list's resolve — a plain list
   * runs again (once more after a run in flight, with the state it then
   * has), a paginated one changes its query key and starts over at its first
   * page (Pager.invalidate). Every change of one batch is one check, so a
   * sort and a filter changed together are one request. A list that never
   * ran reads the sort on its first run.
   */
  check() {
    if (this.version === this.seen) return;
    this.seen = this.version;
    const rs = this.list.rs;
    if (!rs || rs.status === "idle" || this.serverKey() === this.issuedKey) return;
    rs.invalidate();
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /** none → asc → desc → the `$default` state (none without one); a `$default` equal to the current state steps to asc instead. */
  toggleSort(key: string) {
    this.assertKey(key);
    const cur = untracked(() => this.dirOf(key));
    let next: readonly SortEntry[];
    if (cur === null) next = [{ key, dir: "asc" }];
    else if (cur === "asc") next = [{ key, dir: "desc" }];
    else next = sameEntries(this.dflt, this.state) ? [{ key, dir: "asc" }] : this.dflt;
    this.change(next);
  }

  setSort(key: string, dir: SortDir = "asc") {
    this.assertKey(key);
    if (dir !== "asc" && dir !== "desc") {
      throw new Error(`[palistor] list.sort.set("${key}", ${JSON.stringify(dir)}) on list "${this.list.path}": the direction must be "asc" or "desc".`);
    }
    this.change([{ key, dir }]);
  }

  clearSort() { this.change(NO_SORT); }

  resetSort() { this.change(this.dflt); }

  /** The order again from the current values, the state as it is. */
  refreshOrder() { this.hub.batch(() => this.resort()); }

  /**
   * React Aria's `onSortChange`: a header press on the sorted column asks for
   * the other direction, and runs the toggle cycle (so the third press
   * clears, as with toggle); any other descriptor is set as given.
   */
  sortChange(d: SortDescriptor) {
    const key = String(d.column);
    const dir: SortDir = d.direction === "descending" ? "desc" : "asc";
    this.assertKey(key);
    const cur = untracked(() => this.dirOf(key));
    if (cur !== null && cur !== dir) this.toggleSort(key);
    else this.setSort(key, dir);
  }

  /** Every explicit sort action computes the order, whether or not the state moved. One notification. */
  private change(next: readonly SortEntry[]) {
    this.hub.batch(() => {
      if (!sameEntries(next, this.state)) {
        this.state = next.length ? Object.freeze(next.map((e) => Object.freeze({ key: e.key, dir: e.dir }))) : NO_SORT;
        this.bump();
      }
      this.resort();
    });
  }

  private assertKey(key: string) {
    if (this.columns.has(key)) return;
    throw new Error(`[palistor] unknown sort key "${key}" on list "${this.list.path}" (sortable: ${this.sortKeys.join(", ")}).`);
  }

  // ── the client order ─────────────────────────────────────────────────────

  /**
   * The membership in the order shown: the snapshot brought in line with it
   * (an id that left is gone, a new one is at the end), the membership itself
   * while unsorted. Tracks the snapshot, not the values.
   */
  ordered(ids: string[]): string[] {
    track(this.orderSignal);
    if (!this.order) return ids;
    if (ids !== this.orderOf) this.sync(ids);
    return this.order;
  }

  /**
   * The membership changed (ListCube's `ids` setter): ids that left drop out
   * of the snapshot, new ones go to the end, the rest keep their places. No
   * value is compared. A snapshot that stays the same keeps its array.
   */
  sync(ids: string[]) {
    const order = this.order;
    if (!order || ids === this.orderOf) return;
    this.orderOf = ids;
    const members = new Set(ids);
    const next = order.filter((id) => members.has(id));
    if (next.length < ids.length) {
      const placed = new Set(next);
      for (const id of ids) if (!placed.has(id)) next.push(id);
    }
    if (!sameIds(next, order)) this.order = next;
  }

  /** store.rekey: the row keeps its place under its new id (before the membership swap, which then changes nothing here). */
  rekey(oldId: string, newId: string) {
    const order = this.order;
    const i = order ? order.indexOf(oldId) : -1;
    if (i < 0) return;
    const next = order!.slice();
    next[i] = newId;
    this.order = next;
  }

  /**
   * The snapshot from the current values: the sort changed, a resolve
   * landed, setItems / restore replaced the membership, refresh(). Runs
   * inside the caller's batch. An order the list already shows keeps its
   * array and notifies nothing; `order` stays null while it is the
   * membership's own (add / remove / rekey then do to the membership exactly
   * what they would do to an equal snapshot).
   */
  resort() {
    if (this.server) return;
    const ids = this.list.windowIds();
    const shown = this.order ?? ids;
    const next = this.state.length ? untracked(() => this.sortIds(ids)) : ids;
    this.orderOf = ids;
    if (sameIds(next, shown)) return;
    this.order = next === ids ? null : next;
    this.orderSignal.bump();
    this.hub.touch();
  }

  /** A stable sort over the registry rows: every key is read once per row, ties keep the membership order (in both directions). */
  private sortIds(ids: string[]): string[] {
    const registry = this.hub.registry;
    const rows = ids.map((id) => registry.get(id));
    const cmps = this.state.map((e) => this.comparator(this.columns.get(e.key)!, e.dir, rows));
    const idx = ids.map((_, i) => i);
    idx.sort((a, b) => {
      for (const cmp of cmps) {
        const r = cmp(a, b);
        if (r !== 0) return r;
      }
      return a - b;
    });
    return idx.map((i) => ids[i]);
  }

  /** `desc` negates the comparison (not the result array), so empties stay last and ties keep their order. */
  private comparator(col: Column, dir: SortDir, rows: Array<Values | undefined>): (a: number, b: number) => number {
    const sign = dir === "desc" ? -1 : 1;
    if (col.compare) {
      const compare = col.compare;
      return (a, b) => {
        const ra = rows[a], rb = rows[b];
        if (!ra || !rb) return ra ? -1 : rb ? 1 : 0; // a row the registry lacks has nothing to compare: last
        return sign * (compare(ra, rb) || 0);
      };
    }
    const values = rows.map((row) => {
      if (!row) return undefined;
      if (col.by) return col.by(row);
      const v = getAt(row, col.path!);
      return v === getAt.MISSING ? col.dflt : v;
    });
    const empty = values.map(isSortEmpty);
    const collator = this.collator;
    return (a, b) => {
      if (empty[a] || empty[b]) return empty[a] === empty[b] ? 0 : empty[a] ? 1 : -1;
      return sign * compareValues(values[a], values[b], collator);
    };
  }
}

/**
 * `list.sort`: the state and the actions, all own enumerable keys; functions
 * keep one reference per list. No row is reachable here: the list carries the
 * rows, the sort carries the controls.
 */
function sortNode(s: SortCube): PublicNode {
  const refuse = (key: string) => () => {
    throw new Error(`[palistor] cannot assign to list.sort.${key} — use toggle(), set(), clear() or reset().`);
  };
  const reads: Array<[string, () => unknown]> = [
    ["by", () => s.entries],
    ["key", () => s.currentKey],
    ["dir", () => s.currentDir],
    ["keys", () => s.sortKeys],
    ["dirOf", () => s.fn("dirOf", () => (key: string) => s.dirOf(key))],
    ["toggle", () => s.fn("toggle", () => (key: string) => s.toggleSort(key))],
    ["set", () => s.fn("set", () => (key: string, dir?: SortDir) => s.setSort(key, dir))],
    ["clear", () => s.fn("clear", () => () => s.clearSort())],
    ["reset", () => s.fn("reset", () => () => s.resetSort())],
    ["refresh", () => s.fn("refresh", () => () => s.refreshOrder())],
    ["sortDescriptor", () => s.descriptor],
    ["onSortChange", () => s.fn("onSortChange", () => (d: SortDescriptor) => s.sortChange(d))],
  ];
  const node: PublicNode = {};
  for (const [key, get] of reads) {
    Object.defineProperty(node, key, { enumerable: true, configurable: true, get, set: refuse(key) });
  }
  Object.defineProperty(node, CUBE, { value: s });
  return Object.preventExtensions(node);
}

/**
 * A sort on a per-entity (nested) list is not supported (SortPlan decision
 * 13): warned once at construction and ignored, as warnNestedFilters does
 * for filters. Walks a root list's template, nested ones included.
 */
export function warnNestedSorts(template: CubeConfig, path: string) {
  for (const k of Object.keys(template)) {
    const sub = template[k];
    if (Array.isArray(sub)) {
      const opts = sub[1] as { sort?: unknown } | undefined;
      if (opts?.sort) console.warn(`[palistor] sort on nested list "${path}.${k}" is not supported — ignored (only a root list sorts).`);
      if (isPlainObject(sub[0])) warnNestedSorts(sub[0] as CubeConfig, `${path}.${k}[]`);
    } else if (isPlainObject(sub) && !("value" in sub) && k !== "resolve" && k !== "componentProps") {
      warnNestedSorts(sub as CubeConfig, `${path}.${k}`);
    }
  }
}
