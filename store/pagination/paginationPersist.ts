/**
 * paginationPersist — the persist blob of a paginated ROOT list (the loaded
 * window + a pointer + the cursor chain), and the seed that restores it.
 *
 * Restoring a window the store then serves AS IF FETCHED is the most dangerous
 * surface of the design (the seed suppresses the first fetch). The rules:
 *
 *   1. persist the SETTLED dep set and its values, never a bare bootstrap set
 *      and never the key hash — the key is recomputed at seed time through the
 *      exact code path `_retriggerPaginatedList` uses, so the first
 *      post-hydrate notify is a no-op instead of an eviction;
 *   2. serve only under a matching key (live vs persisted dep values), and
 *      never while a restored `$context.*` dep is still unset;
 *   3. (follows from 1) hydration never evicts what it just restored;
 *   4. version + config fingerprint (`mode`/`pageSize`/`base`), or discard;
 *   5. the blob is bound to its list's array (attached only when the array
 *      survived pick/omit; ignored when the array is absent or does not cover
 *      the persisted ids), and bodies of locally removed server rows ride
 *      along so `reset()` cannot resurrect a bodiless id;
 *   6. a restored array with no trusted blob bootstraps a synthesized family
 *      (`status: 'stale'`, resolve state `idle`) so the first fetch RECONCILES
 *      the restored draft instead of replacing it.
 *
 * Bounded by default (`persist: { maxPages: 3 }`): only the tail of the window
 * is written in full and earlier ordinals become `fetchedCount` TOMBSTONES, so
 * the infinite continuation offset (`Σ fetchedCount`) survives a trimmed blob.
 * A persisted cursor is older than the storage round-trip by definition, so the
 * restored chain is an optimistic hint only (`continuationTrust: 'hydrated'`).
 */
import type { ListState } from "../store/types";
import type { EntityData } from "../entityRegistry";
import type { Palistor } from "../store/palistor";
import type { PageCacheEntry, PaginationPersistBlob, PaginationPersistPage } from "./types";
import { getByPath } from "../resolvePipeline/getByPath";
import { isTmpId } from "../entityRegistry/generateId";
import {
  bootstrapDeps,
  computeQueryKey,
  currentFamily,
  getOrCreateFamily,
  keyFromPairs,
  projectWindow,
  readDepValue,
  touchPage,
  unionFamilyDeps,
  warnOnce,
  windowOrdinals,
} from "./paginationController";

/** Reserved persist-snapshot key: `{ [listPath]: PaginationPersistBlob }`. */
export const PAGINATION_PERSIST_KEY = "__pagination";

// ─── Serialize ───────────────────────────────────────────────────────────────

/**
 * Blobs for every paginated root list whose value array survived
 * `filterValues` (rule 5a). `null` when there is nothing to attach.
 *
 * @param trimToPointer — the quota retry: keep the pointer, drop every page
 *   (a pointer-only blob is untrusted at seed, so the restored array
 *   bootstraps through rule 6 instead of taking the form's persistence down).
 */
export function serializePagination(
  kernel: Palistor<any, any>,
  filtered: Record<string, unknown>,
  trimToPointer = false,
): Record<string, PaginationPersistBlob> | null {
  let out: Record<string, PaginationPersistBlob> | null = null;
  for (const ls of kernel.nodes.allListStates) {
    const p = ls.pagination;
    if (!p || ls.ownerEntity !== null) continue;
    if (p.config.persist === false) continue;
    if (!Array.isArray(getByPath(filtered, p.listPath))) continue;
    const fam = currentFamily(p);
    if (!fam) continue;
    const ordinals = windowOrdinals(p).filter((o) => fam.pages.has(o));
    if (ordinals.length === 0) continue;

    const live = kernel.resolveManager.pagedLiveValues(ls);
    const context = kernel.context;
    const deps = [...fam.dependencies];
    // Bounded by default: the TAIL is written in full, earlier ordinals keep
    // their `fetchedCount` only (the continuation counter must survive).
    const maxPages =
      p.config.persist === "window" ? Infinity : (p.config.persist as { maxPages: number }).maxPages;
    const firstFull = trimToPointer ? ordinals.length : Math.max(0, ordinals.length - maxPages);
    const keepAdds = p.config.persistPendingAdds === "keep";

    const pages: PaginationPersistPage[] = [];
    const entities: Record<string, Record<string, unknown>> = {};
    const pendingAdds: string[] = [];
    // Head-truncated ordinals (`pagination.maxPages`) sit below the window as
    // tombstones — they carry the continuation counter and must ride along.
    if (p.mode === "infinite") {
      const truncated = [...fam.pages]
        .filter(([o, e]) => e.tombstone && o < ordinals[0])
        .sort((a, b) => a[0] - b[0]);
      for (const [o, e] of truncated) {
        pages.push({ ordinal: o, ids: [], initialIds: [], fetchedCount: e.fetchedCount, tombstone: true });
      }
    }
    for (let i = 0; i < ordinals.length; i++) {
      const o = ordinals[i];
      const e = fam.pages.get(o)!;
      if (i < firstFull) {
        pages.push({ ordinal: o, ids: [], initialIds: [], fetchedCount: e.fetchedCount, tombstone: true });
        continue;
      }
      const initial = new Set(e.initialIds);
      const ids = keepAdds ? [...e.ids] : e.ids.filter((id) => initial.has(id));
      for (const id of e.ids) if (!initial.has(id) && keepAdds) pendingAdds.push(id);
      const page: PaginationPersistPage = {
        ordinal: o,
        ids,
        initialIds: [...e.initialIds],
        fetchedCount: e.fetchedCount,
      };
      if (e.hasMore !== undefined) page.hasMore = e.hasMore;
      if (e.nextCursor !== undefined) page.nextCursor = e.nextCursor;
      pages.push(page);
      // Rule 5b: bodies of server rows removed locally (in initialIds, not in ids).
      const present = new Set(ids);
      for (const id of e.initialIds) {
        if (present.has(id)) continue;
        const body = kernel.entityProjectionObjs.get(id);
        if (body) entities[id] = structuredClone(body);
      }
    }

    const blob: PaginationPersistBlob = {
      v: 2,
      fingerprint: { mode: p.mode, pageSize: p.pageSize, base: p.base },
      savedAt: Date.now(),
      currentPage: p.currentPage,
      loadedOrdinals: [...ordinals],
      deps,
      settled: fam.settled,
      depValues: deps.map((d) => [d, readDepValue(d, live, context)] as [string, unknown]),
      pages,
    };
    if (fam.serverTotal != null) blob.serverTotal = fam.serverTotal;
    if (p.config.queryKey) blob.queryKeyAtSave = computeQueryKey(ls, deps, live, context);
    if (p.mode !== "paged" && fam.cursors.size > 0) {
      const lowest = ordinals[0];
      const highest = ordinals[ordinals.length - 1];
      const cursors = [...fam.cursors].filter(([o]) => o >= lowest && o <= highest + 1);
      if (cursors.length > 0) blob.cursors = cursors;
    }
    if (pendingAdds.length > 0) blob.pendingAdds = pendingAdds;
    if (p.config.persist === "window" && p.scrollAnchor) blob.anchorId = p.scrollAnchor;
    if (Object.keys(entities).length > 0) blob.entities = entities;

    (out ??= {})[p.listPath] = blob;
  }
  return out;
}

// ─── Seed ────────────────────────────────────────────────────────────────────

function blobTrusted(
  ls: ListState,
  restoredIds: string[],
  blob: unknown,
): blob is PaginationPersistBlob {
  const p = ls.pagination!;
  if (!blob || typeof blob !== "object") return false;
  const b = blob as Partial<PaginationPersistBlob>;
  if (b.v !== 2) return false;
  const fp = b.fingerprint;
  if (!fp || fp.mode !== p.mode || fp.pageSize !== p.pageSize || fp.base !== p.base) return false;
  if (!Number.isInteger(b.currentPage) || (b.currentPage as number) < p.base) return false;
  if (!Array.isArray(b.deps) || !Array.isArray(b.depValues)) return false;
  if (!Array.isArray(b.loadedOrdinals) || b.loadedOrdinals.length === 0) return false;
  if (!Array.isArray(b.pages) || b.pages.length === 0) return false;
  // A blob of tombstones only describes no rows — nothing to serve.
  if (!b.pages.some((page) => page && !page.tombstone)) return false;
  const blobIds = new Set<string>();
  for (const page of b.pages) {
    if (!page || !Array.isArray(page.ids) || !Array.isArray(page.initialIds)) return false;
    if (!Number.isInteger(page.ordinal)) return false;
    for (const id of page.ids) blobIds.add(id);
  }
  // Rule 5a: the blob must describe the array it was saved with. A TRIMMED
  // blob covers a suffix of it, never a row the array does not carry.
  if (blobIds.size > restoredIds.length) return false;
  const restored = new Set(restoredIds);
  for (const id of blobIds) if (!restored.has(id)) return false;
  return true;
}

/**
 * Seed the pagination sidecar from a restored value array (+ optional blob).
 * Returns the changed nodes to notify. Bumps `generation` first: hydrate wins
 * over any pre-hydrate in-flight fetch.
 */
export function seedFamilyFromWindow(
  kernel: Palistor<any, any>,
  ls: ListState,
  restoredIds: string[],
  blob: unknown,
): Set<object> {
  const p = ls.pagination!;
  const changed = new Set<object>();
  const now = Date.now();
  const live = kernel.resolveManager.pagedLiveValues(ls);
  const context = kernel.context;
  const state = kernel.resolveManager.getOrCreateListResolveState(ls);
  const resolveDeps = ls.listConfig?.resolve?.deps ?? [];

  p.generation++;
  p.families.clear();
  p.familyOrder = [];
  p.isPreviousData = false;
  p.isStaleFromStorage = false;
  p.scrollAnchor = null;

  const synthesize = (): void => {
    // Rule 6: a window with no trusted family — file it under `initialPage`
    // as a stale baseline and let the first fetch reconcile. A `_tmp_*` row
    // is by construction an un-flushed optimistic add, never a server row:
    // it stays OUT of the baseline so the reconcile re-appends it (the only
    // way a draft survives a reload without a blob — nested instances never
    // persist one).
    const deps = bootstrapDeps(ls);
    const hash = computeQueryKey(ls, deps, live, context);
    p.currentQueryKey = hash;
    p.currentPage = p.config.initialPage;
    p.loadedOrdinals = [p.config.initialPage];
    const fam = getOrCreateFamily(p, hash, deps, false, now);
    const serverIds = restoredIds.filter((id) => !isTmpId(id));
    const entry: PageCacheEntry = {
      ids: [...restoredIds],
      initialIds: serverIds,
      fetchedCount: serverIds.length,
      status: "stale",
      fetchedAt: now,
    };
    fam.pages.set(p.config.initialPage, entry);
    touchPage(fam, p.config.initialPage);
    projectWindow(ls);
    if (state) {
      state.status = "idle";
      state.promise = null;
      state.error = null;
      state.dependencies = unionFamilyDeps(p, [...resolveDeps, ...(ls.filter?.serverPaths ?? [])]);
    }
  };

  if (!blobTrusted(ls, restoredIds, blob)) {
    synthesize();
    return changed;
  }

  // Rule 2: serve only under a matching key, with the context barrier.
  const deps = new Set(blob.deps);
  const ctxMissing = [...deps].some((d) => d.startsWith("$context.") && context[d.slice(9)] === undefined);
  const liveKey = computeQueryKey(ls, deps, live, context);
  const persistedKey = p.config.queryKey
    ? blob.queryKeyAtSave
    : keyFromPairs(blob.depValues.filter(([d]) => deps.has(d)));
  if (ctxMissing || persistedKey === undefined || persistedKey !== liveKey) {
    // Do not serve a window saved under other dep/context values: leave the
    // list empty and idle so the normal first fetch runs under the live key.
    p.currentQueryKey = null;
    p.currentPage = p.config.initialPage;
    p.loadedOrdinals = p.mode === "infinite" ? [] : [p.config.initialPage];
    ls.itemIds = [];
    ls.initialItemIds = [];
    if (state) {
      state.status = "idle";
      state.promise = null;
      state.error = null;
    }
    return changed;
  }

  // Rule 5b: bodies for locally removed server rows, then drop any id that
  // still has no body (a ghost id would desync `length` from `items`).
  if (blob.entities) {
    const bodies: EntityData[] = [];
    for (const [id, body] of Object.entries(blob.entities)) bodies.push({ ...body, id });
    if (bodies.length > 0) for (const n of kernel._setEntitiesRaw(bodies)) changed.add(n);
  }
  const hasBody = (id: string): boolean => kernel.entityRegistry.has(id);

  const fam = getOrCreateFamily(p, liveKey, deps, blob.settled, now);
  p.currentQueryKey = liveKey;
  if (blob.serverTotal != null) fam.serverTotal = blob.serverTotal;
  const savedAt = typeof blob.savedAt === "number" ? blob.savedAt : now;
  // Per-page `fetchedAt` is deliberately NOT persisted: with a finite
  // staleTime every restored page would be stale at once and revalidation
  // would fire N concurrent fetches on mount. One `savedAt` seeds them all.
  const stale = p.config.staleTime !== Infinity && now - savedAt >= p.config.staleTime;

  const filed: number[] = [];
  for (const page of blob.pages) {
    const entry: PageCacheEntry = page.tombstone
      ? {
          ids: [],
          initialIds: [],
          fetchedCount: page.fetchedCount,
          status: "stale",
          fetchedAt: savedAt,
          tombstone: true,
        }
      : {
          ids: page.ids.filter(hasBody),
          initialIds: page.initialIds.filter(hasBody),
          fetchedCount: page.fetchedCount,
          status: stale ? "stale" : "fresh",
          fetchedAt: savedAt,
        };
    if (!page.tombstone) {
      if (page.hasMore !== undefined) entry.hasMore = page.hasMore;
      if (page.nextCursor !== undefined) entry.nextCursor = page.nextCursor;
    }
    fam.pages.set(page.ordinal, entry);
    touchPage(fam, page.ordinal);
    filed.push(page.ordinal);
  }

  if (blob.cursors) {
    for (const [ordinal, cursor] of blob.cursors) fam.cursors.set(ordinal, cursor);
    // A persisted cursor is older than the storage round-trip: an optimistic
    // hint, and the first failure under it rebuilds the chain instead of
    // surfacing an error.
    if (blob.cursors.some(([, c]) => c != null)) fam.continuationTrust = "hydrated";
  }

  p.currentPage = blob.currentPage;
  // A tombstone is never a window ordinal — it left memory; only its
  // `fetchedCount` stays (counted by the continuation offset).
  const liveFiled = filed.filter((o) => !fam.pages.get(o)?.tombstone);
  p.loadedOrdinals =
    p.mode === "infinite"
      ? blob.loadedOrdinals.filter((o) => liveFiled.includes(o))
      : [blob.currentPage];
  p.isStaleFromStorage = stale;
  if (blob.anchorId) p.scrollAnchor = blob.anchorId;
  projectWindow(ls);

  if (blob.pendingAdds && blob.pendingAdds.length > 0) {
    // A tmp-id row whose POST died with the tab can never be rekeyed: its page
    // reads dirty forever and every refetch re-appends it. Kept (this is a
    // form library) but NAMED, with `discardPendingAdds()` as the escape.
    warnOnce(
      p,
      "pending-adds",
      `[palistor] list "${p.listPath}" restored ${blob.pendingAdds.length} un-flushed ` +
        `optimistic row(s) from storage [${blob.pendingAdds.join(", ")}]. They keep the list ` +
        `dirty until the server confirms them — call discardPendingAdds() to drop them.`,
    );
  }

  if (state) {
    state.status = "resolved";
    state.promise = null;
    state.error = null;
    state.dependencies = unionFamilyDeps(p, [...resolveDeps, ...(ls.filter?.serverPaths ?? [])]);
  }

  // Stale-while-revalidate: the restored pages are SERVED; `revalidateOnHydrate`
  // decides what refreshes behind them, one task after paint (never `'all'` by
  // default — that is N concurrent fetches on mount).
  const mode = p.config.revalidateOnHydrate;
  if (stale && mode !== "none" && liveFiled.length > 0) {
    const targets = mode === "all" ? liveFiled : [liveFiled[0]];
    setTimeout(() => {
      if (p.currentQueryKey !== liveKey) return;
      for (const o of targets) kernel.resolveManager.revalidatePaginated(ls, o);
    }, 0);
  }
  return changed;
}
