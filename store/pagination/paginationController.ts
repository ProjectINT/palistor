/**
 * paginationController — pure helpers over the `pagination` sidecar of a root
 * ListState (PaginationPlan.md — all three page modes).
 *
 * The model: pages are the source of truth, the window (`itemIds` /
 * `initialItemIds`) is always a projection (`projectWindow`). Every helper
 * here mutates `PaginationState` / `QueryFamily` / `PageCacheEntry` in place —
 * the ListState identity is never recreated.
 */
import type { ListState, PaginationConfig } from "../store/types";
import type {
  PageCacheEntry,
  PaginationState,
  QueryFamily,
  ResolvedPaginationConfig,
} from "./types";
import { getByPath } from "../resolvePipeline/getByPath";
import { stableStringify } from "../filtering/filterController";

// ─── Construction ────────────────────────────────────────────────────────────

/** Validate the author-facing block and allocate the sidecar. */
export function createPaginationState(config: PaginationConfig, listPath: string): PaginationState {
  const { pageSize } = config;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(
      `[palistor] pagination.pageSize on list "${listPath}" must be a positive integer (got ${String(pageSize)}).`,
    );
  }
  const mode = config.mode ?? "paged";
  if (mode !== "paged" && mode !== "infinite" && mode !== "cursor") {
    throw new Error(
      `[palistor] pagination.mode "${mode}" on list "${listPath}" is not a page mode ` +
        `(expected "paged" | "infinite" | "cursor").`,
    );
  }
  const base = config.base ?? 1;
  if (base !== 0 && base !== 1) {
    throw new Error(`[palistor] pagination.base on list "${listPath}" must be 0 or 1.`);
  }
  const initialPage = config.initialPage ?? base;
  if (!Number.isInteger(initialPage) || initialPage < base) {
    throw new Error(
      `[palistor] pagination.initialPage on list "${listPath}" must be an integer >= base (${base}).`,
    );
  }
  const maxPages = config.maxPages ?? Infinity;
  if (maxPages !== Infinity && (!Number.isInteger(maxPages) || maxPages < 1)) {
    throw new Error(
      `[palistor] pagination.maxPages on list "${listPath}" must be a positive integer or Infinity.`,
    );
  }
  const persist = normalizePersist(config.persist, listPath, maxPages);
  const resolved: ResolvedPaginationConfig = {
    pageSize,
    mode,
    base,
    initialPage,
    staleTime: config.staleTime ?? Infinity,
    maxCachedQueries: Math.max(1, config.maxCachedQueries ?? 1),
    maxCachedPages: config.maxCachedPages ?? Infinity,
    maxPages,
    gcTime: config.gcTime ?? Infinity,
    keepPreviousData: config.keepPreviousData ?? false,
    revalidateOnHydrate: config.revalidateOnHydrate ?? "first",
    persist,
    persistPendingAdds: config.persistPendingAdds ?? "keep",
  };
  if (config.queryKey) resolved.queryKey = config.queryKey;
  return {
    mode,
    pageSize,
    base,
    listPath,
    currentQueryKey: null,
    currentPage: initialPage,
    // infinite: the window is empty until the first page SUCCEEDS (an ordinal
    // joins on completion, never at issue).
    loadedOrdinals: mode === "infinite" ? [] : [initialPage],
    families: new Map(),
    familyOrder: [],
    generation: 0,
    config: resolved,
    warned: new Set(),
    isPreviousData: false,
    isStaleFromStorage: false,
    scrollAnchor: null,
  };
}

/**
 * `persist` normalization. The default is a BOUNDED tail
 * (`{ maxPages: 3 }`): a full window costs O(window) on every global notify
 * and the first over-quota `setItem` silently kills persistence for the whole
 * form. The cap is clamped to `pagination.maxPages` (storing more pages than
 * the window can hold is unreachable — one concept on two layers).
 */
function normalizePersist(
  persist: PaginationConfig["persist"],
  listPath: string,
  windowCap: number,
): false | "window" | { maxPages: number } {
  if (persist === false || persist === "window") return persist;
  if (persist === undefined) return { maxPages: Math.min(3, windowCap) };
  const max = (persist as { maxPages?: unknown }).maxPages;
  if (!Number.isInteger(max) || (max as number) < 1) {
    throw new Error(
      `[palistor] pagination.persist.maxPages on list "${listPath}" must be a positive integer.`,
    );
  }
  return { maxPages: Math.min(max as number, windowCap) };
}

/** Emit a dev warning once per (list, topic). */
export function warnOnce(p: PaginationState, topic: string, message: string): void {
  if (p.warned.has(topic)) return;
  p.warned.add(topic);
  console.warn(message);
}

// ─── Window projection ───────────────────────────────────────────────────────

/** The ordinals that form the window — one set feeds BOTH window arrays. */
export function windowOrdinals(p: PaginationState): number[] {
  return p.mode === "infinite" ? p.loadedOrdinals : [p.currentPage];
}

/**
 * infinite: the pointer is DERIVED from what actually loaded — never a stored
 * `currentPage++` (a failed fetch must not skip an ordinal).
 */
export function currentPageOf(p: PaginationState): number {
  if (p.mode !== "infinite") return p.currentPage;
  return p.loadedOrdinals.length === 0 ? p.config.initialPage : Math.max(...p.loadedOrdinals);
}

/** The ordinal `loadMore` targets: always `max(loadedOrdinals) + 1`. */
export function nextOrdinalOf(p: PaginationState): number {
  return p.loadedOrdinals.length === 0 ? p.config.initialPage : Math.max(...p.loadedOrdinals) + 1;
}

/** Join an ordinal to the window — on SUCCESS only, kept sorted. */
export function appendLoadedOrdinal(p: PaginationState, ordinal: number): void {
  if (p.loadedOrdinals.includes(ordinal)) return;
  p.loadedOrdinals.push(ordinal);
  p.loadedOrdinals.sort((a, b) => a - b);
}

export function currentFamily(p: PaginationState): QueryFamily | undefined {
  return p.currentQueryKey === null ? undefined : p.families.get(p.currentQueryKey);
}

export function dedupe(ids: string[]): string[] {
  return ids.length < 2 ? ids.slice() : [...new Set(ids)];
}

/**
 * Re-derive `itemIds` / `initialItemIds` from the cached pages of the current
 * family. A missing window ordinal is an invariant violation (dev warning),
 * never a fallback case: callers project only after the entry exists.
 * `syncListValuesCache` is the caller's job (unchanged).
 *
 * paged: DISPLAY-LEVEL boundary reflow. A page that lost a server row
 * (`remove` / `delete`) is short by one; the row that now sits in its last
 * slot server-side is exactly the head of the next cached page — which that
 * removal marked `stale`. The projection BORROWS the deficit from a stale
 * successor without writing any entry (the write-through variant poisons
 * every downstream baseline). Once the successor is refetched its head is no
 * longer that row, so the borrow stops and the short page is marked stale by
 * the executor — the next visit heals it.
 */
export function projectWindow(ls: ListState): void {
  const p = ls.pagination!;
  const fam = currentFamily(p);
  if (!fam) {
    ls.itemIds = [];
    ls.initialItemIds = [];
    return;
  }
  const ids: string[] = [];
  const initial: string[] = [];
  for (const o of windowOrdinals(p)) {
    const entry = fam.pages.get(o);
    if (!entry) {
      warnOnce(
        p,
        `missing:${o}`,
        `[palistor] pagination invariant: window ordinal ${o} of list "${p.listPath}" has no cached page.`,
      );
      continue;
    }
    for (const id of entry.ids) ids.push(id);
    for (const id of entry.initialIds) initial.push(id);
  }
  if (p.mode === "paged") {
    const entry = fam.pages.get(p.currentPage);
    const next = fam.pages.get(p.currentPage + 1);
    if (entry && next && next.status === "stale" && !next.tombstone && ids.length < p.pageSize) {
      const have = new Set(ids);
      for (const id of next.ids) {
        if (ids.length >= p.pageSize) break;
        if (!have.has(id)) {
          ids.push(id);
          have.add(id);
        }
      }
    }
  }
  ls.itemIds = dedupe(ids);
  ls.initialItemIds = dedupe(initial);
}

/**
 * paged: after ordinal `o` lands fresh, its predecessor can no longer borrow
 * from it. A predecessor that is short of server truth (a deleted server row
 * — `fetchedCount < pageSize` while a successor exists, so it is not the last
 * page) is marked stale: the next visit refetches it instead of rendering a
 * one-row gap forever.
 */
export function staleShortPredecessor(p: PaginationState, fam: QueryFamily, ordinal: number): void {
  if (p.mode !== "paged") return;
  const prev = fam.pages.get(ordinal - 1);
  if (!prev || prev.tombstone || prev.status !== "fresh") return;
  if (prev.fetchedCount < p.pageSize && prev.fetchedCount > 0) prev.status = "stale";
}

// ─── queryKey ────────────────────────────────────────────────────────────────

/** A dep path that resolves into the list's own materialized slot. */
export function isSelfPath(listPath: string, path: string): boolean {
  return path === listPath || path.startsWith(listPath + ".");
}

/**
 * The dep set the FIRST fetch keys on: explicit `resolve.deps` plus the
 * declared SERVER filter paths (a filter change never enters the re-key dance).
 */
export function bootstrapDeps(ls: ListState): Set<string> {
  const p = ls.pagination!;
  const deps = new Set<string>();
  for (const d of ls.listConfig?.resolve?.deps ?? []) {
    if (!isSelfPath(p.listPath, d)) deps.add(d);
  }
  if (ls.filter) for (const d of ls.filter.serverPaths) deps.add(d);
  return deps;
}

/**
 * Stable JSON hash over the dep paths projected onto live values + context.
 * `page` is deliberately never part of it — advancing pages is not a dep change.
 */
export function computeQueryKey(
  ls: ListState,
  depSet: Iterable<string>,
  liveValues: Record<string, unknown>,
  context: Record<string, unknown>,
): string {
  const p = ls.pagination!;
  if (p.config.queryKey) return stableStringify(p.config.queryKey(liveValues, context));
  const pairs: Array<[string, unknown]> = [];
  for (const d of depSet) {
    if (isSelfPath(p.listPath, d)) continue;
    pairs.push([d, readDepValue(d, liveValues, context)]);
  }
  return keyFromPairs(pairs);
}

export function readDepValue(
  path: string,
  liveValues: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown {
  return path.startsWith("$context.") ? context[path.slice(9)] : getByPath(liveValues, path);
}

/** The exact encoding `computeQueryKey` uses — shared with the persist seed. */
export function keyFromPairs(pairs: Array<[string, unknown]>): string {
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return stableStringify(sorted);
}

// ─── Families ────────────────────────────────────────────────────────────────

function touchFamily(p: PaginationState, hash: string): void {
  const idx = p.familyOrder.indexOf(hash);
  if (idx >= 0) p.familyOrder.splice(idx, 1);
  p.familyOrder.push(hash);
}

export function getOrCreateFamily(
  p: PaginationState,
  hash: string,
  deps: Iterable<string>,
  settled: boolean,
  now: number,
): QueryFamily {
  let fam = p.families.get(hash);
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
    p.families.set(hash, fam);
  }
  fam.lastActiveAt = now;
  clearFamilyGc(fam);
  touchFamily(p, hash);
  return fam;
}

// ─── gcTime ──────────────────────────────────────────────────────────────────

export function clearFamilyGc(fam: QueryFamily): void {
  if (fam.gcTimer) {
    clearTimeout(fam.gcTimer);
    fam.gcTimer = null;
  }
}

/**
 * Retention of an INACTIVE family beyond `maxCachedQueries`: after `gcTime` a
 * family that is still not current is dropped. Re-activating it (a flip back
 * to that filter) clears the timer in `getOrCreateFamily`.
 */
export function scheduleFamilyGc(p: PaginationState, fam: QueryFamily): void {
  const { gcTime } = p.config;
  clearFamilyGc(fam);
  if (!Number.isFinite(gcTime)) return;
  const timer = setTimeout(() => {
    fam.gcTimer = null;
    if (p.currentQueryKey === fam.queryKeyHash) return;
    if (p.families.get(fam.queryKeyHash) !== fam) return;
    p.families.delete(fam.queryKeyHash);
    p.familyOrder = p.familyOrder.filter((k) => k !== fam.queryKeyHash);
  }, gcTime);
  // Never hold the process open for a cache eviction.
  (timer as unknown as { unref?: () => void }).unref?.();
  fam.gcTimer = timer;
}

/**
 * Drop families beyond `maxCachedQueries` (LRU), never the current one. A
 * dropped family takes its `inFlight` map with it — the executor's generation
 * gate turns those completions into no-ops.
 */
export function enforceFamilyCap(p: PaginationState): void {
  const max = p.config.maxCachedQueries;
  while (p.familyOrder.length > max) {
    const victim = p.familyOrder.find((k) => k !== p.currentQueryKey);
    if (victim === undefined) break;
    p.familyOrder.splice(p.familyOrder.indexOf(victim), 1);
    const fam = p.families.get(victim);
    if (fam) clearFamilyGc(fam);
    p.families.delete(victim);
  }
}

/** Drop every family except `keepKey`. */
export function evictForeignFamilies(p: PaginationState, keepKey: string | null): void {
  for (const [k, fam] of [...p.families]) {
    if (k === keepKey) continue;
    clearFamilyGc(fam);
    p.families.delete(k);
  }
  p.familyOrder = p.familyOrder.filter((k) => k === keepKey);
}

/** Rename a family's hash in place (dep-set widening with unchanged values). */
export function renameFamily(p: PaginationState, fam: QueryFamily, newHash: string): void {
  const old = fam.queryKeyHash;
  if (old === newHash) return;
  p.families.delete(old);
  // A retained family already under the new hash is older data — the
  // completing one wins.
  p.families.set(newHash, fam);
  fam.queryKeyHash = newHash;
  const idx = p.familyOrder.indexOf(old);
  if (idx >= 0) p.familyOrder.splice(idx, 1);
  p.familyOrder = p.familyOrder.filter((k) => k !== newHash);
  p.familyOrder.push(newHash);
  if (p.currentQueryKey === old) p.currentQueryKey = newHash;
}

/**
 * Decide the family the next fetch files under, from LIVE values/context.
 *
 * - bootstrap (no key yet): key over `bootstrapDeps`;
 * - same key: no-op;
 * - a different key: the result set changed — supersede in-flight fetches
 *   (`generation++`), reset the pointer to `initialPage`, and carry the
 *   SETTLED dep set into the new family (deps belong to the resolver, not to
 *   one family's values).
 */
export function ensureCurrentFamily(
  ls: ListState,
  liveValues: Record<string, unknown>,
  context: Record<string, unknown>,
  now: number,
): { fam: QueryFamily; keyChanged: boolean } {
  const p = ls.pagination!;
  const prev = currentFamily(p);
  const depSet = prev?.dependencies ?? bootstrapDeps(ls);
  const hash = computeQueryKey(ls, depSet, liveValues, context);
  if (prev && p.currentQueryKey === hash) {
    prev.lastActiveAt = now;
    touchFamily(p, hash);
    return { fam: prev, keyChanged: false };
  }
  const keyChanged = p.currentQueryKey !== null && p.currentQueryKey !== hash;
  if (keyChanged) {
    p.generation++;
    p.currentPage = p.config.initialPage;
    p.loadedOrdinals = p.mode === "infinite" ? [] : [p.config.initialPage];
    p.isStaleFromStorage = false;
    // The outgoing family becomes a retention candidate (`maxCachedQueries`
    // keeps it, `gcTime` drops it if it is never activated again).
    if (prev) scheduleFamilyGc(p, prev);
  }
  p.currentQueryKey = hash;
  const fam = getOrCreateFamily(p, hash, depSet, prev?.settled ?? false, now);
  enforceFamilyCap(p);
  return { fam, keyChanged };
}

/** Union of all live families' dep sets (the retrigger-SELECTION key). */
export function unionFamilyDeps(p: PaginationState, extra: Iterable<string>): Set<string> {
  const out = new Set<string>(extra);
  for (const fam of p.families.values()) for (const d of fam.dependencies) out.add(d);
  return out;
}

// ─── Pages ───────────────────────────────────────────────────────────────────

export function touchPage(fam: QueryFamily, ordinal: number): void {
  const idx = fam.order.indexOf(ordinal);
  if (idx >= 0) fam.order.splice(idx, 1);
  fam.order.push(ordinal);
}

/**
 * LRU-evict beyond `max`, skipping the pinned window ordinals. Tombstones
 * hold no rows and are never counted nor evicted — dropping one would silently
 * shift every later continuation offset.
 */
export function evictPagesBeyond(fam: QueryFamily, max: number, pinned: number[]): void {
  if (!Number.isFinite(max)) return;
  const liveCount = (): number => {
    let n = 0;
    for (const e of fam.pages.values()) if (!e.tombstone) n++;
    return n;
  };
  while (liveCount() > max) {
    const victim = fam.order.find((o) => !pinned.includes(o) && !fam.pages.get(o)?.tombstone);
    if (victim === undefined) break;
    fam.order.splice(fam.order.indexOf(victim), 1);
    fam.pages.delete(victim);
  }
}

export function isEntryFresh(entry: PageCacheEntry, p: PaginationState, now: number): boolean {
  if (entry.status !== "fresh") return false;
  return !isEntryExpired(entry, p, now);
}

/**
 * Past `staleTime` — served (stale-while-revalidate) but revalidated in the
 * background. Distinct from `status: 'stale'`, which means "the cached rows
 * are known WRONG" (an offset shift / an explicit invalidate) and blocks.
 */
export function isEntryExpired(entry: PageCacheEntry, p: PaginationState, now: number): boolean {
  const { staleTime } = p.config;
  return staleTime !== Infinity && now - entry.fetchedAt >= staleTime;
}

// ─── Cursor chain / continuation (cursor + infinite) ─────────────────────────

/** The cursor that fetches `ordinal` — `null`/`undefined` for the chain head. */
export function cursorFor(fam: QueryFamily, ordinal: number, base: number): string | null | undefined {
  if (ordinal === base) return null;
  if (fam.cursors.has(ordinal)) return fam.cursors.get(ordinal);
  return fam.pages.get(ordinal - 1)?.nextCursor;
}

/** File the cursor a completed page minted for its successor. */
export function recordCursor(fam: QueryFamily, ordinal: number, nextCursor: string | null | undefined): void {
  if (nextCursor === undefined) return;
  fam.cursors.set(ordinal + 1, nextCursor);
}

/**
 * The continuation counter — `Σ fetchedCount` (the server's own row count),
 * NEVER `Σ|initialIds|`: cross-page dedup can shrink a page's stored ids and
 * would then silently shift every later offset.
 */
export function continuationOffset(p: PaginationState, fam: QueryFamily, ordinal: number): number {
  if (p.mode !== "infinite") return (ordinal - p.base) * p.pageSize;
  let sum = 0;
  for (const [o, e] of fam.pages) {
    if (o >= ordinal) continue;
    // Loaded ordinals AND tombstones (rows gone from memory, count kept) —
    // never a cache-only prefetch beyond the window.
    if (e.tombstone || p.loadedOrdinals.includes(o)) sum += e.fetchedCount;
  }
  return sum;
}

/** Σ fetchedCount over everything the server has handed out so far (window + tombstones). */
export function fetchedSoFar(p: PaginationState, fam: QueryFamily): number {
  let sum = 0;
  for (const [o, e] of fam.pages) {
    if (e.tombstone || p.loadedOrdinals.includes(o)) sum += e.fetchedCount;
  }
  return sum;
}

/** infinite: the ordinal is a head-truncated tombstone (below the window). */
export function isTruncatedOrdinal(p: PaginationState, fam: QueryFamily, ordinal: number): boolean {
  if (p.mode !== "infinite") return false;
  const e = fam.pages.get(ordinal);
  return !!e?.tombstone && !p.loadedOrdinals.includes(ordinal);
}

/**
 * `pagination.maxPages` (infinite): drop ordinals off the HEAD of the window
 * until it fits. A dropped page becomes a `fetchedCount` tombstone (the
 * continuation counter must survive its rows leaving memory); its un-flushed
 * local rows are harvested onto the new head so the truncation never destroys
 * user input. Returns the dropped ordinals.
 */
export function truncateHead(ls: ListState): number[] {
  const p = ls.pagination!;
  const max = p.config.maxPages;
  if (p.mode !== "infinite" || !Number.isFinite(max)) return [];
  const fam = currentFamily(p);
  if (!fam || p.loadedOrdinals.length <= max) return [];
  const dropped = p.loadedOrdinals.slice(0, p.loadedOrdinals.length - max);
  p.loadedOrdinals = p.loadedOrdinals.slice(dropped.length);
  const harvested: string[] = [];
  for (const o of dropped) {
    const e = fam.pages.get(o);
    if (!e) continue;
    const init = new Set(e.initialIds);
    for (const id of e.ids) if (!init.has(id)) harvested.push(id);
    fam.pages.set(o, {
      ids: [],
      initialIds: [],
      fetchedCount: e.fetchedCount,
      status: "stale",
      fetchedAt: e.fetchedAt,
      tombstone: true,
    });
    fam.order = fam.order.filter((x) => x !== o);
  }
  const head = fam.pages.get(p.loadedOrdinals[0]);
  if (head && harvested.length > 0) {
    const present = new Set(head.ids);
    head.ids = [...harvested.filter((id) => !present.has(id)), ...head.ids];
  }
  return dropped;
}

/**
 * TRUNCATING invalidation (cursor + infinite): ordinal k+1's cursor is minted
 * by k's response, so a refetched k orphans every cached ordinal > k — their
 * ids may correspond to no reachable server window at all. Drops them, prunes
 * `loadedOrdinals` and bumps `generation` (superseding a continuation already
 * in flight off a now-dropped cursor). Local-only rows of the dropped pages
 * are harvested onto the surviving ordinal so a refresh never destroys
 * un-flushed input. Returns the harvested ids.
 */
export function truncateChain(ls: ListState, ordinal: number): string[] {
  const p = ls.pagination!;
  const fam = currentFamily(p);
  if (!fam) return [];
  const harvested: string[] = [];
  for (const [o, e] of [...fam.pages]) {
    if (o <= ordinal) continue;
    const init = new Set(e.initialIds);
    for (const id of e.ids) if (!init.has(id)) harvested.push(id);
    fam.pages.delete(o);
    fam.order = fam.order.filter((x) => x !== o);
  }
  for (const o of [...fam.cursors.keys()]) if (o > ordinal + 1) fam.cursors.delete(o);
  p.loadedOrdinals = p.loadedOrdinals.filter((o) => o <= ordinal);
  if (p.currentPage > ordinal) p.currentPage = ordinal;
  p.generation++;
  const surviving = fam.pages.get(ordinal);
  if (surviving?.tombstone) {
    // The survivor had been head-truncated (`maxPages`): it becomes a plain
    // stale entry again — the window restarts from it and the fetch replaces it.
    delete surviving.tombstone;
    touchPage(fam, ordinal);
    if (p.mode === "infinite" && !p.loadedOrdinals.includes(ordinal)) {
      p.loadedOrdinals = [ordinal];
    }
  }
  if (surviving && harvested.length > 0) {
    for (const id of harvested) if (!surviving.ids.includes(id)) surviving.ids.push(id);
  }
  projectWindow(ls);
  return harvested;
}

/** Ordinal of the page whose `ids` contain `id`, if any. */
export function findPageWithId(fam: QueryFamily, id: string): number | undefined {
  for (const [o, e] of fam.pages) if (e.ids.includes(id)) return o;
  return undefined;
}

export function hasIdInFamily(fam: QueryFamily, id: string): boolean {
  return findPageWithId(fam, id) !== undefined;
}

/** Get (or create an empty, stale) entry for local edits landing before a fetch. */
export function getOrCreateEntry(fam: QueryFamily, ordinal: number, now: number): PageCacheEntry {
  let entry = fam.pages.get(ordinal);
  if (!entry) {
    entry = { ids: [], initialIds: [], fetchedCount: 0, status: "stale", fetchedAt: now };
    fam.pages.set(ordinal, entry);
    touchPage(fam, ordinal);
  }
  return entry;
}

/** Offset staling keyed on the splice ordinal: every ordinal > P refetches on visit. */
export function markStaleAfter(fam: QueryFamily, ordinal: number): void {
  for (const [o, e] of fam.pages) {
    if (o > ordinal && e.status === "fresh") e.status = "stale";
  }
}

export function markFamilyStale(fam: QueryFamily): void {
  for (const e of fam.pages.values()) if (e.status === "fresh") e.status = "stale";
}

// ─── Derived accounting ──────────────────────────────────────────────────────

/** Σ(|ids| − |initialIds|) over cached pages — the optimistic local delta. */
export function localDelta(fam: QueryFamily): number {
  let d = 0;
  for (const e of fam.pages.values()) d += e.ids.length - e.initialIds.length;
  return d;
}

/** Display total: server truth + local delta (undefined while the total is unknown). */
export function displayTotal(fam: QueryFamily | undefined): number | undefined {
  if (!fam || fam.serverTotal == null) return undefined;
  return Math.max(0, fam.serverTotal + localDelta(fam));
}

/** Count of contiguous cached pages from `base` (a stale page breaks the run). */
export function contiguousPages(fam: QueryFamily, base: number): number {
  let n = 0;
  for (let o = base; ; o++) {
    const e = fam.pages.get(o);
    if (!e || e.status === "stale") break;
    n++;
  }
  return n;
}

/** Server-derived page count; falls back to the contiguous heuristic. */
export function pageCountOf(p: PaginationState, fam: QueryFamily | undefined): number {
  if (!fam) return 0;
  if (fam.serverTotal != null) return Math.ceil(fam.serverTotal / p.pageSize);
  return contiguousPages(fam, p.base);
}

/**
 * Never influenced by local adds/removes — fullness is a FETCH-TIME fact
 * (`fetchedCount`) and `serverTotal` moves only on server-truth events, so an
 * optimistic add can never fabricate a phantom next page (and with it a
 * guaranteed-empty fetch on a complete feed).
 */
export function hasNextPageOf(p: PaginationState, fam: QueryFamily | undefined): boolean {
  if (!fam) return false;
  if (fam.continuationLost) return false;

  if (p.mode === "infinite") {
    if (p.loadedOrdinals.length === 0) return true;
    const last = Math.max(...p.loadedOrdinals);
    const entry = fam.pages.get(last);
    if (fam.serverTotal != null) return fetchedSoFar(p, fam) < fam.serverTotal;
    if (!entry) return false;
    if (entry.nextCursor != null) return true;
    if (entry.hasMore !== undefined) return entry.hasMore;
    return entry.fetchedCount === p.pageSize;
  }

  if (p.mode === "cursor") {
    const entry = fam.pages.get(p.currentPage);
    if (entry?.nextCursor != null) return true;
    if (fam.cursors.has(p.currentPage + 1)) return true;
    if (fam.pages.has(p.currentPage + 1)) return true;
    if (!entry) return false;
    if (entry.hasMore !== undefined) return entry.hasMore;
    if (fam.serverTotal != null) return p.currentPage < p.base + pageCountOf(p, fam) - 1;
    return entry.fetchedCount === p.pageSize;
  }

  if (fam.serverTotal != null) return p.currentPage < p.base + pageCountOf(p, fam) - 1;
  const entry = fam.pages.get(p.currentPage);
  if (!entry) return false;
  if (entry.hasMore !== undefined) return entry.hasMore;
  return entry.fetchedCount === p.pageSize;
}

/**
 * dirty = the AGGREGATE per-page rollup over every cached page of the current
 * family, in every mode: an un-flushed edit parked on an off-screen page
 * still makes the list dirty (a window-level compare would read clean the
 * moment the user navigates away from the edited page, and `dedupe` can
 * collapse a cross-page duplicate in an infinite window).
 */
export function isPaginatedDirty(ls: ListState): boolean {
  const p = ls.pagination!;
  const fam = currentFamily(p);
  if (!fam) return false;
  for (const e of fam.pages.values()) {
    if (!arraysEqual(e.ids, e.initialIds)) return true;
  }
  return false;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Frozen per-ordinal snapshot of the window (never the live `pages` Map). */
export function loadedPagesOf(
  p: PaginationState,
  fam: QueryFamily | undefined,
): ReadonlyArray<{ ordinal: number; ids: readonly string[] }> {
  if (!fam) return [];
  const out: Array<{ ordinal: number; ids: readonly string[] }> = [];
  for (const o of windowOrdinals(p)) {
    const e = fam.pages.get(o);
    if (!e) continue;
    out.push(Object.freeze({ ordinal: o, ids: Object.freeze([...e.ids]) as readonly string[] }));
  }
  return Object.freeze(out);
}

/** Ids present in a cached page's `ids` but not in its `initialIds` — un-flushed adds. */
export function pendingAddsOf(p: PaginationState, fam: QueryFamily | undefined): string[] {
  if (!fam) return [];
  const out: string[] = [];
  for (const e of fam.pages.values()) {
    const init = new Set(e.initialIds);
    for (const id of e.ids) if (!init.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Drop every un-flushed optimistic add of the current family — the documented
 * escape from the permanently-dirty state a rehydrated tmp row leaves behind
 * (it can never be rekeyed, so nothing else ever clears it).
 */
export function discardPendingAdds(ls: ListState): string[] {
  const p = ls.pagination!;
  const fam = currentFamily(p);
  if (!fam) return [];
  const dropped: string[] = [];
  for (const e of fam.pages.values()) {
    const init = new Set(e.initialIds);
    const kept = e.ids.filter((id) => {
      if (init.has(id)) return true;
      dropped.push(id);
      return false;
    });
    if (kept.length !== e.ids.length) e.ids = kept;
  }
  if (dropped.length > 0) projectWindow(ls);
  return dropped;
}

// ─── Lifecycle: reset / rekey / delete ───────────────────────────────────────

/**
 * Per-page rollback — undoes EDITS, not navigation: every cached entry goes
 * back to its `initialIds`; pointer and families are kept; in-flight results
 * are discarded (generation bump). Zero network.
 */
/**
 * `setPageSize(n)` — every cached page describes a window of the OLD size, so
 * nothing survives: families are cleared, the pointer returns to `initialPage`
 * and in-flight fetches are superseded. The caller fetches once.
 */
export function applyPageSize(ls: ListState, pageSize: number): boolean {
  const p = ls.pagination!;
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize === p.pageSize) return false;
  clearFamilies(ls);
  p.pageSize = pageSize;
  p.config.pageSize = pageSize;
  return true;
}

/**
 * Drop every family (gc timers cleared), reset the pointer to `initialPage`,
 * supersede in-flight fetches and empty the window. Shared by `setPageSize`,
 * the persist account-switch path and owner deletion.
 */
export function clearFamilies(ls: ListState): void {
  const p = ls.pagination!;
  for (const fam of p.families.values()) clearFamilyGc(fam);
  p.families.clear();
  p.familyOrder = [];
  p.currentQueryKey = null;
  p.currentPage = p.config.initialPage;
  p.loadedOrdinals = p.mode === "infinite" ? [] : [p.config.initialPage];
  p.isPreviousData = false;
  p.isStaleFromStorage = false;
  p.generation++;
  ls.itemIds = [];
  ls.initialItemIds = [];
}

export function resetPagination(ls: ListState): void {
  const p = ls.pagination!;
  for (const fam of p.families.values()) {
    for (const e of fam.pages.values()) e.ids = [...e.initialIds];
  }
  p.generation++;
  projectWindow(ls);
}

/**
 * Rewrite `oldId → newId` across EVERY family and page (ids + initialIds),
 * with the rekey-PROMOTION rule: a confirmed optimistic add (old id in `ids`
 * but not in `initialIds`) enters `initialIds` at its `ids` position and
 * increments `serverTotal` / `fetchedCount`. Idempotent. Returns whether
 * anything changed.
 */
export function rekeyPagination(ls: ListState, oldId: string, newId: string): boolean {
  const p = ls.pagination!;
  let changed = false;
  for (const fam of p.families.values()) {
    for (const e of fam.pages.values()) {
      const idx = e.ids.indexOf(oldId);
      const initIdx = e.initialIds.indexOf(oldId);
      if (idx === -1 && initIdx === -1) continue;
      changed = true;
      if (idx >= 0) e.ids[idx] = newId;
      if (initIdx >= 0) {
        e.initialIds[initIdx] = newId;
      } else if (idx >= 0 && !e.initialIds.includes(newId)) {
        // Promotion: server confirmation makes the row server truth.
        e.initialIds.splice(Math.min(idx, e.initialIds.length), 0, newId);
        e.fetchedCount++;
        if (fam.serverTotal != null) fam.serverTotal++;
      }
    }
  }
  if (changed) projectWindow(ls);
  return changed;
}

/**
 * Splice `id` out of every page of every family. A server row (present in
 * some `initialIds`) decrements `serverTotal` / `fetchedCount` and stales the
 * ordinals after it (offsets shifted). Returns whether anything changed.
 */
export function deleteIdEverywhere(ls: ListState, id: string): boolean {
  const p = ls.pagination!;
  let changed = false;
  for (const fam of p.families.values()) {
    for (const [o, e] of fam.pages) {
      const idx = e.ids.indexOf(id);
      const initIdx = e.initialIds.indexOf(id);
      if (idx === -1 && initIdx === -1) continue;
      changed = true;
      if (idx >= 0) e.ids.splice(idx, 1);
      if (initIdx >= 0) {
        e.initialIds.splice(initIdx, 1);
        e.fetchedCount = Math.max(0, e.fetchedCount - 1);
        if (fam.serverTotal != null) fam.serverTotal = Math.max(0, fam.serverTotal - 1);
        // infinite stales nothing — the later pages are on screen and a
        // background refetch would reflow under the user's scroll; only the
        // continuation counter moves (the `fetchedCount` decrement above).
        if (p.mode !== "infinite") markStaleAfter(fam, o);
      }
    }
  }
  if (changed) projectWindow(ls);
  return changed;
}
