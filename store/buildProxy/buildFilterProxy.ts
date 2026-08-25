import { CONFIG_NODE, FILTER_STATE } from "../constants";
import type { ListState } from "../store/types";
import type { Palistor } from "../store/palistor";
import type { FilterState } from "../filtering/types";
import { FILTER_PROXY_BUILTINS } from "../filtering/normalizeFilterBlock";
import {
  emptyValueFor,
  filterActiveCount,
  getFilterValues,
  isFilterActive,
} from "../filtering/filterController";

/**
 * Build the `list.filter` proxy — CONTROLS only, one boundary: `list.filter`
 * carries the filter's fields and aggregates, the list carries the data. No
 * list row is ever reachable here (a `filter.items` for server fields would be
 * indistinguishable from `list.items`, so the `where`→server migration would
 * break every component that used it).
 *
 * - `filter.<field>` — a full field proxy (the standard leaf-proxy path),
 *   bindable to an input exactly like `form.name`. Derived fields are wrapped
 *   read-only: a write throws instead of silently no-oping.
 * - `values` / `set` / `reset` / `clear` / `isActive` / `activeCount` /
 *   `isPending` — the whole builtin budget (field names must not collide;
 *   normalizeFilterBlock throws on that at construction).
 *
 * Cached per FilterState in `kernel.nodes.listProxyCache` (stable identity).
 */
export function buildFilterProxy(listState: ListState, kernel: Palistor<any, any>): object {
  const fs = listState.filter as FilterState;
  const cached = kernel.nodes.listProxyCache.get(fs as unknown as object);
  if (cached) return cached;

  const derivedWrapperCache = new Map<string, object>();

  /**
   * One bulk write for `set`/`reset`/`clear`: flushes any pending debounce
   * timer, applies the patch with a single notify, and forces the resulting
   * invalidation to issue immediately (the delay belongs to a keystroke, not
   * to an explicit bulk action).
   */
  const applyFilterPatch = (patch: Record<string, unknown>): void => {
    for (const key of Object.keys(patch)) {
      const rt = fs.fields.get(key);
      if (rt?.isDerived) {
        throw new Error(
          `[palistor] filter field "${key}" on list "${fs.listPath}" is derived (its ` +
            `"value" is a function) and read-only — recomputeLeaves owns its value.`,
        );
      }
    }
    const hadPending = fs.pendingTimer !== null;
    if (fs.pendingTimer) {
      clearTimeout(fs.pendingTimer);
      fs.pendingTimer = null;
    }
    fs.forceImmediate = true;
    try {
      kernel.setValuesNode(fs.groupNode, patch);
    } finally {
      fs.forceImmediate = false;
    }
    // A queued debounced change whose field was NOT in this patch must not be
    // lost: flush by key comparison (a no-op when the patch already issued).
    if (hadPending) kernel.resolveManager.flushFilterInvalidation(listState);
  };

  const setFn = (patch: Record<string, unknown>): void => applyFilterPatch(patch);

  const resetFn = (): void => {
    const patch: Record<string, unknown> = {};
    for (const rt of fs.fields.values()) {
      if (rt.isDerived) continue;
      patch[rt.key] = rt.defaultValue;
    }
    applyFilterPatch(patch);
  };

  const clearFn = (field?: string): void => {
    if (field !== undefined) {
      const rt = fs.fields.get(field);
      if (!rt || rt.isDerived) return;
      applyFilterPatch({ [field]: emptyValueFor(rt.defaultValue) });
      return;
    }
    const patch: Record<string, unknown> = {};
    for (const rt of fs.fields.values()) {
      if (rt.isDerived) continue;
      patch[rt.key] = emptyValueFor(rt.defaultValue);
    }
    applyFilterPatch(patch);
  };

  /** Read-only wrapper for a derived field's proxy: writes throw in place of a silent no-op. */
  const wrapDerived = (key: string, fieldProxy: object): object => {
    const hit = derivedWrapperCache.get(key);
    if (hit) return hit;
    const throwWrite = (): never => {
      throw new Error(
        `[palistor] filter field "${key}" on list "${fs.listPath}" is derived and read-only.`,
      );
    };
    const wrapper = new Proxy(fieldProxy as Record<string | symbol, unknown>, {
      get(target, k) {
        if (k === "onValueChange") return throwWrite;
        return (target as Record<string | symbol, unknown>)[k as never];
      },
      set() {
        throwWrite();
        return false;
      },
    });
    derivedWrapperCache.set(key, wrapper);
    return wrapper;
  };

  const ownKeys = [...fs.fields.keys(), ...FILTER_PROXY_BUILTINS];

  const proxy = new Proxy(fs.groupNode as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      if (key === CONFIG_NODE) return fs.groupNode;
      if (key === FILTER_STATE) return fs;
      if (typeof key === "symbol") return undefined;

      // Builtins are matched raw — the filter namespace is the author's, but
      // these seven names are the reserved budget (collisions throw at construction).
      switch (key) {
        case "values":
          return getFilterValues(fs, kernel.nodes.nodeState);
        case "set":
          return setFn;
        case "reset":
          return resetFn;
        case "clear":
          return clearFn;
        case "isActive":
          return isFilterActive(fs, kernel.nodes.nodeState);
        case "activeCount":
          return filterActiveCount(fs, kernel.nodes.nodeState);
        case "isPending":
          return fs.pendingTimer !== null;
      }

      const rt = fs.fields.get(key);
      if (!rt) return undefined;
      const fieldProxy = kernel.proxyBuilder.build(rt.node) as object;
      return rt.isDerived ? wrapDerived(key, fieldProxy) : fieldProxy;
    },

    set(_target, key: string | symbol, _value: unknown) {
      // Direct assignment goes through the field proxy: filter.brand.value = x.
      throw new Error(
        `[palistor] cannot assign to list.filter.${String(key)} — write through the ` +
          `field proxy (filter.${String(key)}.value = …) or filter.set({ … }).`,
      );
    },

    ownKeys() {
      return ownKeys;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!ownKeys.includes(key)) return undefined;
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  kernel.nodes.listProxyCache.set(fs as unknown as object, proxy);
  return proxy;
}
