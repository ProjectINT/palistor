import { CONFIG_NODE, LIST_SPREAD_KEYS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { EntityData } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import { buildEntityProjectionProxy } from "./buildEntityProjectionProxy";

// ─── arraysEqual helper ──────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Update `valuesCache.values[listKey]` after any list mutation (add/remove/setItems).
 *
 * Uses the nodeSlot registered for the listNode in buildValuesCache.
 * The array contains plain entity projection POJOs (shared references),
 * so computed expressions like `values.users.length > 0` work correctly.
 */
function syncListValuesCache(
  listNode: unknown[],
  kernel: Palistor<any>,
): void {
  const slot = kernel.values.nodeSlot.get(listNode as unknown as object);
  if (!slot) return;

  const listState = kernel.nodes.listStates.get(listNode as unknown as object);
  if (!listState) return;

  slot.parent[slot.key] = listState.itemIds
    .map((id) => kernel.entityProjectionObjs.get(id))
    .filter((obj): obj is Record<string, unknown> => obj !== undefined);
}

// ─── buildListProxy ──────────────────────────────────────────────────────────

/**
 * Build a ListProxyNode for an array-type ListNode in the config.
 *
 * The proxy exposes:
 *   items       — ReadonlyArray<EntityProjectionProxy>, one per itemId
 *   length      — number of items
 *   loading     — async resolver in progress (Phase 2C)
 *   add(id)     — add existing entity by ID
 *   add(values) — upsert entity + add to list
 *   remove(id)  — remove entity from list (entity stays in registry)
 *   getById(id) — find proxy by ID
 *   setItems(ids) — bulk-replace itemIds
 *   map(fn)     — map for React rendering
 *   [Symbol.iterator] — iteration
 *
 * Entity proxies are cached per list instance (stable references for React).
 */
export function buildListProxy(listNode: unknown[], kernel: Palistor<any>): object {
  const listState = kernel.nodes.listStates.get(listNode as unknown as object)!;
  const template = listState.template as AnyConfigNode;

  // Per-list stable proxy caches
  const entityProxyCache = new WeakMap<object, object>();
  const leafProxyCache = new WeakMap<object, object>();

  /** Build EntityProjectionProxy for a given entityId. */
  function buildItemProxy(id: string): object | undefined {
    const entityNode = kernel.entityRegistry.get(id);
    if (!entityNode) return undefined;
    return buildEntityProjectionProxy(
      entityNode,
      template,
      kernel,
      entityProxyCache,
      leafProxyCache,
    );
  }

  /** Notify observers that the list itself has changed + recompute dependents. */
  function notifyListChanged(): void {
    const listNodeObj = listNode as unknown as object;
    // Full recompute propagates valuesCache.users changes to all computed
    // expressions (e.g. isVisible: (values) => values.users.length > 0).
    const recomputed = kernel.recompute();
    recomputed.add(listNodeObj);
    kernel.notifyChanged(recomputed);
  }

  /** Trigger lazy list resolve on first access (if resolve config exists and status is idle). */
  function triggerLazyResolveIfNeeded(): void {
    const listConfig = listState.listConfig;
    if (!listConfig?.resolve) return;
    const listNodeObj = listNode as unknown as object;
    const resolveState = kernel.resolveManager.states.get(listNodeObj);
    if (resolveState?.status === "idle") {
      kernel.resolveManager.triggerResolve(listNodeObj as AnyConfigNode);
    }
  }

  // Stable method references (avoid recreation on every GET)
  const addFn = (idOrValues: string | Record<string, unknown>): void => {
    let entityId: string;

    if (typeof idOrValues === "string") {
      entityId = idOrValues;
      if (!kernel.entityRegistry.has(entityId)) return;
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
        listState.version++;
        syncListValuesCache(listNode, kernel);
        notifyListChanged();
      }
    } else {
      // upsert entity into store (creates entityProjectionObj + registers leaves)
      kernel.set(idOrValues as EntityData);
      // retrieve id after upsert
      const entityNode = kernel.entityRegistry.upsert(idOrValues as EntityData);
      entityId = entityNode.id.value as string;
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
        listState.version++;
        syncListValuesCache(listNode, kernel);
        notifyListChanged();
      }
    }
  };

  const removeFn = (id: string): void => {
    const idx = listState.itemIds.indexOf(id);
    if (idx === -1) return;
    listState.itemIds.splice(idx, 1);
    listState.version++;
    syncListValuesCache(listNode, kernel);
    notifyListChanged();
  };

  const getByIdFn = (id: string): object | undefined => {
    if (!listState.itemIds.includes(id)) return undefined;
    return buildItemProxy(id);
  };

  const setItemsFn = (ids: string[]): void => {
    listState.itemIds.length = 0;
    for (const id of ids) listState.itemIds.push(id);
    listState.version++;
    syncListValuesCache(listNode, kernel);
    notifyListChanged();
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

  // ─── Proxy object ──────────────────────────────────────────────────────

  const proxy = new Proxy(listNode as unknown as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Transparent for tracking proxy (exposes the raw listNode as config node)
      if (key === CONFIG_NODE) return listNode;

      if (typeof key === "symbol") {
        if (key === Symbol.iterator) {
          return function* () {
            for (const id of listState.itemIds) {
              const proxy = buildItemProxy(id);
              if (proxy) yield proxy;
            }
          };
        }
        return undefined;
      }

      switch (key) {
        case "items":
          triggerLazyResolveIfNeeded();
          return listState.itemIds
            .map(buildItemProxy)
            .filter((item): item is object => item !== undefined);

        case "length":
          triggerLazyResolveIfNeeded();
          return listState.itemIds.length;

        case "loading":
          // Loading state comes from nodeState (set by resolver in Phase 2C).
          // Falls back to false when no resolver is active.
          return (
            (kernel.nodes.nodeState.get(listNode as unknown as object) as
              | { loading?: boolean }
              | undefined)?.loading ?? false
          );

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

        default:
          return undefined;
      }
    },

    set(_target, _key, _value) {
      // Lists are not directly writable via proxy
      return false;
    },

    ownKeys() {
      return LIST_SPREAD_KEYS;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!LIST_SPREAD_KEYS.includes(key as string)) return undefined;
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  return proxy;
}
