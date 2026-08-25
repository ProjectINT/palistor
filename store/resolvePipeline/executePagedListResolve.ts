/**
 * executePagedListResolve — the paginated executor (PaginationPlan.md).
 *
 * Mirrors `executeListResolve`'s guards (pending status, abort/drift,
 * auto-deps, onError) but is a separate file: the legacy executor and every
 * non-paginated list stay byte-for-byte unchanged.
 *
 * Differences that are load-bearing:
 * - per-family, per-ordinal `inFlight` dedup (implicit issuance only — `force`
 *   bypasses it and bumps `generation`), released BY IDENTITY in `finally`;
 * - `generation` + family + ordinal write gate (a prior-generation completion
 *   is a pure no-op cleanup);
 * - no `structuredClone`: a copy-on-read snapshot proxy over the live tree,
 *   with eager snapshots of the settled dep set and a completion-key gate;
 * - accessed paths are folded into BOTH `fam.dependencies` (key formation)
 *   and `state.dependencies` (retrigger selection);
 * - cross-page dedup (run-scoped) + the reconcile recipe for a page holding
 *   un-flushed local adds; an empty page is a `{ ids: [] }` entry, never the
 *   legacy wipe;
 * - a page only projects when it belongs to the CURRENT WINDOW of the current
 *   family (paged/cursor: it IS the current page; infinite: window membership,
 *   so an out-of-order or background-revalidation completion is not dropped);
 * - cursor/infinite: the chain is threaded through `ctx.page.cursor`, the
 *   ordinal joins the window on success only, and (infinite + offset) the
 *   `Σ fetchedCount` continuation is re-checked at completion.
 */
import type { EntityData, EntityRegistry } from "../entityRegistry";
import type { EntityNode } from "../entityRegistry/types";
import { generateTmpId } from "../entityRegistry";
import type { ListResolveConfig, ListResolveContext, ListState } from "../store/types";
import type { PageCacheEntry, PagedResult, PageRequest } from "../pagination/types";
import type { ResolveState } from "./types";
import {
  buildFilterParams,
  computeServerKey,
  getFilterValues,
} from "../filtering/filterController";
import {
  appendLoadedOrdinal,
  computeQueryKey,
  continuationOffset,
  currentFamily,
  cursorFor,
  ensureCurrentFamily,
  evictPagesBeyond,
  isSelfPath,
  isTruncatedOrdinal,
  recordCursor,
  renameFamily,
  staleShortPredecessor,
  touchPage,
  truncateHead,
  unionFamilyDeps,
  projectWindow,
  warnOnce,
  windowOrdinals,
} from "../pagination/paginationController";
import { recomputeAndNotify } from "../compute/recompute";
import { createContextTrackingProxy } from "./createContextTrackingProxy";
import { createLiveValuesSnapshotProxy } from "./createLiveValuesSnapshotProxy";
import { getByPath } from "./getByPath";
import { deepEqual } from "./deepEqual";
import type { ListResolveDeps } from "./executeListResolve";

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface PagedListResolveDeps extends ListResolveDeps {
  /**
   * Re-evaluate the queryKey after a mid-flight drift — the paged analog of
   * `pendingRetrigger` (which no paged run ever consumes).
   */
  retriggerPaginatedList: (listState: ListState) => void;
  /**
   * Re-issue the same ordinal at a corrected continuation offset (infinite +
   * offset: a delete landed mid-flight, which no values path can report).
   */
  reissuePagedFetch: (listState: ListState, ordinal: number) => void;
  /**
   * A continuation fetched off a cursor RESTORED FROM STORAGE failed. Such a
   * cursor is older than the storage round-trip by definition, so this is not
   * a user-visible error: the manager rebuilds the chain instead.
   */
  onContinuationFailure: (listState: ListState, ordinal: number, error: unknown) => void;
  /**
   * TARGETED recompute over the changed nodes (a root list sources to group
   * path "" and the groupDeps edges cover cross-group readers of its slot).
   * Without it every page completion — every `loadMore` — is a full-tree
   * recompute.
   */
  recomputeScoped: (changed: Set<object>) => Set<object>;
  /**
   * The resolve state a paginated list runs under — root: the shared
   * `resolveStates` entry keyed by the list node; nested: the per-owner entry
   * in `entityStates`, keyed by `(ownerId, listConfigNode)`.
   */
  pagedStateOf: (listState: ListState) => ResolveState | undefined;
  /**
   * What the resolver reads as `values` — root: the live values tree; nested:
   * the OWNER's flat snapshot (the legacy nested contract). Also the tree the
   * queryKey and the drift check are evaluated against.
   */
  pagedLiveValues: (listState: ListState) => Record<string, unknown>;
  /** Owner references for nested ingestion. */
  entityRegistry: EntityRegistry;
  ownerIdOf: (owner: EntityNode) => string;
}

const DEFAULT_LIST_STATE = {
  value: undefined,
  isVisible: true,
  isRequired: false,
  isDisabled: false,
  isReadOnly: false,
  loading: false,
  dirty: false,
  revalidate: false,
} as const;

function safeClone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}

/** Config-driven normalization: a bare array is `{ items }` (no precise total). */
function normalize(raw: unknown): PagedResult {
  if (Array.isArray(raw)) return { items: raw as Array<Record<string, unknown>> };
  if (raw && typeof raw === "object" && Array.isArray((raw as PagedResult).items)) {
    return raw as PagedResult;
  }
  return { items: [] };
}

// ─── Executor ────────────────────────────────────────────────────────────────

export function executePagedListResolve(
  listNode: object,
  resolve: ListResolveConfig,
  listState: ListState,
  requestedOrdinal: number,
  deps: PagedListResolveDeps,
  force = false,
  /** Cache-only warmup: never joins the window, whatever the ordinal. */
  prefetch = false,
): Promise<unknown> {
  const {
    nodeState,
    notifyChanged,
    notify,
    setEntitiesRaw,
    syncListValuesCache,
    store,
  } = deps;

  const p = listState.pagination!;
  const state = deps.pagedStateOf(listState);
  if (!state) return Promise.resolve();

  /** Root list (`null`) or the owner of a nested instance. */
  const owner = listState.ownerEntity;
  const ownerId = owner ? deps.ownerIdOf(owner) : null;
  /** Tracking keys: the ListState always; root adds the listNode bridge, nested its owner. */
  const changedBase = (): Set<object> =>
    owner
      ? new Set<object>([listState as object, owner as unknown as object])
      : new Set<object>([listNode, listState as object]);
  /** `loading` in nodeState is a root-only flag (the node is shared across owners). */
  const setNodeLoading = (loading: boolean): void => {
    if (owner) return;
    const st = nodeState.get(listNode);
    nodeState.set(listNode, { ...(st ?? DEFAULT_LIST_STATE), loading });
  };

  const now = Date.now();
  const live = (): Record<string, unknown> => deps.pagedLiveValues(listState);

  // ── 1. Family + key at ISSUE time ────────────────────────────────────────
  // `currentQueryKey` is assigned here, so a bootstrap fetch never projects
  // from `families.get(null)`. A key that moved under our feet (a dep edited
  // while the entry was idle/pending and hence not selected by the hook)
  // resets the pointer to `initialPage` exactly like `_retriggerPaginatedList`.
  const { fam, keyChanged } = ensureCurrentFamily(listState, live(), store.context, now);
  const ordinal = keyChanged
    ? (p.mode === "infinite" ? p.config.initialPage : p.currentPage)
    : requestedOrdinal;
  if (keyChanged) {
    if (p.config.keepPreviousData) {
      // Opt-in: keep rendering the PREVIOUS query's window until this page
      // lands (`isPreviousData` tells the UI which it is looking at).
      p.isPreviousData = true;
    } else {
      // The old window belongs to another query — never render it under this key.
      projectWindow(listState);
      syncListValuesCache(listState);
    }
  }

  // A head-truncated ordinal (`maxPages`) is never re-fetched in place: its
  // rows left the window for good; only `refetch()` (truncate + restart)
  // brings the head back.
  if (isTruncatedOrdinal(p, fam, ordinal)) return Promise.resolve();

  // ── 2. Per-family, per-ordinal dedup (implicit issuance only) ───────────
  if (!force) {
    const existing = fam.inFlight.get(ordinal);
    if (existing) return existing;
  } else {
    p.generation++;
  }
  const issuedGeneration = p.generation;
  const issuedFam = fam;

  const prevEntry = fam.pages.get(ordinal);
  const prevStatus = prevEntry?.status;
  if (prevEntry) prevEntry.status = "refetching";

  // The in-flight entry is filed BEFORE the pending notify, so a subscriber
  // reading `isFetching` synchronously already sees it. `run()` starts only
  // after the notify (the resolver never observes a half-issued state).
  let start!: () => void;
  const myPromise: Promise<unknown> = new Promise<unknown>((res, rej) => {
    start = () => run().then(res, rej);
  });
  fam.inFlight.set(ordinal, myPromise);
  state.promise = myPromise;

  // ── 3. pending ──────────────────────────────────────────────────────────
  state.status = "pending";
  state.attempt = 0;
  state.error = null;
  setNodeLoading(true);
  const notifyScoped = (changed: Set<object>): void =>
    recomputeAndNotify(changed, () => deps.recomputeScoped(changed), notifyChanged);
  notifyScoped(changedBase());

  // Eager per-path snapshots of the KNOWN dep set (cheap — it is the settled
  // set, not the tree). Closes the bootstrap hole for deps read before an
  // edit lands but after the copy-on-first-access snapshot would be taken.
  const eagerValueSnaps = new Map<string, unknown>();
  const eagerCtxSnaps = new Map<string, unknown>();
  const knownDeps = new Set<string>(resolve.deps ?? []);
  for (const d of fam.dependencies) knownDeps.add(d);
  if (listState.filter) for (const d of listState.filter.serverPaths) knownDeps.add(d);
  for (const d of knownDeps) {
    if (isSelfPath(p.listPath, d)) continue;
    if (d.startsWith("$context.")) eagerCtxSnaps.set(d.slice(9), store.context[d.slice(9)]);
    else eagerValueSnaps.set(d, safeClone(getByPath(live(), d)));
  }

  // ── Filter block (exactly as the legacy executor builds it) ─────────────
  const fs = listState.filter;
  const launchFilterValues = fs ? getFilterValues(fs, nodeState) : {};
  const launchServerKey = fs ? computeServerKey(fs, nodeState) : "";
  if (fs) {
    fs.serverKey = launchServerKey;
    fs.issuedKey = launchServerKey;
  }

  // infinite + offset: the continuation is `Σ fetchedCount` over the loaded
  // ordinals, captured at ISSUE time and re-checked at completion (step 6d) —
  // a delete landing mid-flight shifts every later server offset and is
  // invisible to path drift, since `page`/offset is never a values path.
  const expectedOffset = continuationOffset(p, fam, ordinal);
  const req: PageRequest = {
    page: ordinal,
    pageSize: p.pageSize,
    offset: expectedOffset,
    queryKey: fam.queryKeyHash,
  };
  if (p.mode !== "paged") req.cursor = cursorFor(fam, ordinal, p.base) ?? null;
  /** This run rides a cursor restored from storage (older than the round-trip). */
  const onHydratedCursor =
    p.mode !== "paged" && fam.continuationTrust === "hydrated" && req.cursor != null;

  let released = false;

  /**
   * Identity-checked `inFlight` release + status settle. Idempotent. An
   * unconditional delete would let a superseded fetch remove the
   * replacement's entry (false drain: `isFetching` false mid-flight).
   */
  const release = (outcome: "success" | "error" | "noop"): void => {
    if (released) return;
    released = true;
    if (issuedFam.inFlight.get(ordinal) === myPromise) {
      issuedFam.inFlight.delete(ordinal);
    }
    const drained = (currentFamily(p)?.inFlight.size ?? 0) === 0;
    if (outcome === "success") {
      state.error = null;
      state.status = drained ? "resolved" : "pending";
    } else if (outcome === "noop") {
      if (drained && state.status === "pending") state.status = "resolved";
    }
    // error: status already set by the caller.
    if (drained) setNodeLoading(false);
  };

  const restorePrevEntry = (): void => {
    if (prevEntry && issuedFam.pages.get(ordinal) === prevEntry && prevEntry.status === "refetching") {
      prevEntry.status = prevStatus === "fresh" ? "stale" : (prevStatus ?? "stale");
    }
  };

  const run = async (): Promise<unknown> => {
    let contextTracking: ReturnType<typeof createContextTrackingProxy> | null = null;
    let snapshot: ReturnType<typeof createLiveValuesSnapshotProxy> | null = null;

    /** Fold everything the run read into the family's key-formation set. */
    const foldDeps = (): void => {
      if (snapshot) {
        for (const path of snapshot.getAccessedPaths()) {
          if (!isSelfPath(p.listPath, path)) issuedFam.dependencies.add(path);
        }
      }
      if (contextTracking) {
        for (const key of contextTracking.getAccessedKeys()) issuedFam.dependencies.add(`$context.${key}`);
      }
      if (fs) for (const d of fs.serverPaths) issuedFam.dependencies.add(d);
      state.dependencies = unionFamilyDeps(p, resolve.deps ?? []);
    };

    try {
      // ── 4. Snapshot proxy over the LIVE tree (no structuredClone) ───────
      // Nested: the owner snapshot never contains the list (or `$filters`),
      // so there is no self slot to hide or warn about.
      snapshot = createLiveValuesSnapshotProxy(live(), {
        hiddenRootKeys: owner ? [] : ["$filters"],
        selfPath: owner ? undefined : p.listPath,
        onSelfRead: () =>
          warnOnce(
            p,
            "self-read",
            `[palistor] the resolver of paginated list "${p.listPath}" reads its own slot ` +
              `(values.${p.listPath}) — that deep-copies the whole window and is excluded from ` +
              `the queryKey; use ctx.page for "what is loaded".`,
          ),
      });
      const startContext = store.context;
      contextTracking = createContextTrackingProxy(startContext);
      const storeProxy = new Proxy(store, {
        get(target, key) {
          if (key === "context") return contextTracking!.proxy;
          return (target as any)[key];
        },
      });
      const ctx: ListResolveContext = {
        filter: {
          values: launchFilterValues,
          params: fs
            ? buildFilterParams(fs, launchFilterValues, (store.context ?? {}) as Record<string, unknown>)
            : undefined,
          key: launchServerKey,
        },
        page: req,
        queryKey: fam.queryKeyHash,
      };

      const raw = await resolve.resolver(snapshot.proxy, storeProxy, ctx);

      // ── 6. Abort / drift guards (sampled PRE own-write) ─────────────────
      // (a) superseded: reset / evict / key change / forced re-issue.
      if (issuedGeneration !== p.generation || p.families.get(issuedFam.queryKeyHash) !== issuedFam) {
        release("noop");
        return raw;
      }
      const liveNow = live();
      const liveCtx = store.context;
      let drift = false;
      // (b) per-accessed-path VALUE equality — eager dep snapshots first, then
      // the copy-on-first-access snapshots; the list's own slot is excluded (a
      // sibling page projecting mid-flight is not drift).
      for (const [path, snap] of eagerValueSnaps) {
        if (!deepEqual(snap, getByPath(liveNow, path))) { drift = true; break; }
      }
      if (!drift) {
        for (const path of snapshot.getAccessedPaths()) {
          if (isSelfPath(p.listPath, path)) continue;
          if (!deepEqual(snapshot.getSnapshot(path), getByPath(liveNow, path))) { drift = true; break; }
        }
      }
      if (!drift) {
        for (const [key, v] of eagerCtxSnaps) if (liveCtx[key] !== v) { drift = true; break; }
      }
      if (!drift) {
        for (const key of contextTracking.getAccessedKeys()) {
          if (startContext[key] !== liveCtx[key]) { drift = true; break; }
        }
      }
      // (c) completion-key gate over the SETTLED set: the family's hash must
      // still describe the live values this result was produced under.
      if (!drift && issuedFam.settled) {
        if (computeQueryKey(listState, issuedFam.dependencies, liveNow, liveCtx) !== issuedFam.queryKeyHash) {
          drift = true;
        }
      }

      // (d) continuation gate (infinite + offset): recompute the counter; a
      // mismatch means a delete/promotion landed mid-flight, so this window is
      // shifted by a row — discard and reissue at the corrected offset.
      if (!drift && p.mode === "infinite" && req.cursor == null) {
        if (continuationOffset(p, issuedFam, ordinal) !== expectedOffset) {
          foldDeps();
          restorePrevEntry();
          release("noop");
          deps.reissuePagedFetch(listState, ordinal);
          return raw;
        }
      }

      if (drift) {
        // Discard and re-key under the fresh values. The accessed paths are
        // folded FIRST so the retrigger sees the widened set; the in-flight
        // entry is released BEFORE the retrigger so a reverted key (A→B→A)
        // does not dedup against this dying promise.
        foldDeps();
        restorePrevEntry();
        release("noop");
        deps.retriggerPaginatedList(listState);
        return raw;
      }

      // ── 7. Success ──────────────────────────────────────────────────────
      const norm = normalize(raw);
      // Nested: ids are fixed upfront (a row without one gets a stable tmp
      // id — the legacy nested contract) and every child carries the owner
      // reference (cascade delete, re-parenting).
      const items = owner
        ? norm.items.map((item) => {
            const rawId = (item as { id?: unknown }).id;
            return typeof rawId === "string" && rawId.trim() !== ""
              ? item
              : { ...item, id: generateTmpId() };
          })
        : norm.items;
      const changed = changedBase();
      if (items.length > 0) {
        const entityChanged = setEntitiesRaw(items as EntityData[], listNode);
        for (const n of entityChanged) changed.add(n);
        if (owner && ownerId !== null) {
          for (const item of items) {
            const child = deps.entityRegistry.get((item as { id: string }).id);
            if (child) deps.entityRegistry.setEntityOwner(child, ownerId, listNode);
          }
        }
      }
      const fetchedIds = [
        ...new Set(
          items
            .map((item) => (item as { id?: unknown }).id)
            .filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      ];
      const fetchedCount = fetchedIds.length;

      // Run-scoped cross-page dedup: ids already held by another page of the
      // same family are dropped — except pages being replaced by this run.
      const elsewhere = new Set<string>();
      for (const [o, e] of issuedFam.pages) {
        if (o === ordinal || e.status === "refetching") continue;
        for (const id of e.ids) elsewhere.add(id);
      }
      const ids = fetchedIds.filter((id) => !elsewhere.has(id));

      // Reconcile, never skip: local-only rows of the old entry are re-appended.
      const old = issuedFam.pages.get(ordinal);
      let newIds = ids;
      if (old) {
        const oldInit = new Set(old.initialIds);
        const fetchedSet = new Set(ids);
        const localAdds = old.ids.filter(
          (id) => !oldInit.has(id) && !fetchedSet.has(id) && !elsewhere.has(id),
        );
        if (localAdds.length > 0) newIds = [...ids, ...localAdds];
      }
      const entry: PageCacheEntry = {
        ids: newIds,
        initialIds: [...ids],
        fetchedCount,
        status: "fresh",
        fetchedAt: Date.now(),
      };
      if (norm.nextCursor !== undefined) entry.nextCursor = norm.nextCursor;
      if (norm.hasMore !== undefined) entry.hasMore = norm.hasMore;
      else if (items.length === 0) entry.hasMore = false;
      issuedFam.pages.set(ordinal, entry);
      touchPage(issuedFam, ordinal);

      // Cursor chain: the FRESH cursor always wins, and a completed page mints
      // its successor's. Recorded ONLY when the resolver actually threads
      // cursors — an offset feed must never look like a chain (that would make
      // every ordinal "sequential-only" and refuse a plain prefetch).
      if (p.mode !== "paged") {
        if (req.cursor != null) issuedFam.cursors.set(ordinal, req.cursor);
        if (norm.nextCursor !== undefined) {
          recordCursor(issuedFam, ordinal, norm.nextCursor);
          if (ordinal >= (p.loadedOrdinals.length ? Math.max(...p.loadedOrdinals) : p.base)) {
            issuedFam.nextCursor = norm.nextCursor;
          }
        }
        issuedFam.continuationTrust = "live";
        issuedFam.continuationLost = false;
      }
      // (infinite) the ordinal joins the window HERE — on success, never at
      // issue: a failed fetch must not leave a hole, and a retry re-targets
      // the same ordinal. A prefetch beyond `max+1` stays cache-only until a
      // `loadMore` claims it.
      if (p.mode === "infinite" && !prefetch) {
        const max = p.loadedOrdinals.length ? Math.max(...p.loadedOrdinals) : p.base - 1;
        // Never below a head-truncated window: a dropped ordinal stays dropped.
        const min = p.loadedOrdinals.length ? Math.min(...p.loadedOrdinals) : p.base;
        if (p.loadedOrdinals.includes(ordinal) || (ordinal <= max + 1 && ordinal >= min)) {
          appendLoadedOrdinal(p, ordinal);
          // `maxPages`: the window sheds its oldest ordinals (tombstoned).
          truncateHead(listState);
        }
      }
      // paged: the predecessor can no longer borrow this page's head.
      staleShortPredecessor(p, issuedFam, ordinal);

      if (typeof norm.total === "number") {
        issuedFam.serverTotal = norm.total;
      } else if (issuedFam.serverTotal != null && old) {
        // No server total: re-derive from this page's baseline delta rather
        // than trusting accumulated promotions (fetch-loses-to-commit).
        issuedFam.serverTotal = Math.max(0, issuedFam.serverTotal + ids.length - old.initialIds.length);
      }
      evictPagesBeyond(issuedFam, p.config.maxCachedPages, windowOrdinals(p));

      // Auto-deps → BOTH sets; a widened dep set with unchanged values renames
      // the family in place (never an eviction).
      foldDeps();
      const refinedHash = computeQueryKey(listState, issuedFam.dependencies, liveNow, liveCtx);
      if (refinedHash !== issuedFam.queryKeyHash) renameFamily(p, issuedFam, refinedHash);
      issuedFam.settled = true;

      // ── 8. Projection gate ──────────────────────────────────────────────
      // paged/cursor: the page must BE the current one. infinite: window
      // membership — the paged gate would silently drop an out-of-order
      // `loadMore` completion or an in-window background revalidation, leaving
      // fetched rows invisible in cache.
      const inWindow =
        p.mode === "infinite"
          ? p.loadedOrdinals.includes(ordinal)
          : ordinal === p.currentPage;
      if (currentFamily(p) === issuedFam && inWindow) {
        p.isPreviousData = false;
        p.isStaleFromStorage = false;
        projectWindow(listState);
        syncListValuesCache(listState);
      }

      release("success");
      notifyScoped(changed);
      return raw;
    } catch (err) {
      if (issuedGeneration !== p.generation || p.families.get(issuedFam.queryKeyHash) !== issuedFam) {
        release("noop");
        return undefined;
      }
      if (onHydratedCursor) {
        // Transparent chain rebuild — never an error state (see the deps doc).
        restorePrevEntry();
        issuedFam.cursors.delete(ordinal);
        issuedFam.continuationTrust = "live";
        foldDeps();
        release("noop");
        deps.onContinuationFailure(listState, ordinal, err);
        return undefined;
      }
      restorePrevEntry();
      state.status = "error";
      state.error = err;
      foldDeps();
      release("error");
      try {
        resolve.onError?.(err, { notify });
      } catch {
        // onError should not throw
      }
      notifyScoped(changedBase());
      return undefined;
    } finally {
      release("noop");
    }
  };

  start();
  return myPromise;
}
