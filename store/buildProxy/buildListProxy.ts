import { CONFIG_NODE, LIST_STATE, LIST_ONLY_KEYS, LIST_SPREAD_KEYS } from "../constants";
import type { MappableKey } from "../constants";
import type { AnyConfigNode, ListState } from "../store/types";
import type { EntityData, EntityLeafNode } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import { generateTmpId } from "../entityRegistry";
import {
  buildEntityProjectionProxy,
  buildEntityValuesWithLists,
} from "./buildEntityProjectionProxy";

// ─── arraysEqual helper ──────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Keys of the per-entity list proxy. Same member set as
 * {@link LIST_SPREAD_KEYS}, but in the per-entity list's historical order —
 * kept until root and entity are aligned on keys.
 */
const ENTITY_LIST_SPREAD_KEYS: string[] = [
  "items",
  "length",
  "loading",
  "dirty",
  "error",
  "resolveStatus",
  "map",
  "getById",
  "add",
  "remove",
  "setItems",
  "getValues",
  "reload",
];

// ─── buildListProxy ──────────────────────────────────────────────────────────

/**
 * Build a ListProxyNode for a list — a SINGLE builder (root + per-entity).
 *
 * A list is identified by its {@link ListState} object. `listState.ownerEntity`
 * distinguishes the two cases:
 *   - `null`  → root list (state in `kernel.nodes.listStates`);
 *   - entity  → per-entity nested list (state in `owner.lists`).
 *
 * The skeleton, mutations, proxy and cache are shared. The spots where root
 * and entity still diverge (valuesCache sync, resolve/loading, add/setItems
 * semantics) dispatch on `owner` for now.
 *
 * The proxy exposes:
 *   items       — ReadonlyArray<EntityProjectionProxy>, one per itemId
 *   length      — number of items
 *   loading     — async resolver in progress
 *   dirty       — itemIds differ from the initial snapshot
 *   error       — error thrown by the last resolve run (null otherwise)
 *   resolveStatus — raw resolve status ("idle" | "pending" | "resolved" | "error")
 *   reload()    — force a resolver re-run
 *   add(id)     — add existing entity by ID
 *   add(values) — upsert entity + add to list
 *   remove(id)  — remove entity from list (entity stays in registry)
 *   getById(id) — find proxy by ID
 *   setItems(ids) — bulk-replace itemIds
 *   map(fn)     — map for React rendering
 *   getValues() — plain values snapshot of all items
 *   [Symbol.iterator] — iteration
 *
 * Entity proxies are cached per list instance (stable references for React);
 * the list proxy itself is cached per `ListState` in `kernel.nodes.listProxyCache`.
 */
export function buildListProxy(listState: ListState, kernel: Palistor<any, any>): object {
  // Stable proxy cache per ListState (single cache for root and per-entity).
  const cached = kernel.nodes.listProxyCache.get(listState as object);
  if (cached) return cached;

  const listConfigNode = listState.listConfigNode as AnyConfigNode;
  const template = listState.template as AnyConfigNode;
  const listConfig = listState.listConfig;
  /** List owner: `null` = root, EntityNode = per-entity. */
  const owner = listState.ownerEntity;

  // Per-list stable cache of entity projections (stable references for React).
  const entityProxyCache = new WeakMap<object, object>();

  /** Build EntityProjectionProxy for a given entityId. */
  function buildItemProxy(id: string): object | undefined {
    const entityNode = kernel.entityRegistry.get(id);
    if (!entityNode) return undefined;
    return buildEntityProjectionProxy(entityNode, template, kernel, entityProxyCache);
  }

  /** Current owner id (accounts for rekey via nodeState). Per-entity only. */
  const getOwnerId = (): string => {
    const idLeaf = owner!.id as object;
    return (
      (kernel.nodes.nodeState.get(idLeaf) as { value: unknown } | undefined)?.value ??
      (owner!.id as EntityLeafNode).value
    ) as string;
  };

  /** Notify observers that the list itself changed + recompute dependents. */
  const notifyListChanged = (): void => {
    kernel.syncListValuesCache(listState);
    if (owner) {
      // Per-entity: the isolated identity is the listState object itself; the
      // owner also goes into changed so `entity.values`/`entity.dirty` observers update.
      const changed = new Set<object>();
      changed.add(listState as unknown as object);
      changed.add(owner as unknown as object);
      const recomputed = kernel.recompute(changed);
      for (const n of changed) recomputed.add(n);
      kernel.notifyChanged(recomputed);
    } else {
      // Root: full recompute (valuesCache.users → all computed props).
      const recomputed = kernel.recompute();
      // Root-list tracking is keyed by the ListState object.
      recomputed.add(listState as unknown as object);
      // Backward-compat bridge: older tests read getNodeVersion(listNode).
      recomputed.add(listConfigNode as object);
      kernel.notifyChanged(recomputed);
    }
  };

  /** Trigger lazy list resolve on first access (root + per-entity, single path). */
  const triggerLazyResolveIfNeeded = (): void => {
    if (!listConfig?.resolve) return;
    const st = kernel.resolveManager.getListResolveState(listState);
    // Root: the state exists (idle from initResolveStates). Entity: may be absent.
    if (!st || st.status === "idle") {
      // Defer: the GET trap fires during a React render; a synchronous
      // resolve→notify would yield "Cannot update a component while rendering another".
      queueMicrotask(() => kernel.resolveManager.triggerListResolve(listState));
    }
  };

  // ─── Mutations ───────────────────────────────────────────────────────────────

  // Overloads: add(id) → void; add(values) → created entity proxy (TItem).
  // The proxy is returned only for the values form (matches ListProxyNode.add).
  const addFn = (idOrValues: string | Record<string, unknown>): object | undefined => {
    const fromValues = typeof idOrValues !== "string";
    if (owner) {
      const ownerId = getOwnerId();
      let entityId: string;
      if (typeof idOrValues === "string") {
        entityId = idOrValues;
        if (!kernel.entityRegistry.has(entityId)) {
          throw new Error(
            `[palistor] per-entity list add("${entityId}"): entity not found in registry.`,
          );
        }
      } else {
        const rawId = (idOrValues as { id?: unknown }).id;
        entityId =
          typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
        // set() registers leaf nodes + projectionObj (with its own recompute/notify).
        kernel.set({ ...(idOrValues as Record<string, unknown>), id: entityId });
      }
      const childNode = kernel.entityRegistry.get(entityId);
      if (childNode) {
        kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
      }
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
      }
      notifyListChanged();
      return fromValues ? buildItemProxy(entityId) : undefined;
    } else {
      let entityId: string;
      if (typeof idOrValues === "string") {
        entityId = idOrValues;
        if (!kernel.entityRegistry.has(entityId)) return undefined;
      } else {
        // upsert entity into store (creates entityProjectionObj + registers leaves)
        kernel.set(idOrValues as EntityData);
        const entityNode = kernel.entityRegistry.upsert(idOrValues as EntityData);
        entityId = entityNode.id.value as string;
      }
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
        notifyListChanged();
      }
      return fromValues ? buildItemProxy(entityId) : undefined;
    }
  };

  const removeFn = (id: string): void => {
    const idx = listState.itemIds.indexOf(id);
    if (idx === -1) return;
    listState.itemIds.splice(idx, 1);
    notifyListChanged();
  };

  const getByIdFn = (id: string): object | undefined => {
    if (!listState.itemIds.includes(id)) return undefined;
    return buildItemProxy(id);
  };

  const setItemsFn = (ids: string[]): void => {
    // Dedupe, keeping first-occurrence order: add() already forbids duplicate
    // membership (.includes() guard), so setItems must uphold the same
    // invariant — duplicates collide React keys and break remove/dirty diffs.
    const uniqueIds = [...new Set(ids)];
    if (owner) {
      const ownerId = getOwnerId();
      for (const id of uniqueIds) {
        if (!kernel.entityRegistry.has(id)) {
          throw new Error(
            `[palistor] per-entity list setItems: entity "${id}" not found in registry.`,
          );
        }
      }
      listState.itemIds = uniqueIds;
      for (const id of uniqueIds) {
        const childNode = kernel.entityRegistry.get(id);
        if (childNode) {
          kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
        }
      }
      notifyListChanged();
    } else {
      listState.itemIds.length = 0;
      for (const id of uniqueIds) listState.itemIds.push(id);
      notifyListChanged();
    }
  };

  const mapFn = <R>(
    fn: (item: object, index: number, id: string) => R,
  ): R[] => {
    return listState.itemIds
      .map((id, index) => {
        const proxy = buildItemProxy(id);
        if (!proxy) return undefined;
        return fn(proxy, index, id);
      })
      .filter((item): item is R => item !== undefined);
  };

  const getValuesFn = (): Array<Record<string, unknown>> =>
    listState.itemIds
      .map((id) => {
        const child = kernel.entityRegistry.get(id);
        return child ? buildEntityValuesWithLists(child, template, kernel) : undefined;
      })
      .filter((v): v is Record<string, unknown> => v !== undefined);

  /**
   * Force a resolver re-run, ignoring the resolved-state dedup.
   * Declared once per list proxy: the identity is stable, so it can sit in a
   * React deps array or an `onRetry` prop without re-triggering effects.
   * A no-op by construction when the list has no resolver.
   */
  const reloadFn = (): void => {
    kernel.resolveManager.triggerListResolve(listState, true);
  };

  // ─── Proxy object ──────────────────────────────────────────────────────────

  // internal → external projection of spread keys (mappable: loading, dirty).
  const fwd = kernel.fieldMapping;
  const spreadKeys = (owner ? ENTITY_LIST_SPREAD_KEYS : LIST_SPREAD_KEYS).map(
    (k) => fwd[k as MappableKey] ?? k,
  );

  const proxy = new Proxy(listConfigNode as unknown as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Transparent config node (for debugging/useForm). NOT the tracking key.
      if (key === CONFIG_NODE) return listConfigNode;
      // The list identity brand — the tracking key (uniform for root and per-entity).
      if (key === LIST_STATE) return listState;

      if (typeof key === "symbol") {
        if (key === Symbol.iterator) {
          return function* () {
            for (const id of listState.itemIds) {
              const itemProxy = buildItemProxy(id);
              if (itemProxy) yield itemProxy;
            }
          };
        }
        return undefined;
      }

      // Reverse mapping on input: external → internal (affects loading/dirty).
      // LIST_ONLY_KEYS are matched raw, before the translation: a fieldMapping
      // of `isInvalid → "error"` would otherwise rewrite `list.error` into
      // `isInvalid`, miss every case and silently return undefined.
      const ikey = LIST_ONLY_KEYS.has(key) ? key : (kernel.externalToInternal[key] ?? key);

      switch (ikey) {
        case "items":
          triggerLazyResolveIfNeeded();
          return listState.itemIds
            .map(buildItemProxy)
            .filter((item): item is object => item !== undefined);

        case "length":
          triggerLazyResolveIfNeeded();
          return listState.itemIds.length;

        case "loading":
          // Single source for root and per-entity: the resolve-state status.
          return (
            kernel.resolveManager.getListResolveState(listState)?.status === "pending"
          );

        case "error":
          // Projection of the existing ResolveState — no separate error state.
          return kernel.resolveManager.getListResolveState(listState)?.error ?? null;

        case "resolveStatus":
          // No resolve state yet (per-entity list before its first run) reads
          // as "idle", the same value initResolveStates gives a root list.
          return kernel.resolveManager.getListResolveState(listState)?.status ?? "idle";

        case "reload":
          return reloadFn;

        case "dirty":
          // dirty by composition: current itemIds differ from initial snapshot
          return !arraysEqual(listState.itemIds, listState.initialItemIds);

        case "add":
          return addFn;

        case "remove":
          return removeFn;

        case "getById":
          return getByIdFn;

        case "setItems":
          return setItemsFn;

        case "map":
          triggerLazyResolveIfNeeded();
          return mapFn;

        case "getValues":
          return getValuesFn;

        default:
          return undefined;
      }
    },

    set(_target, _key, _value) {
      // Lists are not directly writable via proxy
      return false;
    },

    ownKeys() {
      return spreadKeys;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!spreadKeys.includes(key as string)) return undefined;
      // Array targets have a non-configurable `length` property.
      // The proxy invariant requires that we mirror this exactly.
      if (key === "length") {
        return { configurable: false, enumerable: false, writable: true, value: listState.itemIds.length };
      }
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  kernel.nodes.listProxyCache.set(listState as object, proxy);
  return proxy;
}
