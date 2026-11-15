/**
 * Contract shim for slice G (pagination).
 *
 * The page cache is the feature itself, not mechanism: store keeps it on
 * `ListState.pagination`, cube on `ListCube.pager`, with the same field names
 * (`families`, `pages`, `status`, `loadedOrdinals`, `currentQueryKey`,
 * `config`, …). Tests that pin cache internals read them through `paging()`.
 * Two internal entry points are mapped too: a background revalidation of one
 * ordinal and an explicit fetch of one (store: `resolveManager.*`).
 *
 * The spread key lists are copied from store/constants.ts: the contract pins
 * them, so they must outlive store/.
 */
import { CONFIG_NODE, LIST_STATE } from "../../../store/constants";
import { cubeOf } from "../../core";

export interface Paging {
  /** The pagination sidecar (store `PaginationState`, cube `Pager`); undefined on a plain list. */
  p: any;
  /** The window's ids, without waking the lazy fetch. */
  itemIds(): string[];
  /** Background revalidation of one ordinal (store `revalidatePaginated`). */
  revalidate(ordinal: number): void;
  /** An explicit fetch of one ordinal (store `triggerPagedFetch`). */
  fetch(ordinal: number): Promise<unknown>;
}

export function paging(store: any, list: any): Paging {
  const ls = list[LIST_STATE];
  if (ls) {
    return {
      p: ls.pagination,
      itemIds: () => ls.itemIds,
      revalidate: (o) => store.resolveManager.revalidatePaginated(ls, o),
      fetch: (o) => store.resolveManager.triggerPagedFetch(ls, o),
    };
  }
  const cube = cubeOf(list) as any;
  const pager = cube?.pager;
  return {
    p: pager,
    itemIds: () => cube.windowIds(),
    revalidate: (o) => pager.revalidate(o),
    fetch: (o) => pager.fetchPage(o),
  };
}

/** The current family of a paginated list. */
export const familyOf = (p: any) => p.families.get(p.currentQueryKey);

/** store keys versions by its internal objects (a list's ListState), cube by the public node. */
export const trackKey = (node: any): object => node[LIST_STATE] ?? node[CONFIG_NODE] ?? node;

export const ownerOf = (store: any, id: string) =>
  store.entityRegistry.ownerOf?.(id) ?? store.entityRegistry.get(id)?.owner;

export const LIST_SPREAD_KEYS = [
  "items", "length", "loading", "dirty", "error", "resolveStatus",
  "add", "remove", "getById", "setItems", "map", "getValues", "reload",
];

export const PAGINATION_SPREAD_KEYS = [
  "page", "pageSize", "pageCount", "total", "serverTotal", "hasNextPage", "hasPrevPage",
  "isFetching", "isInitialLoading", "isPreviousData", "isStaleFromStorage", "pendingAdds", "scrollAnchor",
  "setPage", "nextPage", "prevPage", "refetch", "invalidate", "prefetch", "setPageSize",
  "discardPendingAdds", "setScrollAnchor",
];

export const INFINITE_SPREAD_KEYS = ["isFetchingNextPage", "loadedPages", "loadMore"];
