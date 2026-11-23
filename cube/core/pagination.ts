// ─────────────────────────────────────────────────────────────────────────────
// Pagination (`resolve.pagination` on a list): pages are the source of truth,
// the list's membership is always a projection of the current window.
// Store's PaginationPlan model, bound to the cube core:
//
//   • families  — one page cache per query key: the values the resolver read
//                 (paths and `$context.` keys) plus the filter's server key.
//                 A key change starts over at `initialPage`; `maxCachedQueries`
//                 and `gcTime` decide how long an old family is kept.
//   • pages     — ids per ordinal with a fetch-time baseline (`initialIds`),
//                 the server's own row count (`fetchedCount`), a status
//                 (fresh / stale / refetching), the cursor chain and tombstones
//                 (`maxPages`). Local edits mutate `ids`, never the baseline.
//   • executor  — per-ordinal in-flight dedup, a generation gate, value-level
//                 drift detection (an A→B→A edit mid-flight is no drift),
//                 cross-page dedup and the reconcile of un-flushed local adds.
//   • the Pager is the list's `rs`: status / error / promise, the lazy first
//                 fetch, `reload`, and after every notification cycle a re-key
//                 when a value the last run read has changed.
//
// Semantics, rules and messages follow store/pagination and
// store/resolvePipeline/executePagedListResolve.ts. What is new is the binding
// to the core: the resolver's values record paths and value snapshots on read,
// the window becomes the ListCube's membership, a change is a list bump.
// ─────────────────────────────────────────────────────────────────────────────

import { isPlainObject, type ResolveConfig, type Values } from "./config";
import type { Cube } from "./cube";
import type { Hub } from "./hub";
import type { ListCube } from "./listCube";
import { stableStringify } from "./filter";
import type { ResolveStatus } from "./resolve";
import { Observer, observe, track, untracked } from "./track";

export type PageMode = "paged" | "infinite" | "cursor";
export type PageStatus = "fresh" | "stale" | "refetching";

/** The author-facing block (store's PaginationConfig). */
export interface PaginationOptions {
  pageSize: number;
  mode?: PageMode;
  base?: 0 | 1;
  initialPage?: number;
  staleTime?: number;
  maxCachedQueries?: number;
  maxCachedPages?: number;
  maxPages?: number;
  gcTime?: number;
  keepPreviousData?: boolean;
  revalidateOnHydrate?: "none" | "first" | "all";
  persist?: false | "window" | { maxPages: number };
  persistPendingAdds?: "keep" | "drop";
  queryKey?: (values: any, context: Record<string, unknown>) => unknown[];
}

interface PagerConfig {
  pageSize: number;
  mode: PageMode;
  base: 0 | 1;
  initialPage: number;
  staleTime: number;
  maxCachedQueries: number;
  maxCachedPages: number;
  maxPages: number;
  gcTime: number;
  keepPreviousData: boolean;
  revalidateOnHydrate: "none" | "first" | "all";
  persist: false | "window" | { maxPages: number };
  persistPendingAdds: "keep" | "drop";
  queryKey?: PaginationOptions["queryKey"];
}

export interface PageEntry {
  /** Ids of this page; local edits land here. */
  ids: string[];
  /** Fetch-time snapshot: the page's only dirty baseline. */
  initialIds: string[];
  /** Rows the server returned for this ordinal, before cross-page dedup (the infinite continuation counts these). */
  fetchedCount: number;
  status: PageStatus;
  fetchedAt: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  /** Rows left memory (head-truncated or trimmed from storage); only `fetchedCount` is kept. */
  tombstone?: boolean;
}

export interface Family {
  queryKeyHash: string;
  /** Paths whose values form the key. */
  dependencies: Set<string>;
  /** false until a completed run refined `dependencies` from what it read. */
  settled: boolean;
  pages: Map<number, PageEntry>;
  /** LRU order of ordinals (`maxCachedPages`). */
  order: number[];
  inFlight: Map<number, Promise<unknown>>;
  /** Server truth: set from `total`, ±1 on rekey promotion / delete of a server row; never by optimistic edits. */
  serverTotal?: number;
  nextCursor?: string | null;
  lastActiveAt: number;
  /** ordinal → the cursor that fetched it (null for the chain head). */
  cursors: Map<number, string | null>;
  /** "hydrated" while the chain runs off cursors restored from storage. */
  continuationTrust: "live" | "hydrated";
  continuationLost: boolean;
  gcTimer?: ReturnType<typeof setTimeout> | null;
}

/** `ctx.page` of the resolver. */
export interface PageRequest {
  page: number;
  pageSize: number;
  offset: number;
  cursor?: string | null;
  queryKey: string;
}

interface PagedResult {
  items: Values[];
  total?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface PersistPage {
  ordinal: number;
  ids: string[];
  initialIds: string[];
  fetchedCount: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  tombstone?: boolean;
}

/** `__pagination[listPath]` in a persisted snapshot (store's v2 blob). */
export interface PersistBlob {
  v: 2;
  fingerprint: { mode: PageMode; pageSize: number; base: 0 | 1 };
  savedAt: number;
  currentPage: number;
  loadedOrdinals: number[];
  serverTotal?: number;
  deps: string[];
  settled: boolean;
  depValues: Array<[string, unknown]>;
  queryKeyAtSave?: string;
  pages: PersistPage[];
  cursors?: Array<[number, string | null]>;
  pendingAdds?: string[];
  anchorId?: string;
  entities?: Record<string, Values>;
}

/** Drifted runs in a row before a paginated resolver is treated as a dependency cycle (store: MAX_AUTO_RETRIGGERS). */
const MAX_DRIFT_RUNS = 10;
/** Pseudo dep path: the filter's server key, committed when the filter gate issues. */
const FILTER_DEP = "$filter";

const noop = () => undefined;
const same = (a: unknown, b: unknown) => a === b || stableStringify(a) === stableStringify(b);

function clone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  try { return structuredClone(v); } catch { return v; }
}

const dedupe = (ids: string[]) => (ids.length < 2 ? ids.slice() : [...new Set(ids)]);
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const isTmpId = (id: string) => id.startsWith("_tmp_");

/** The exact encoding of a query key: dep pairs sorted by path. */
const keyFromPairs = (pairs: Array<[string, unknown]>) =>
  stableStringify([...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

/** A bare array is `{ items }` (no precise total). */
function normalizeResult(raw: unknown): PagedResult {
  if (Array.isArray(raw)) return { items: raw as Values[] };
  if (isPlainObject(raw) && Array.isArray(raw.items)) return raw as PagedResult;
  return { items: [] };
}

/** store's createPaginationState: validate the block, fill the defaults. */
function normalizeOptions(o: PaginationOptions, listPath: string): PagerConfig {
  const fail = (msg: string): never => { throw new Error(`[palistor] ${msg}`); };
  const { pageSize } = o;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    fail(`pagination.pageSize on list "${listPath}" must be a positive integer (got ${String(pageSize)}).`);
  }
  const mode = o.mode ?? "paged";
  if (mode !== "paged" && mode !== "infinite" && mode !== "cursor") {
    fail(`pagination.mode "${mode}" on list "${listPath}" is not a page mode (expected "paged" | "infinite" | "cursor").`);
  }
  const base = o.base ?? 1;
  if (base !== 0 && base !== 1) fail(`pagination.base on list "${listPath}" must be 0 or 1.`);
  const initialPage = o.initialPage ?? base;
  if (!Number.isInteger(initialPage) || initialPage < base) {
    fail(`pagination.initialPage on list "${listPath}" must be an integer >= base (${base}).`);
  }
  const maxPages = o.maxPages ?? Infinity;
  if (maxPages !== Infinity && (!Number.isInteger(maxPages) || maxPages < 1)) {
    fail(`pagination.maxPages on list "${listPath}" must be a positive integer or Infinity.`);
  }
  // Bounded by default: storing more pages than the window holds is unreachable, so the cap is clamped to maxPages.
  let persist: PagerConfig["persist"];
  if (o.persist === false || o.persist === "window") persist = o.persist;
  else if (o.persist === undefined) persist = { maxPages: Math.min(3, maxPages) };
  else {
    const max = (o.persist as { maxPages?: unknown }).maxPages;
    if (!Number.isInteger(max) || (max as number) < 1) {
      fail(`pagination.persist.maxPages on list "${listPath}" must be a positive integer.`);
    }
    persist = { maxPages: Math.min(max as number, maxPages) };
  }
  return {
    pageSize,
    mode,
    base,
    initialPage,
    staleTime: o.staleTime ?? Infinity,
    maxCachedQueries: Math.max(1, o.maxCachedQueries ?? 1),
    maxCachedPages: o.maxCachedPages ?? Infinity,
    maxPages,
    gcTime: o.gcTime ?? Infinity,
    keepPreviousData: o.keepPreviousData ?? false,
    revalidateOnHydrate: o.revalidateOnHydrate ?? "first",
    persist,
    persistPendingAdds: o.persistPendingAdds ?? "keep",
    ...(o.queryKey ? { queryKey: o.queryKey } : {}),
  };
}

/**
 * The page cache of one list (a root list, or one per-entity instance of a
 * nested list). Field names follow store's PaginationState.
 */
export class Pager {
  readonly mode: PageMode;
  pageSize: number;
  readonly base: 0 | 1;
  /** Diagnostics; a nested instance is `<ownerId>.<key>`. Also the self slot the resolver must not key on. */
  readonly listPath: string;
  currentQueryKey: string | null = null;
  /** paged / cursor: the active ordinal. */
  currentPage: number;
  /** infinite: ordinals in the window (joined on success); paged / cursor: `[currentPage]`. */
  loadedOrdinals: number[];
  readonly families = new Map<string, Family>();
  private familyOrder: string[] = [];
  /** Bumped on reset / evict / key change / forced issue: an older completion writes nothing. */
  generation = 0;
  readonly config: PagerConfig;
  private readonly warned = new Set<string>();
  /** keepPreviousData: the window still shows the previous key's rows. */
  isPreviousData = false;
  /** The window came from storage already past staleTime. */
  isStaleFromStorage = false;
  scrollAnchor: string | null = null;

  // ── resolve state (the list's `rs`) ────────────────────────────────────────
  status: ResolveStatus = "idle";
  error: unknown = null;
  promise: Promise<unknown> | null = null;
  private scheduled = false;
  private disposed = false;
  private driftRuns = 0;
  /** The drift cap tripped: no automatic re-key until a user action. */
  private capped = false;
  /** The filter's server key the current key is built with (moves only when the filter gate issues or a fetch launches). */
  private filterKey = "";
  /** checkDeps: the sources the last key computation read, the family and dep count it was for. */
  private keyObs: { obs: Observer; fam: Family; size: number; opaque: boolean } | null = null;

  /** The list cube the pager works through; a per-entity pager follows another view of the owner when this one goes. */
  list: ListCube;

  constructor(list: ListCube, readonly resolve: ResolveConfig, readonly hub: Hub) {
    this.list = list;
    const owner = list.item;
    this.listPath = owner ? `${owner.entityId}.${list.key}` : list.path;
    this.config = normalizeOptions(resolve.pagination as PaginationOptions, this.listPath);
    this.mode = this.config.mode;
    this.pageSize = this.config.pageSize;
    this.base = this.config.base;
    this.currentPage = this.config.initialPage;
    // infinite: the window is empty until the first page succeeds.
    this.loadedOrdinals = this.mode === "infinite" ? [] : [this.config.initialPage];
  }

  get lazy() { return this.resolve.options?.lazy !== false; }

  private warnOnce(topic: string, message: string) {
    if (this.warned.has(topic)) return;
    this.warned.add(topic);
    console.warn(message);
  }

  /** One notification for whatever the caller changed. */
  private changed() { this.hub.batch(() => this.list.bump()); }

  // ── window ────────────────────────────────────────────────────────────────

  currentFamily(): Family | undefined {
    return this.currentQueryKey === null ? undefined : this.families.get(this.currentQueryKey);
  }

  private windowOrdinals(): number[] { return this.mode === "infinite" ? this.loadedOrdinals : [this.currentPage]; }

  /** infinite: derived from what loaded, never a stored `currentPage++`. */
  currentPageOf(): number {
    if (this.mode !== "infinite") return this.currentPage;
    return this.loadedOrdinals.length === 0 ? this.config.initialPage : Math.max(...this.loadedOrdinals);
  }

  private nextOrdinal(): number {
    return this.loadedOrdinals.length === 0 ? this.config.initialPage : Math.max(...this.loadedOrdinals) + 1;
  }

  private appendOrdinal(o: number) {
    if (this.loadedOrdinals.includes(o)) return;
    this.loadedOrdinals = [...this.loadedOrdinals, o].sort((a, b) => a - b);
  }

  /**
   * Window → the list's membership and baseline. paged: display-level
   * boundary reflow — a page short of a removed server row borrows the head
   * of a STALE successor (the row that now sits in its last slot server-side)
   * without writing any entry.
   */
  project() {
    const fam = this.currentFamily();
    if (!fam) { this.list.setWindow([], []); return; }
    const ids: string[] = [];
    const initial: string[] = [];
    for (const o of this.windowOrdinals()) {
      const entry = fam.pages.get(o);
      if (!entry) {
        this.warnOnce(`missing:${o}`, `[palistor] pagination invariant: window ordinal ${o} of list "${this.listPath}" has no cached page.`);
        continue;
      }
      ids.push(...entry.ids);
      initial.push(...entry.initialIds);
    }
    if (this.mode === "paged") {
      const next = fam.pages.get(this.currentPage + 1);
      if (fam.pages.has(this.currentPage) && next && next.status === "stale" && !next.tombstone && ids.length < this.pageSize) {
        const have = new Set(ids);
        for (const id of next.ids) {
          if (ids.length >= this.pageSize) break;
          if (!have.has(id)) { ids.push(id); have.add(id); }
        }
      }
    }
    this.list.setWindow(dedupe(ids), dedupe(initial));
  }

  /** The visible ids, without waking the lazy fetch (tests, persist). */
  get windowIds(): string[] { return this.list.windowIds(); }

  // ── values the resolver reads, and the query key ──────────────────────────

  /** What the resolver's values come from: the form, or (nested) the owner's row. */
  private get baseCube(): Cube { return this.list.item ?? this.hub.root; }

  private isSelf(path: string) { return path === this.listPath || path.startsWith(this.listPath + "."); }

  private hasFilterDep(): boolean { return !!this.list.filter?.hasServer; }

  private liveFilterKey(): string { return this.list.filter?.hasServer ? this.list.filter.serverKey() : ""; }

  /**
   * Live value at a dep path, tracked: a `$context.` key, the committed
   * filter key, or a values path under the base group. Returns whether the
   * read is opaque to version tracking (a group or list value).
   */
  private readDep(path: string): { value: unknown; opaque: boolean } {
    if (path === FILTER_DEP) return { value: this.filterKey, opaque: false };
    if (path.startsWith("$context.")) {
      const k = path.slice(9);
      track(this.hub.contextKey(k));
      return { value: this.hub.context[k], opaque: false };
    }
    const base = this.baseCube;
    if (path === "id" && base.entityId !== undefined && !base.children.has("id")) return { value: base.idValue(), opaque: false };
    const c = base.find(path);
    if (!c) return { value: undefined, opaque: false };
    if (c.kind === "leaf") return { value: c.value, opaque: false };
    return { value: untracked(() => c.plain()), opaque: true };
  }

  private depValue(path: string): unknown { return untracked(() => this.readDep(path).value); }

  /** The dep set the first fetch keys on: explicit `deps` plus the filter's server key. */
  private bootstrapDeps(): Set<string> {
    const deps = new Set<string>();
    for (const d of this.resolve.deps ?? []) if (!this.isSelf(d)) deps.add(d);
    if (this.hasFilterDep()) deps.add(FILTER_DEP);
    return deps;
  }

  /** Stable JSON over the dep values. The page is never part of it. */
  private computeKey(deps: Iterable<string>): string {
    if (this.config.queryKey) return stableStringify(this.config.queryKey(this.baseCube.values, this.hub.context));
    const pairs: Array<[string, unknown]> = [];
    for (const d of deps) if (!this.isSelf(d)) pairs.push([d, this.readDep(d).value]);
    return keyFromPairs(pairs);
  }

  /**
   * The resolver's `values`: the base group's tree, each read recorded as
   * (path, snapshot) and repeatable; writes are contained. The list's own
   * slot is excluded from the key (and warned about once).
   */
  private bindValues(group: Cube, prefix: string, rec: Map<string, unknown>): Values {
    const out: Values = {};
    const record = (path: string, read: () => unknown) => {
      if (!rec.has(path)) rec.set(path, clone(untracked(read)));
      return rec.get(path);
    };
    if (group.entityId !== undefined && !prefix) {
      Object.defineProperty(out, "id", { enumerable: true, configurable: true, get: () => record("id", () => group.entityId), set: noop });
    }
    const skipLists = this.list.item !== null;
    for (const [k, child] of group.children) {
      if (skipLists && child.kind === "list") continue;
      const path = prefix ? `${prefix}.${k}` : k;
      let nested: Values | undefined;
      Object.defineProperty(out, k, {
        enumerable: true,
        configurable: true,
        get: () => {
          if (child === this.list) {
            this.warnOnce(
              "self-read",
              `[palistor] the resolver of paginated list "${this.listPath}" reads its own slot ` +
                `(values.${this.listPath}) — that deep-copies the whole window and is excluded from ` +
                `the queryKey; use ctx.page for "what is loaded".`,
            );
            return clone(untracked(() => child.plain()));
          }
          if (child.kind === "group") return (nested ??= this.bindValues(child, path, rec));
          return record(path, () => (child.kind === "leaf" ? child.value : child.plain()));
        },
        set: noop,
      });
    }
    return out;
  }

  // ── families ──────────────────────────────────────────────────────────────

  private touchFamily(hash: string) {
    this.familyOrder = [...this.familyOrder.filter((k) => k !== hash), hash];
  }

  private getOrCreateFamily(hash: string, deps: Iterable<string>, settled: boolean, now: number): Family {
    let fam = this.families.get(hash);
    if (!fam) {
      fam = {
        queryKeyHash: hash,
        dependencies: new Set(deps),
        settled,
        pages: new Map(),
        order: [],
        inFlight: new Map(),
        lastActiveAt: now,
        cursors: new Map(),
        continuationTrust: "live",
        continuationLost: false,
      };
      this.families.set(hash, fam);
    }
    fam.lastActiveAt = now;
    clearGc(fam);
    this.touchFamily(hash);
    return fam;
  }

  /** gcTime: an inactive family still not current after `gcTime` is dropped. */
  private scheduleGc(fam: Family) {
    clearGc(fam);
    const { gcTime } = this.config;
    if (!Number.isFinite(gcTime)) return;
    const timer = setTimeout(() => {
      fam.gcTimer = null;
      if (this.currentQueryKey === fam.queryKeyHash || this.families.get(fam.queryKeyHash) !== fam) return;
      this.families.delete(fam.queryKeyHash);
      this.familyOrder = this.familyOrder.filter((k) => k !== fam.queryKeyHash);
    }, gcTime);
    (timer as unknown as { unref?: () => void }).unref?.();
    fam.gcTimer = timer;
  }

  /** Families beyond `maxCachedQueries` (LRU) go, never the current one. */
  private enforceFamilyCap() {
    while (this.familyOrder.length > this.config.maxCachedQueries) {
      const victim = this.familyOrder.find((k) => k !== this.currentQueryKey);
      if (victim === undefined) break;
      this.familyOrder = this.familyOrder.filter((k) => k !== victim);
      const fam = this.families.get(victim);
      if (fam) clearGc(fam);
      this.families.delete(victim);
    }
  }

  /** A widened dep set with unchanged values renames the family in place. */
  private renameFamily(fam: Family, hash: string) {
    const old = fam.queryKeyHash;
    if (old === hash) return;
    this.families.delete(old);
    this.families.set(hash, fam);
    fam.queryKeyHash = hash;
    this.familyOrder = [...this.familyOrder.filter((k) => k !== old && k !== hash), hash];
    if (this.currentQueryKey === old) this.currentQueryKey = hash;
  }

  /**
   * The family the next fetch files under, from live values: same key → no-op;
   * a different key supersedes the in-flight fetches, resets the pointer and
   * carries the settled dep set over (deps belong to the resolver).
   */
  private ensureFamily(now: number): { fam: Family; keyChanged: boolean } {
    const prev = this.currentFamily();
    if (!prev) this.filterKey = this.liveFilterKey();
    const deps = prev?.dependencies ?? this.bootstrapDeps();
    const hash = untracked(() => this.computeKey(deps));
    if (prev && this.currentQueryKey === hash) {
      prev.lastActiveAt = now;
      this.touchFamily(hash);
      return { fam: prev, keyChanged: false };
    }
    const keyChanged = this.currentQueryKey !== null && this.currentQueryKey !== hash;
    if (keyChanged) {
      this.generation++;
      this.currentPage = this.config.initialPage;
      this.loadedOrdinals = this.mode === "infinite" ? [] : [this.config.initialPage];
      this.isStaleFromStorage = false;
      if (prev) this.scheduleGc(prev);
    }
    this.currentQueryKey = hash;
    const fam = this.getOrCreateFamily(hash, deps, prev?.settled ?? false, now);
    this.enforceFamilyCap();
    return { fam, keyChanged };
  }

  private clearFamilies() {
    for (const fam of this.families.values()) clearGc(fam);
    this.families.clear();
    this.familyOrder = [];
    this.currentQueryKey = null;
    this.currentPage = this.config.initialPage;
    this.loadedOrdinals = this.mode === "infinite" ? [] : [this.config.initialPage];
    this.isPreviousData = false;
    this.isStaleFromStorage = false;
    this.generation++;
    this.keyObs = null;
    this.list.setWindow([], []);
  }

  // ── pages ─────────────────────────────────────────────────────────────────

  private touchPage(fam: Family, o: number) { fam.order = [...fam.order.filter((x) => x !== o), o]; }

  /** LRU beyond `max`, skipping window ordinals; tombstones are never counted nor evicted. */
  private evictPages(fam: Family) {
    const max = this.config.maxCachedPages;
    if (!Number.isFinite(max)) return;
    const pinned = this.windowOrdinals();
    const live = () => { let n = 0; for (const e of fam.pages.values()) if (!e.tombstone) n++; return n; };
    while (live() > max) {
      const victim = fam.order.find((o) => !pinned.includes(o) && !fam.pages.get(o)?.tombstone);
      if (victim === undefined) break;
      fam.order = fam.order.filter((o) => o !== victim);
      fam.pages.delete(victim);
    }
  }

  /** Past staleTime: served, revalidated behind (distinct from status "stale", whose rows are known wrong). */
  private isExpired(e: PageEntry, now: number) {
    return this.config.staleTime !== Infinity && now - e.fetchedAt >= this.config.staleTime;
  }

  private isFresh(e: PageEntry, now: number) { return e.status === "fresh" && !this.isExpired(e, now); }

  private entryFor(fam: Family, o: number): PageEntry {
    let e = fam.pages.get(o);
    if (!e) {
      e = { ids: [], initialIds: [], fetchedCount: 0, status: "stale", fetchedAt: Date.now() };
      fam.pages.set(o, e);
      this.touchPage(fam, o);
    }
    return e;
  }

  private findPage(fam: Family, id: string): number | undefined {
    for (const [o, e] of fam.pages) if (e.ids.includes(id)) return o;
    return undefined;
  }

  private markStaleAfter(fam: Family, o: number) {
    for (const [x, e] of fam.pages) if (x > o && e.status === "fresh") e.status = "stale";
  }

  private markFamilyStale(fam: Family) {
    for (const e of fam.pages.values()) if (e.status === "fresh") e.status = "stale";
  }

  /** paged: once ordinal `o` lands fresh, a predecessor short of server truth can no longer borrow — it refetches on its next visit. */
  private staleShortPredecessor(fam: Family, o: number) {
    if (this.mode !== "paged") return;
    const prev = fam.pages.get(o - 1);
    if (!prev || prev.tombstone || prev.status !== "fresh") return;
    if (prev.fetchedCount < this.pageSize && prev.fetchedCount > 0) prev.status = "stale";
  }

  // ── cursor chain / continuation ───────────────────────────────────────────

  private cursorFor(fam: Family, o: number): string | null | undefined {
    if (o === this.base) return null;
    if (fam.cursors.has(o)) return fam.cursors.get(o);
    return fam.pages.get(o - 1)?.nextCursor;
  }

  /** infinite: Σ fetchedCount over loaded ordinals and tombstones before `o` (never Σ|ids|: dedup would shift every later offset). */
  private continuationOffset(fam: Family, o: number): number {
    if (this.mode !== "infinite") return (o - this.base) * this.pageSize;
    let sum = 0;
    for (const [x, e] of fam.pages) if (x < o && (e.tombstone || this.loadedOrdinals.includes(x))) sum += e.fetchedCount;
    return sum;
  }

  private fetchedSoFar(fam: Family): number {
    let sum = 0;
    for (const [x, e] of fam.pages) if (e.tombstone || this.loadedOrdinals.includes(x)) sum += e.fetchedCount;
    return sum;
  }

  private isTruncated(fam: Family, o: number): boolean {
    return this.mode === "infinite" && !!fam.pages.get(o)?.tombstone && !this.loadedOrdinals.includes(o);
  }

  /** maxPages (infinite): the window sheds its head into tombstones; un-flushed local rows move onto the new head. */
  private truncateHead() {
    const max = this.config.maxPages;
    const fam = this.currentFamily();
    if (this.mode !== "infinite" || !Number.isFinite(max) || !fam || this.loadedOrdinals.length <= max) return;
    const dropped = this.loadedOrdinals.slice(0, this.loadedOrdinals.length - max);
    this.loadedOrdinals = this.loadedOrdinals.slice(dropped.length);
    const harvested: string[] = [];
    for (const o of dropped) {
      const e = fam.pages.get(o);
      if (!e) continue;
      const init = new Set(e.initialIds);
      for (const id of e.ids) if (!init.has(id)) harvested.push(id);
      fam.pages.set(o, { ids: [], initialIds: [], fetchedCount: e.fetchedCount, status: "stale", fetchedAt: e.fetchedAt, tombstone: true });
      fam.order = fam.order.filter((x) => x !== o);
    }
    const head = fam.pages.get(this.loadedOrdinals[0]);
    if (head && harvested.length) {
      const present = new Set(head.ids);
      head.ids = [...harvested.filter((id) => !present.has(id)), ...head.ids];
    }
  }

  /**
   * TRUNCATING invalidation (cursor + infinite): a refetched ordinal orphans
   * every later one (their cursors came from its old response). Local-only
   * rows of the dropped pages move onto the survivor.
   */
  private truncateChain(o: number) {
    const fam = this.currentFamily();
    if (!fam) return;
    const harvested: string[] = [];
    for (const [x, e] of [...fam.pages]) {
      if (x <= o) continue;
      const init = new Set(e.initialIds);
      for (const id of e.ids) if (!init.has(id)) harvested.push(id);
      fam.pages.delete(x);
      fam.order = fam.order.filter((y) => y !== x);
    }
    for (const x of [...fam.cursors.keys()]) if (x > o + 1) fam.cursors.delete(x);
    this.loadedOrdinals = this.loadedOrdinals.filter((x) => x <= o);
    if (this.currentPage > o) this.currentPage = o;
    this.generation++;
    const survivor = fam.pages.get(o);
    if (survivor?.tombstone) {
      delete survivor.tombstone;
      this.touchPage(fam, o);
      if (this.mode === "infinite" && !this.loadedOrdinals.includes(o)) this.loadedOrdinals = [o];
    }
    if (survivor) for (const id of harvested) if (!survivor.ids.includes(id)) survivor.ids.push(id);
    this.project();
  }

  // ── derived accounting ────────────────────────────────────────────────────

  private localDelta(fam: Family): number {
    let d = 0;
    for (const e of fam.pages.values()) d += e.ids.length - e.initialIds.length;
    return d;
  }

  private contiguousPages(fam: Family): number {
    let n = 0;
    for (let o = this.base; ; o++) {
      const e = fam.pages.get(o);
      if (!e || e.status === "stale") break;
      n++;
    }
    return n;
  }

  get pageCount(): number {
    track(this.list);
    const fam = this.currentFamily();
    if (!fam) return 0;
    if (fam.serverTotal != null) return Math.ceil(fam.serverTotal / this.pageSize);
    return this.contiguousPages(fam);
  }

  /** Display total: server truth plus the local delta (undefined while the total is unknown). */
  get total(): number | undefined {
    track(this.list);
    const fam = this.currentFamily();
    if (!fam || fam.serverTotal == null) return undefined;
    return Math.max(0, fam.serverTotal + this.localDelta(fam));
  }

  get serverTotal(): number | undefined { track(this.list); return this.currentFamily()?.serverTotal; }

  get page(): number { track(this.list); return this.currentPageOf(); }

  /** Never moved by local edits: fullness is a fetch-time fact (`fetchedCount`), `serverTotal` moves only on server truth. */
  get hasNextPage(): boolean {
    track(this.list);
    const fam = this.currentFamily();
    if (!fam || fam.continuationLost) return false;
    if (this.mode === "infinite") {
      if (this.loadedOrdinals.length === 0) return true;
      const entry = fam.pages.get(Math.max(...this.loadedOrdinals));
      if (fam.serverTotal != null) return this.fetchedSoFar(fam) < fam.serverTotal;
      if (!entry) return false;
      if (entry.nextCursor != null) return true;
      if (entry.hasMore !== undefined) return entry.hasMore;
      return entry.fetchedCount === this.pageSize;
    }
    const entry = fam.pages.get(this.currentPage);
    if (this.mode === "cursor") {
      if (entry?.nextCursor != null || fam.cursors.has(this.currentPage + 1) || fam.pages.has(this.currentPage + 1)) return true;
      if (!entry) return false;
      if (entry.hasMore !== undefined) return entry.hasMore;
      if (fam.serverTotal != null) return this.currentPage < this.base + this.pageCount - 1;
      return entry.fetchedCount === this.pageSize;
    }
    if (fam.serverTotal != null) return this.currentPage < this.base + this.pageCount - 1;
    if (!entry) return false;
    if (entry.hasMore !== undefined) return entry.hasMore;
    return entry.fetchedCount === this.pageSize;
  }

  get hasPrevPage(): boolean { track(this.list); return this.currentPage > this.base; }

  get isFetching(): boolean { track(this.list); return (this.currentFamily()?.inFlight.size ?? 0) > 0; }

  /** Never a skeleton while the previous query's rows are on screen. True from the first read on: a fetch that is due counts. */
  get isInitialLoading(): boolean {
    return (this.isFetching || this.due) && !this.isPreviousData && !this.currentFamily()?.pages.size;
  }

  /** A footer spinner: false while the window is still empty (that is isInitialLoading). */
  get isFetchingNextPage(): boolean {
    track(this.list);
    return this.loadedOrdinals.length > 0 && (this.currentFamily()?.inFlight.has(this.nextOrdinal()) ?? false);
  }

  get continuationLost(): boolean { track(this.list); return this.currentFamily()?.continuationLost ?? false; }

  /** Frozen per-ordinal snapshot of the window. */
  get loadedPages(): ReadonlyArray<{ ordinal: number; ids: readonly string[] }> {
    track(this.list);
    const fam = this.currentFamily();
    if (!fam) return Object.freeze([]);
    const out: Array<{ ordinal: number; ids: readonly string[] }> = [];
    for (const o of this.windowOrdinals()) {
      const e = fam.pages.get(o);
      if (e) out.push(Object.freeze({ ordinal: o, ids: Object.freeze([...e.ids]) }));
    }
    return Object.freeze(out);
  }

  /** Ids in a cached page's `ids` but not in its baseline: un-flushed adds. */
  get pendingAdds(): string[] {
    track(this.list);
    const fam = this.currentFamily();
    const out: string[] = [];
    if (!fam) return out;
    for (const e of fam.pages.values()) {
      const init = new Set(e.initialIds);
      for (const id of e.ids) if (!init.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
  }

  /** The aggregate per-page rollup over every cached page of the current family, in every mode. */
  isDirty(): boolean {
    const fam = this.currentFamily();
    if (!fam) return false;
    for (const e of fam.pages.values()) if (!sameIds(e.ids, e.initialIds)) return true;
    return false;
  }

  // ── the executor ──────────────────────────────────────────────────────────

  /**
   * Fetch ordinal `requested` of the current family. `force` bypasses the
   * in-flight dedup and supersedes the running fetch; `prefetch` never joins
   * the window. The promise settles on the run and never carries its error.
   */
  fetch(requested: number, force = false, prefetch = false): Promise<unknown> {
    if (this.disposed) return Promise.resolve();
    const hub = this.hub;
    // Server mode: no request before store.start(), which fetches the current page.
    if (hub.held) { hub.deferred.add(this); return Promise.resolve(); }
    const resolve = this.resolve;
    const now = Date.now();
    // A launch reads the live filter: a fetch during the filter's debounce runs (and is keyed) with it.
    this.filterKey = this.liveFilterKey();

    // 1. Family + key at ISSUE time; a key that moved under us restarts at initialPage.
    const { fam, keyChanged } = this.ensureFamily(now);
    const ordinal = keyChanged ? this.config.initialPage : requested;
    if (keyChanged) {
      if (this.config.keepPreviousData) this.isPreviousData = true;
      else this.project();
    }
    // A head-truncated ordinal is never re-fetched in place (only refetch() brings the head back).
    if (this.isTruncated(fam, ordinal)) return Promise.resolve();

    // 2. Per-family, per-ordinal dedup (implicit issuance only).
    if (!force) {
      const existing = fam.inFlight.get(ordinal);
      if (existing) return existing;
    } else this.generation++;
    const gen = this.generation;

    const prevEntry = fam.pages.get(ordinal);
    const prevStatus = prevEntry?.status;
    if (prevEntry) prevEntry.status = "refetching";

    let begin!: () => void;
    const promise: Promise<unknown> = new Promise((res, rej) => { begin = () => run().then(res, rej); });
    fam.inFlight.set(ordinal, promise);
    this.promise = promise;
    this.status = "pending";
    this.error = null;
    this.changed();

    // Eager snapshots of the known dep set: closes the gap between launch and the resolver's first read.
    const eager = new Map<string, unknown>();
    const known = new Set<string>(resolve.deps ?? []);
    for (const d of fam.dependencies) known.add(d);
    for (const d of known) if (!this.isSelf(d)) eager.set(d, clone(this.depValue(d)));

    const filterCtx = this.list.filter?.launch().filter ?? { values: {}, params: undefined, key: "" };
    // infinite + offset: the continuation, re-checked at completion (a delete mid-flight shifts it).
    const expectedOffset = this.continuationOffset(fam, ordinal);
    const req: PageRequest = { page: ordinal, pageSize: this.pageSize, offset: expectedOffset, queryKey: fam.queryKeyHash };
    if (this.mode !== "paged") req.cursor = this.cursorFor(fam, ordinal) ?? null;
    const onHydratedCursor = this.mode !== "paged" && fam.continuationTrust === "hydrated" && req.cursor != null;

    let released = false;
    /** Identity-checked in-flight release and status settle; idempotent. */
    const release = (outcome: "success" | "error" | "noop") => {
      if (released) return;
      released = true;
      if (fam.inFlight.get(ordinal) === promise) fam.inFlight.delete(ordinal);
      const drained = (this.currentFamily()?.inFlight.size ?? 0) === 0;
      if (outcome === "success") {
        this.error = null;
        this.status = drained ? "resolved" : "pending";
      } else if (outcome === "noop" && drained && this.status === "pending") this.status = "resolved";
      this.list.bump();
    };
    const restorePrevEntry = () => {
      if (prevEntry && fam.pages.get(ordinal) === prevEntry && prevEntry.status === "refetching") {
        prevEntry.status = prevStatus === "fresh" ? "stale" : (prevStatus ?? "stale");
      }
    };
    const superseded = () => gen !== this.generation || this.families.get(fam.queryKeyHash) !== fam;

    const rec = new Map<string, unknown>();
    const ctxRec = new Map<string, unknown>();
    /** Everything the run read joins the family's key-formation set. */
    const foldDeps = () => {
      for (const path of rec.keys()) if (!this.isSelf(path)) fam.dependencies.add(path);
      for (const k of ctxRec.keys()) fam.dependencies.add(`$context.${k}`);
      if (this.hasFilterDep()) fam.dependencies.add(FILTER_DEP);
      this.keyObs = null;
    };

    const run = async (): Promise<unknown> => {
      try {
        const values = this.bindValues(this.baseCube, "", rec);
        const startCtx = hub.context;
        const context = new Proxy(startCtx, {
          get(target, key) {
            if (typeof key === "string" && !ctxRec.has(key)) ctxRec.set(key, target[key]);
            return Reflect.get(target, key);
          },
        });
        const store = Object.create(hub.store as object, { context: { value: context } });
        const ctx = { filter: filterCtx, page: req, queryKey: fam.queryKeyHash };
        const raw = await untracked(() => resolve.resolver(values, store, ctx));

        return hub.batch(() => {
          if (superseded()) { release("noop"); return raw; }
          // Drift: per-path value equality (eager snapshots, then what the run read), the context, and the settled key.
          let drift = false;
          for (const [path, snap] of eager) if (!same(snap, this.depValue(path))) { drift = true; break; }
          if (!drift) for (const [path, snap] of rec) if (!this.isSelf(path) && !same(snap, this.depValue(path))) { drift = true; break; }
          if (!drift) for (const [k, v] of ctxRec) if (hub.context[k] !== v) { drift = true; break; }
          if (!drift && fam.settled && untracked(() => this.computeKey(fam.dependencies)) !== fam.queryKeyHash) drift = true;

          // infinite + offset: a delete / promotion landed mid-flight — discard, reissue at the corrected offset.
          if (!drift && this.mode === "infinite" && req.cursor == null && this.continuationOffset(fam, ordinal) !== expectedOffset) {
            foldDeps();
            restorePrevEntry();
            release("noop");
            void this.fetch(ordinal, true);
            return raw;
          }
          if (drift) {
            // Released before the re-key, so a reverted key does not dedup against this dying promise.
            foldDeps();
            restorePrevEntry();
            release("noop");
            this.retriggerAfterDrift();
            return raw;
          }
          this.ingest(fam, ordinal, normalizeResult(raw), req, prefetch);
          foldDeps();
          // A widened dep set with unchanged values renames the family in place (never an eviction).
          const refined = untracked(() => this.computeKey(fam.dependencies));
          if (refined !== fam.queryKeyHash) this.renameFamily(fam, refined);
          fam.settled = true;
          // paged / cursor: the page must BE the current one; infinite: window membership.
          const inWindow = this.mode === "infinite" ? this.loadedOrdinals.includes(ordinal) : ordinal === this.currentPage;
          if (this.currentFamily() === fam && inWindow) {
            this.isPreviousData = false;
            this.isStaleFromStorage = false;
            this.project();
          }
          this.driftRuns = 0;
          release("success");
          return raw;
        });
      } catch (err) {
        hub.batch(() => {
          if (superseded()) { release("noop"); return; }
          restorePrevEntry();
          foldDeps();
          if (onHydratedCursor) {
            // A cursor restored from storage is older than the round-trip: rebuild the chain, not an error.
            fam.cursors.delete(ordinal);
            fam.continuationTrust = "live";
            release("noop");
            void this.rebuildContinuation(ordinal);
            return;
          }
          this.status = "error";
          this.error = err;
          release("error");
          try { resolve.onError?.(err, { notify: hub.notify }); } catch { /* onError must not break the store */ }
        });
        return undefined;
      } finally {
        if (!released) hub.batch(() => release("noop"));
      }
    };

    begin();
    return promise;
  }

  /** A successful page: rows into the registry, the entry (dedup + reconcile), the chain, the window. */
  private ingest(fam: Family, ordinal: number, norm: PagedResult, req: PageRequest, prefetch: boolean) {
    const owner = this.list.item;
    const fetchedIds = [...new Set(norm.items.length ? this.hub.setRows(norm.items) : [])];
    if (owner) for (const id of fetchedIds) this.hub.registry.setOwner(id, owner.entityId!, this.list.config);
    // Cross-page dedup: ids held by another page of this family are dropped (pages being replaced excepted).
    const elsewhere = new Set<string>();
    for (const [o, e] of fam.pages) {
      if (o === ordinal || e.status === "refetching") continue;
      for (const id of e.ids) elsewhere.add(id);
    }
    const ids = fetchedIds.filter((id) => !elsewhere.has(id));
    // Reconcile, never skip: local-only rows of the old entry are re-appended.
    const old = fam.pages.get(ordinal);
    let next = ids;
    if (old) {
      const oldInit = new Set(old.initialIds);
      const fetched = new Set(ids);
      const local = old.ids.filter((id) => !oldInit.has(id) && !fetched.has(id) && !elsewhere.has(id));
      if (local.length) next = [...ids, ...local];
    }
    const entry: PageEntry = { ids: next, initialIds: [...ids], fetchedCount: fetchedIds.length, status: "fresh", fetchedAt: Date.now() };
    if (norm.nextCursor !== undefined) entry.nextCursor = norm.nextCursor;
    if (norm.hasMore !== undefined) entry.hasMore = norm.hasMore;
    else if (norm.items.length === 0) entry.hasMore = false;
    fam.pages.set(ordinal, entry);
    this.touchPage(fam, ordinal);

    // The fresh cursor wins; recorded only when the resolver threads cursors (an offset feed is not a chain).
    if (this.mode !== "paged") {
      if (req.cursor != null) fam.cursors.set(ordinal, req.cursor);
      if (norm.nextCursor !== undefined) {
        fam.cursors.set(ordinal + 1, norm.nextCursor);
        if (ordinal >= (this.loadedOrdinals.length ? Math.max(...this.loadedOrdinals) : this.base)) fam.nextCursor = norm.nextCursor;
      }
      fam.continuationTrust = "live";
      fam.continuationLost = false;
    }
    // infinite: the ordinal joins the window on success, never at issue; a prefetch stays cache-only.
    if (this.mode === "infinite" && !prefetch) {
      const max = this.loadedOrdinals.length ? Math.max(...this.loadedOrdinals) : this.base - 1;
      const min = this.loadedOrdinals.length ? Math.min(...this.loadedOrdinals) : this.base;
      if (this.loadedOrdinals.includes(ordinal) || (ordinal <= max + 1 && ordinal >= min)) {
        this.appendOrdinal(ordinal);
        this.truncateHead();
      }
    }
    this.staleShortPredecessor(fam, ordinal);
    if (typeof norm.total === "number") fam.serverTotal = norm.total;
    else if (fam.serverTotal != null && old) {
      // No server total: re-derive from this page's baseline delta (a promotion must not count twice).
      fam.serverTotal = Math.max(0, fam.serverTotal + ids.length - old.initialIds.length);
    }
    this.evictPages(fam);
  }

  /**
   * queryKey re-evaluation (checkDeps, the filter gate, a drifted run):
   * unchanged → no-op; changed → the old family is superseded, the pointer
   * resets, and the first page is served from cache when still fresh, else
   * fetched once.
   */
  private retrigger() {
    const now = Date.now();
    const { fam, keyChanged } = this.ensureFamily(now);
    if (!keyChanged) return;
    const first = fam.pages.get(this.config.initialPage);
    if (first && this.isFresh(first, now)) {
      // A flip back to a still-cached query: no resolver; an infinite window comes back whole.
      if (this.mode === "infinite") {
        const loaded: number[] = [];
        for (let o = this.config.initialPage; ; o++) {
          const e = fam.pages.get(o);
          if (!e || !this.isFresh(e, now)) break;
          loaded.push(o);
        }
        this.loadedOrdinals = loaded;
      }
      this.isPreviousData = false;
      this.project();
      if (fam.inFlight.size === 0 && this.status === "pending") this.status = "resolved";
      this.changed();
      return;
    }
    if (this.config.keepPreviousData) this.isPreviousData = true;
    else this.project();
    void this.fetch(this.config.initialPage);
  }

  /** A drifted run re-keys automatically: counted, so a resolver writing the value it reads cannot spin forever. */
  private retriggerAfterDrift() {
    if (++this.driftRuns > MAX_DRIFT_RUNS) {
      this.capped = true;
      const deps = [...(this.currentFamily()?.dependencies ?? [])].join(", ");
      console.warn(
        `[palistor/cube] resolver auto-retrigger cap (${MAX_DRIFT_RUNS}) reached for paginated list "${this.listPath}". ` +
          `Possible circular dependency. Deps: [${deps}]`,
      );
      return;
    }
    this.retrigger();
  }

  /** An explicit user action: the drift counter starts over. */
  private userAction() { this.driftRuns = 0; this.capped = false; }

  /**
   * A continuation off a HYDRATED cursor failed: re-fetch the predecessor (its
   * own cursor is live), then retry once; failing that, the chain is reported
   * `continuationLost` so the UI offers "Reload feed".
   */
  private async rebuildContinuation(o: number) {
    const fam = this.currentFamily();
    if (!fam) return;
    const prev = o - 1;
    const errored = () => this.status === "error";
    if (prev >= this.base && fam.pages.has(prev)) {
      await this.fetch(prev, true);
      if (!errored() && this.currentFamily() === fam && this.cursorFor(fam, o) !== undefined) {
        await this.fetch(o, true);
        if (!errored()) return;
      }
    }
    fam.continuationLost = true;
    fam.continuationTrust = "live";
    this.changed();
  }

  // ── the list's `rs` ───────────────────────────────────────────────────────

  /** First read: the current page starts on the next microtask (never inside a render). */
  touch() {
    if (this.status !== "idle" || this.scheduled || !this.lazy || this.disposed) return;
    if (this.hub.held) { this.hub.deferred.add(this); return; }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.status === "idle" && !this.disposed) this.start();
    });
  }

  /** The first fetch is coming: scheduled for the next microtask, or held back by server mode. */
  get due(): boolean {
    return this.status === "idle" && !this.disposed && (this.scheduled || (this.hub.held && this.hub.deferred.has(this)));
  }

  start() {
    this.userAction();
    void this.fetch(this.currentPageOf());
  }

  /** list.reload(): refetch(). */
  reload() { void this.refetch(); }

  /** The filter gate issued: the new server key becomes part of the query key. User-driven, not counted. */
  invalidate() {
    this.userAction();
    this.filterKey = this.liveFilterKey();
    this.list.filter?.markIssued();
    this.keyObs = null;
    this.retrigger();
  }

  /**
   * After every notification cycle: re-key when a value the current family is
   * keyed on has changed. A run in flight is left to its own drift check.
   */
  checkDeps() {
    if (this.disposed || this.capped || (this.status !== "resolved" && this.status !== "error")) return;
    const fam = this.currentFamily();
    if (!fam) return;
    const k = this.keyObs;
    if (k && k.fam === fam && k.size === fam.dependencies.size && !k.opaque && !this.config.queryKey && !k.obs.changed()) return;
    const obs = new Observer();
    let opaque = false;
    const key = observe(obs, () => {
      if (this.config.queryKey) return this.computeKey(fam.dependencies);
      const pairs: Array<[string, unknown]> = [];
      for (const d of fam.dependencies) {
        if (this.isSelf(d)) continue;
        const r = this.readDep(d);
        if (r.opaque) opaque = true;
        pairs.push([d, r.value]);
      }
      return keyFromPairs(pairs);
    });
    this.keyObs = { obs, fam, size: fam.dependencies.size, opaque };
    if (key !== this.currentQueryKey) this.retrigger();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.hub.deferred.delete(this);
    this.generation++;
    for (const fam of this.families.values()) clearGc(fam);
  }

  /** A list cube showing this cache (a new view of the owner after the previous ones went). */
  attach(cube: ListCube) {
    if (this.list === cube || this.list.state.cubes.has(this.list)) return;
    this.list = cube;
    this.keyObs = null;
  }

  /**
   * A list cube left the tree (Cube.dispose). A per-entity cache lives with
   * its owner entity (store) and follows another view; it is disposed when the
   * entity is deleted. Returns true when no view is left (no more re-checks).
   */
  detach(cube: Cube): boolean {
    const other = [...this.list.state.cubes].find((c) => c !== cube);
    if (other) {
      if (this.list === cube) { this.list = other; this.keyObs = null; }
      return false;
    }
    if (!this.list.item) this.dispose();
    return true;
  }

  // ── public API (list.*) ───────────────────────────────────────────────────

  /**
   * A fresh cached page is a synchronous projection; a miss or a stale page
   * fetches (the old rows stay on screen until it lands). A page past
   * staleTime is served and revalidated behind.
   */
  setPage(n: number) {
    if (!Number.isInteger(n) || n < this.base) return;
    if (this.mode === "infinite") {
      this.warnOnce("setPage-infinite", `[palistor] setPage() on the infinite-mode list "${this.listPath}" is not a navigation — use loadMore() / refetch().`);
      return;
    }
    this.userAction();
    const fam = this.currentFamily();
    const entry = fam?.pages.get(n);
    if (this.mode === "cursor" && !entry && n !== this.nextOrdinal()) {
      this.warnOnce(
        "setPage-cursor",
        `[palistor] setPage(${n}) on the cursor-mode list "${this.listPath}" is unreachable: a cursor chain is sequential (use nextPage()/prevPage()).`,
      );
      return;
    }
    if (fam && entry && entry.status === "fresh") {
      this.currentPage = n;
      this.loadedOrdinals = [n];
      this.touchPage(fam, n);
      this.project();
      this.changed();
      if (this.isExpired(entry, Date.now())) this.revalidate(n);
      return;
    }
    this.currentPage = n;
    this.loadedOrdinals = [n];
    void this.fetch(n);
  }

  nextPage() { if (this.hasNextPage) this.setPage(this.currentPage + 1); }

  prevPage() { if (this.currentPage > this.base) this.setPage(this.currentPage - 1); }

  /** infinite: the target is always max(loadedOrdinals) + 1; a cached fresh page appends without a fetch. */
  loadMore() {
    if (this.mode !== "infinite") return;
    this.userAction();
    const fam = this.currentFamily();
    if (!fam) { void this.fetch(this.config.initialPage); return; }
    if (fam.continuationLost) return;
    const target = this.nextOrdinal();
    if (fam.inFlight.has(target)) return;
    if (this.loadedOrdinals.length > 0 && !this.hasNextPage) return;
    const entry = fam.pages.get(target);
    if (entry && this.isFresh(entry, Date.now())) {
      this.appendOrdinal(target);
      this.project();
      this.changed();
      return;
    }
    void this.fetch(target);
  }

  /** Fill the cache without moving the pointer; an ordinal reachable only through its predecessor is refused. */
  prefetch(o: number): Promise<unknown> {
    if (!Number.isInteger(o) || o < this.base) return Promise.resolve();
    const fam = this.currentFamily();
    if (!fam) return Promise.resolve();
    const entry = fam.pages.get(o);
    if ((entry && this.isFresh(entry, Date.now())) || this.isTruncated(fam, o)) return Promise.resolve();
    const inFlight = fam.inFlight.get(o);
    if (inFlight) return inFlight;
    const chained = this.mode === "cursor" || fam.cursors.size > 0 || fam.nextCursor != null;
    const unreachable = chained ? this.cursorFor(fam, o) === undefined : this.mode === "infinite" && o > this.nextOrdinal();
    if (unreachable) {
      this.warnOnce(
        "prefetch-unreachable",
        `[palistor] prefetch(${o}) on list "${this.listPath}" is unreachable: a ${this.mode} list reaches an ordinal only through its predecessor.`,
      );
      return Promise.resolve();
    }
    return this.fetch(o, false, true);
  }

  /** Background revalidation of one ordinal (staleTime expiry, revalidateOnHydrate): the cached rows stay on screen. */
  revalidate(o: number) {
    const fam = this.currentFamily();
    if (!fam || fam.inFlight.has(o)) return;
    void this.fetch(o);
  }

  /** An explicit fetch of one ordinal (a user action). */
  fetchPage(o: number, force = false): Promise<unknown> {
    this.userAction();
    return this.fetch(o, force);
  }

  /** Every cached page describes the old size: clear, then fetch once from initialPage. */
  setPageSize(n: number) {
    if (!Number.isInteger(n) || n <= 0 || n === this.pageSize) return;
    this.userAction();
    this.clearFamilies();
    this.pageSize = n;
    this.config.pageSize = n;
    this.changed();
    void this.fetch(this.config.initialPage);
  }

  /**
   * Exactly one request. paged: the whole family goes stale and the current
   * page is re-issued; infinite / cursor: pull-to-refresh — truncate to
   * initialPage (local rows survive) and fetch it.
   */
  refetch(): Promise<unknown> {
    this.userAction();
    const fam = this.currentFamily();
    if (this.mode === "paged") {
      if (fam) this.markFamilyStale(fam);
      return this.fetch(this.currentPage, true);
    }
    const initial = this.config.initialPage;
    if (fam) {
      this.truncateChain(initial);
      const head = fam.pages.get(initial);
      if (head && head.status === "fresh") head.status = "stale";
      fam.continuationLost = false;
      fam.continuationTrust = "live";
    }
    this.currentPage = initial;
    this.changed();
    return this.fetch(initial, true);
  }

  /**
   * list.invalidate(page?). paged: one page (or the family) goes stale, the
   * current page refetches now. cursor / infinite: TRUNCATING — every later
   * ordinal goes with the generation bump, so an orphan continuation in flight
   * files nothing; cursor refetches the visible page, infinite on demand.
   */
  invalidatePage(page?: number) {
    const fam = this.currentFamily();
    if (!fam) return;
    this.userAction();
    if (this.mode === "paged") {
      if (page === undefined) this.markFamilyStale(fam);
      else {
        const e = fam.pages.get(page);
        if (e && e.status === "fresh") e.status = "stale";
      }
      if (page === undefined || page === this.currentPage) void this.fetch(this.currentPage, true);
      return;
    }
    const from = page === undefined ? this.config.initialPage : page;
    this.truncateChain(from);
    const e = fam.pages.get(from);
    if (e && e.status === "fresh") e.status = "stale";
    if (this.mode === "cursor") this.currentPage = Math.min(this.currentPage, from);
    this.changed();
    if (this.mode === "cursor" && from === this.currentPage) void this.fetch(from, true);
  }

  /** The escape from the permanently dirty state a rehydrated tmp row leaves behind. */
  discardPendingAdds() {
    const fam = this.currentFamily();
    if (!fam) return;
    let dropped = false;
    for (const e of fam.pages.values()) {
      const init = new Set(e.initialIds);
      const kept = e.ids.filter((id) => init.has(id));
      if (kept.length !== e.ids.length) { e.ids = kept; dropped = true; }
    }
    if (dropped) { this.project(); this.changed(); }
  }

  setScrollAnchor(id: string | null) { this.scrollAnchor = id; }

  // ── local edits (mutation inversion: the page entry, then the window) ─────

  /** The family a local edit lands in, created on the bootstrap key before any fetch. */
  private famForEdit(): Family { return this.currentFamily() ?? this.ensureFamily(Date.now()).fam; }

  /** paged / cursor: the current page; infinite: the last loaded ordinal. Family-wide dedup. */
  add(id: string) {
    const fam = this.famForEdit();
    if (this.findPage(fam, id) !== undefined) return;
    const o = this.currentPageOf();
    this.entryFor(fam, o).ids.push(id);
    if (this.mode === "infinite" && !this.loadedOrdinals.includes(o)) this.loadedOrdinals = [...this.loadedOrdinals, o];
    this.project();
    this.changed();
  }

  /** Splice from whichever page holds it; a server row shifts the later offsets (paged / cursor: they go stale). */
  remove(id: string) {
    const fam = this.currentFamily();
    if (!fam) return;
    const o = this.findPage(fam, id);
    if (o === undefined) return;
    const entry = fam.pages.get(o)!;
    entry.ids = entry.ids.filter((x) => x !== id);
    if (this.mode !== "infinite" && entry.initialIds.includes(id)) this.markStaleAfter(fam, o);
    this.project();
    this.changed();
  }

  /**
   * paged / cursor: replace the current page's ids (ids parked on other pages
   * stay there); a cardinality change stales the later pages. infinite has no
   * correct per-page split of an arbitrary order and refuses.
   */
  setItems(ids: string[]) {
    if (this.mode === "infinite") {
      const message = `[palistor] setItems() is not supported on the infinite-mode list "${this.listPath}": a multi-page window has no correct per-page assignment.`;
      if (process.env.NODE_ENV !== "production") throw new Error(message);
      console.warn(message);
      return;
    }
    const fam = this.famForEdit();
    const entry = this.entryFor(fam, this.currentPage);
    const next = ids.filter((id) => {
      const o = this.findPage(fam, id);
      return o === undefined || o === this.currentPage;
    });
    const lengthChanged = next.length !== entry.ids.length;
    entry.ids = next;
    if (lengthChanged) this.markStaleAfter(fam, this.currentPage);
    this.project();
    this.changed();
  }

  /** store.delete: out of every page of every family; a server row moves the counters (and, paged / cursor, stales what follows). */
  deleteId(id: string) {
    let hit = false;
    for (const fam of this.families.values()) {
      for (const [o, e] of fam.pages) {
        const idx = e.ids.indexOf(id);
        const initIdx = e.initialIds.indexOf(id);
        if (idx === -1 && initIdx === -1) continue;
        hit = true;
        if (idx >= 0) e.ids.splice(idx, 1);
        if (initIdx >= 0) {
          e.initialIds.splice(initIdx, 1);
          e.fetchedCount = Math.max(0, e.fetchedCount - 1);
          if (fam.serverTotal != null) fam.serverTotal = Math.max(0, fam.serverTotal - 1);
          if (this.mode !== "infinite") this.markStaleAfter(fam, o);
        }
      }
    }
    if (hit) { this.project(); this.changed(); }
  }

  /**
   * store.rekey across every family and page, with PROMOTION: a confirmed
   * optimistic add enters the baseline and moves serverTotal / fetchedCount.
   */
  rekey(oldId: string, newId: string) {
    let hit = false;
    for (const fam of this.families.values()) {
      for (const e of fam.pages.values()) {
        const idx = e.ids.indexOf(oldId);
        const initIdx = e.initialIds.indexOf(oldId);
        if (idx === -1 && initIdx === -1) continue;
        hit = true;
        if (idx >= 0) e.ids[idx] = newId;
        if (initIdx >= 0) e.initialIds[initIdx] = newId;
        else if (idx >= 0 && !e.initialIds.includes(newId)) {
          e.initialIds.splice(Math.min(idx, e.initialIds.length), 0, newId);
          e.fetchedCount++;
          if (fam.serverTotal != null) fam.serverTotal++;
        }
      }
    }
    if (hit) { this.project(); this.changed(); }
  }

  /** Full-form reset: edits are undone per page, navigation and cache stay; in-flight results are dropped. Zero network. */
  resetEdits() {
    if (this.families.size === 0) return;
    for (const fam of this.families.values()) for (const e of fam.pages.values()) e.ids = [...e.initialIds];
    this.generation++;
    this.project();
    this.changed();
  }

  // ── persist ───────────────────────────────────────────────────────────────

  /**
   * The blob of a root list's window: the tail in full (`persist.maxPages`),
   * earlier ordinals as fetchedCount tombstones, the settled dep set with its
   * values (never the key), the cursor chain, pending adds, and bodies of
   * locally removed server rows. `pointerOnly` (quota retry) keeps no rows.
   */
  serialize(pointerOnly: boolean): PersistBlob | null {
    const p = this.config.persist;
    const fam = this.currentFamily();
    if (p === false || !fam) return null;
    const ordinals = this.windowOrdinals().filter((o) => fam.pages.has(o));
    if (ordinals.length === 0) return null;
    const maxPages = p === "window" ? Infinity : p.maxPages;
    const firstFull = pointerOnly ? ordinals.length : Math.max(0, ordinals.length - maxPages);
    const keepAdds = this.config.persistPendingAdds === "keep";
    const tomb = (o: number, e: PageEntry): PersistPage => ({ ordinal: o, ids: [], initialIds: [], fetchedCount: e.fetchedCount, tombstone: true });

    const pages: PersistPage[] = [];
    const entities: Record<string, Values> = {};
    const pendingAdds: string[] = [];
    if (this.mode === "infinite") {
      const truncated = [...fam.pages].filter(([o, e]) => e.tombstone && o < ordinals[0]).sort((a, b) => a[0] - b[0]);
      for (const [o, e] of truncated) pages.push(tomb(o, e));
    }
    ordinals.forEach((o, i) => {
      const e = fam.pages.get(o)!;
      if (i < firstFull) { pages.push(tomb(o, e)); return; }
      const initial = new Set(e.initialIds);
      const ids = keepAdds ? [...e.ids] : e.ids.filter((id) => initial.has(id));
      if (keepAdds) for (const id of e.ids) if (!initial.has(id)) pendingAdds.push(id);
      const page: PersistPage = { ordinal: o, ids, initialIds: [...e.initialIds], fetchedCount: e.fetchedCount };
      if (e.hasMore !== undefined) page.hasMore = e.hasMore;
      if (e.nextCursor !== undefined) page.nextCursor = e.nextCursor;
      pages.push(page);
      const present = new Set(ids);
      for (const id of e.initialIds) {
        if (present.has(id)) continue;
        const body = this.hub.registry.get(id);
        if (body) entities[id] = clone(body);
      }
    });

    const deps = [...fam.dependencies];
    const blob: PersistBlob = {
      v: 2,
      fingerprint: { mode: this.mode, pageSize: this.pageSize, base: this.base },
      savedAt: Date.now(),
      currentPage: this.currentPage,
      loadedOrdinals: [...ordinals],
      deps,
      settled: fam.settled,
      depValues: deps.map((d) => [d, this.depValue(d)]),
      pages,
    };
    if (fam.serverTotal != null) blob.serverTotal = fam.serverTotal;
    if (this.config.queryKey) blob.queryKeyAtSave = untracked(() => this.computeKey(deps));
    if (this.mode !== "paged" && fam.cursors.size > 0) {
      const lo = ordinals[0];
      const hi = ordinals[ordinals.length - 1];
      const cursors = [...fam.cursors].filter(([o]) => o >= lo && o <= hi + 1);
      if (cursors.length) blob.cursors = cursors;
    }
    if (pendingAdds.length) blob.pendingAdds = pendingAdds;
    if (p === "window" && this.scrollAnchor) blob.anchorId = this.scrollAnchor;
    if (Object.keys(entities).length) blob.entities = entities;
    return blob;
  }

  /** Rule 5a (store): the blob must describe the array it was saved with; a trimmed blob covers a suffix of it. */
  private trusted(restored: string[], blob: unknown): blob is PersistBlob {
    if (!isPlainObject(blob)) return false;
    const b = blob as Partial<PersistBlob>;
    if (b.v !== 2) return false;
    const fp = b.fingerprint;
    if (!fp || fp.mode !== this.mode || fp.pageSize !== this.pageSize || fp.base !== this.base) return false;
    if (!Number.isInteger(b.currentPage) || (b.currentPage as number) < this.base) return false;
    if (!Array.isArray(b.deps) || !Array.isArray(b.depValues)) return false;
    if (!Array.isArray(b.loadedOrdinals) || b.loadedOrdinals.length === 0) return false;
    if (!Array.isArray(b.pages) || b.pages.length === 0) return false;
    if (!b.pages.some((page) => page && !page.tombstone)) return false;
    const blobIds = new Set<string>();
    for (const page of b.pages) {
      if (!page || !Array.isArray(page.ids) || !Array.isArray(page.initialIds) || !Number.isInteger(page.ordinal)) return false;
      for (const id of page.ids) blobIds.add(id);
    }
    if (blobIds.size > restored.length) return false;
    const have = new Set(restored);
    for (const id of blobIds) if (!have.has(id)) return false;
    return true;
  }

  /**
   * Persist hydration: the restored ids (rows already in the registry) and
   * the blob. A trusted blob under the live key is served AS IF FETCHED
   * (resolved); a missing / untrusted one bootstraps a synthesized stale
   * family so the first fetch reconciles the draft; a blob saved under other
   * values is not served (empty, idle).
   */
  seed(restored: string[], blob: unknown) {
    const now = Date.now();
    this.generation++;
    for (const fam of this.families.values()) clearGc(fam);
    this.families.clear();
    this.familyOrder = [];
    this.isPreviousData = false;
    this.isStaleFromStorage = false;
    this.scrollAnchor = null;
    this.keyObs = null;
    this.filterKey = this.liveFilterKey();
    const settle = (status: ResolveStatus) => { this.status = status; this.promise = null; this.error = null; };

    if (!this.trusted(restored, blob)) {
      // Rule 6: a tmp id is an un-flushed add, never a server row — it stays out of the baseline.
      const deps = this.bootstrapDeps();
      const hash = untracked(() => this.computeKey(deps));
      this.currentQueryKey = hash;
      this.currentPage = this.config.initialPage;
      this.loadedOrdinals = [this.config.initialPage];
      const fam = this.getOrCreateFamily(hash, deps, false, now);
      const serverIds = restored.filter((id) => !isTmpId(id));
      fam.pages.set(this.config.initialPage, { ids: [...restored], initialIds: serverIds, fetchedCount: serverIds.length, status: "stale", fetchedAt: now });
      this.touchPage(fam, this.config.initialPage);
      this.project();
      settle("idle");
      this.changed();
      return;
    }

    // Rule 2: serve only under a matching key, never while a restored $context dep is unset.
    const deps = new Set(blob.deps);
    const ctxMissing = [...deps].some((d) => d.startsWith("$context.") && this.hub.context[d.slice(9)] === undefined);
    const liveKey = untracked(() => this.computeKey(deps));
    const savedKey = this.config.queryKey ? blob.queryKeyAtSave : keyFromPairs(blob.depValues.filter(([d]) => deps.has(d)));
    if (ctxMissing || savedKey === undefined || savedKey !== liveKey) {
      this.currentQueryKey = null;
      this.currentPage = this.config.initialPage;
      this.loadedOrdinals = this.mode === "infinite" ? [] : [this.config.initialPage];
      this.list.setWindow([], []);
      settle("idle");
      this.changed();
      return;
    }

    // Rule 5b: bodies of locally removed server rows; an id without a body is dropped.
    if (blob.entities) {
      const bodies = Object.entries(blob.entities).map(([id, body]) => ({ ...body, id }));
      if (bodies.length) this.hub.setRows(bodies);
    }
    const hasBody = (id: string) => this.hub.registry.has(id);
    const fam = this.getOrCreateFamily(liveKey, deps, blob.settled, now);
    this.currentQueryKey = liveKey;
    if (blob.serverTotal != null) fam.serverTotal = blob.serverTotal;
    const savedAt = typeof blob.savedAt === "number" ? blob.savedAt : now;
    // One savedAt seeds every page: per-page times would revalidate N pages at once on mount.
    const stale = this.config.staleTime !== Infinity && now - savedAt >= this.config.staleTime;
    const live: number[] = [];
    for (const page of blob.pages) {
      const entry: PageEntry = page.tombstone
        ? { ids: [], initialIds: [], fetchedCount: page.fetchedCount, status: "stale", fetchedAt: savedAt, tombstone: true }
        : { ids: page.ids.filter(hasBody), initialIds: page.initialIds.filter(hasBody), fetchedCount: page.fetchedCount, status: stale ? "stale" : "fresh", fetchedAt: savedAt };
      if (!page.tombstone) {
        if (page.hasMore !== undefined) entry.hasMore = page.hasMore;
        if (page.nextCursor !== undefined) entry.nextCursor = page.nextCursor;
        live.push(page.ordinal);
      }
      fam.pages.set(page.ordinal, entry);
      this.touchPage(fam, page.ordinal);
    }
    if (blob.cursors) {
      for (const [o, c] of blob.cursors) fam.cursors.set(o, c);
      // An optimistic hint: the first failure under a restored cursor rebuilds the chain.
      if (blob.cursors.some(([, c]) => c != null)) fam.continuationTrust = "hydrated";
    }
    this.currentPage = blob.currentPage;
    this.loadedOrdinals = this.mode === "infinite" ? blob.loadedOrdinals.filter((o) => live.includes(o)) : [blob.currentPage];
    this.isStaleFromStorage = stale;
    if (blob.anchorId) this.scrollAnchor = blob.anchorId;
    this.project();
    if (blob.pendingAdds?.length) {
      this.warnOnce(
        "pending-adds",
        `[palistor] list "${this.listPath}" restored ${blob.pendingAdds.length} un-flushed optimistic row(s) from storage ` +
          `[${blob.pendingAdds.join(", ")}]. They keep the list dirty until the server confirms them — call discardPendingAdds() to drop them.`,
      );
    }
    settle("resolved");
    this.changed();
    // Stale-while-revalidate: restored pages are served; revalidateOnHydrate picks what refreshes, one task after paint.
    const mode = this.config.revalidateOnHydrate;
    if (stale && mode !== "none" && live.length) {
      const targets = mode === "all" ? live : [live[0]];
      setTimeout(() => {
        if (this.currentQueryKey !== liveKey) return;
        for (const o of targets) this.revalidate(o);
      }, 0);
    }
  }

  /**
   * `initialData`: the result of the first page (`initialPage`) under the live
   * key, filed by the code a landed fetch runs through — fresh, with its total,
   * cursor and hasMore. No run has read anything, so until the first real fetch
   * the family is keyed on the declared `deps` and the filter; the next page is
   * fetched as usual. The rows are fresh: `revalidateOnHydrate` does not apply.
   */
  accept(raw: unknown) {
    this.filterKey = this.liveFilterKey();
    const { fam } = this.ensureFamily(Date.now());
    const ordinal = this.config.initialPage;
    const req: PageRequest = { page: ordinal, pageSize: this.pageSize, offset: this.continuationOffset(fam, ordinal), queryKey: fam.queryKeyHash };
    if (this.mode !== "paged") req.cursor = this.cursorFor(fam, ordinal) ?? null;
    this.ingest(fam, ordinal, normalizeResult(raw), req, false);
    this.keyObs = null;
    this.project();
    this.status = "resolved";
    this.promise = null;
    this.error = null;
    // The rows answer the filter's current server values: the gate compares the next change against them.
    this.list.filter?.markIssued();
    this.changed();
  }

  /**
   * persist.disable() / an account switch: the page cache belongs to the
   * persisted session. Families go, in-flight fetches are superseded, the list
   * is idle again and refetches lazily under the live key.
   */
  clearSession() {
    if (this.families.size === 0 && this.currentQueryKey === null) return;
    this.clearFamilies();
    this.status = "idle";
    this.promise = null;
    this.error = null;
    this.changed();
  }
}

function clearGc(fam: Family) {
  if (fam.gcTimer) { clearTimeout(fam.gcTimer); fam.gcTimer = null; }
}
