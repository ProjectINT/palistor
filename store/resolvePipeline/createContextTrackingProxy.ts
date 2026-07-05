/**
 * createContextTrackingProxy — wraps the flat context object in a read-only
 * Proxy that records the keys the resolver accessed.
 *
 * Used in executeResolve to detect context dependencies automatically:
 * when a resolver reads `store.context.accountId`, `$context.accountId` is
 * added to the auto-deps, and the resolver re-runs when that key changes via
 * `setContext`.
 */

export interface ContextTrackingResult {
  /** Proxy over the context — handed to the resolver inside storeProxy */
  proxy: Record<string, unknown>;
  /** Context keys the resolver accessed */
  getAccessedKeys: () => Set<string>;
}

export function createContextTrackingProxy(
  context: Record<string, unknown>,
): ContextTrackingResult {
  const accessedKeys = new Set<string>();

  const proxy = new Proxy(context, {
    get(_target, key) {
      // Skip symbol keys (e.g. Symbol.toPrimitive, Symbol.iterator)
      if (typeof key === "symbol") return Reflect.get(context, key);
      accessedKeys.add(key as string);
      return context[key as string];
    },
    set() {
      // Context is read-only inside resolvers
      throw new TypeError("store.context is read-only inside a resolver");
    },
  });

  return {
    proxy,
    getAccessedKeys: () => accessedKeys,
  };
}
