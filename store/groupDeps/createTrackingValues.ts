import { pairKey } from "./pairKey";

/**
 * Wrapper for valuesCache.values that intercepts READ accesses
 * and records cross-group dependencies into a Set.
 *
 * When a leaf value is read, the donor group is determined by the current
 * nesting level. If donor ≠ recipient → the donor→recipient pair is recorded.
 *
 * @param values             — flat values object from valuesCache.values
 * @param recipientGroupPath — path of the group currently being computed
 * @param deps               — Set that collects discovered dependencies
 * @param currentGroupPath   — current nesting level in the values tree (starts as "")
 * @param subProxyCache      — WeakMap memoizing sub-proxies within one call
 */
export function createTrackingValues(
  values: Record<string, unknown>,
  recipientGroupPath: string,
  deps: Set<string>,
  currentGroupPath = "",
  subProxyCache: WeakMap<object, Record<string, unknown>> = new WeakMap(),
): Record<string, unknown> {
  return new Proxy(values, {
    get(target, key: string | symbol): unknown {
      if (typeof key === "symbol") return (target as any)[key];

      const val = (target as Record<string, unknown>)[key];

      // Nested object (group) — recursive proxy with memoization
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const cached = subProxyCache.get(val as object);
        if (cached) return cached;
        const childPath = currentGroupPath ? `${currentGroupPath}.${key}` : key;
        const childProxy = createTrackingValues(
          val as Record<string, unknown>,
          recipientGroupPath,
          deps,
          childPath,
          subProxyCache,
        );
        subProxyCache.set(val as object, childProxy);
        return childProxy;
      }

      // Leaf value read: donor = currentGroupPath
      if (currentGroupPath !== recipientGroupPath) {
        deps.add(pairKey(currentGroupPath, recipientGroupPath));
      }

      return val;
    },
  });
}
