/**
 * createValuesTrackingProxy — wraps the values tree in a Proxy that:
 *   - READS: tracks accessed paths (automatic dependencies for resolver re-runs)
 *   - WRITES: buffers side effects (batch mode, no intermediate re-renders)
 *
 * Used inside resolver execution: the resolver receives this proxy instead of
 * the real object. After the resolver finishes, the accessed paths are stored
 * for dependency tracking and the buffered writes are flushed in one batch.
 *
 * ─── HOW IT WORKS ────────────────────────────────────────────────────────────
 *
 * The values tree looks like a regular nested object:
 *   { user: { name: "Alice", vehicleExists: true }, payment: { amount: 100 } }
 *
 * When the resolver runs, it receives this proxy instead of the real object.
 * The proxy intercepts every property access:
 *
 *   READ:  values.user.name
 *     → the proxy returns a nested proxy for "user"
 *     → the nested proxy intercepts "name", records the path "user.name" in accessedPaths
 *     → returns the real value
 *
 *   WRITE: values.user.vehicleExists = false
 *     → the proxy intercepts the assignment, records { path: "user.vehicleExists", value: false }
 *       into pendingWrites[]
 *     → the real values object is NOT touched — the write is deferred!
 *
 * After the resolver returns:
 *   1. getAccessedPaths() → used to rebuild this resolver's dependency graph
 *      (the resolver re-runs the next time any of these paths changes)
 *   2. getPendingWrites() → passed to applyPendingWrites(), which turns each
 *      path back into a nested patch and calls applyPatch() on the real store
 *
 * WHY BUFFER WRITES instead of applying immediately?
 *   - Prevents cascading re-renders in the middle of a resolver run
 *   - All mutations are applied in one atomic batch → consistent state after every pipeline tick
 *   - Resolver A's writes don't accidentally trigger resolver B mid-run
 */

export interface PendingWrite {
  /**
   * Dot-separated path in the values tree, e.g. "user.vehicleExists" or "payment.amount".
   * Mirrors the structure of the values object (like valuesCache.values).
   * applyPendingWrites() splits this path on "." to build a nested patch object.
   */
  path: string;
  /** The new value the resolver wants to write at this path. */
  value: unknown;
}

export interface ValuesTrackingResult {
  /** Writable tracking proxy handed to the resolver. Reads are tracked, writes buffered. */
  proxy: Record<string, unknown>;
  /**
   * Returns all (dot-separated) paths that were READ during the resolver run.
   * Used after the resolver returns to update the dependency graph:
   * the resolver re-runs when any of these paths changes.
   */
  getAccessedPaths: () => Set<string>;
  /**
   * Returns all write operations buffered during the resolver run.
   * None of these writes has been applied to the real store yet —
   * they are flushed in one batch via applyPendingWrites() after the resolver returns.
   */
  getPendingWrites: () => PendingWrite[];
}

/**
 * Creates a writable tracking proxy for the values tree.
 *
 * - Reading a primitive records the full path (e.g. "user.id") in accessedPaths
 * - Reading an object returns a nested proxy (recursively); not tracked until a leaf is read
 * - Writing to ANY path buffers the assignment in pendingWrites[] without touching real data
 *
 * @param values — current values snapshot (from valuesCache.values), treated as read-only here
 */
export function createValuesTrackingProxy(
  values: Record<string, unknown>,
): ValuesTrackingResult {
  // Collects every primitive path the resolver reads.
  // Example after a resolver run: Set { "user.name", "user.vehicleExists" }
  const accessedPaths = new Set<string>();

  // Collects every write the resolver performs, in order of appearance.
  // None is applied until applyPendingWrites() runs after the resolver returns.
  // Example: [{ path: "user.vehicleExists", value: false }, { path: "payment.amount", value: 200 }]
  const pendingWrites: PendingWrite[] = [];

  // Caches nested proxies by their path prefix so repeated access to the same
  // nested object returns the same proxy instance.
  // Key: dot-separated path prefix (e.g. "user"), or "__root__" for the root level.
  const proxyCache = new Map<string, unknown>();

  /**
   * Recursively wraps `target` in a Proxy that tracks reads and buffers writes.
   *
   * @param target     — the real values object (or nested sub-object) to wrap
   * @param parentPath — accumulated dot-path prefix, e.g. "" for the root or "user" for a nested one
   */
  function buildValuesProxy(target: Record<string, unknown>, parentPath: string): Record<string, unknown> {
    // Return the cached proxy for this path so we don't create duplicate
    // proxies for one node (matters for referential equality checks inside resolvers).
    const cacheKey = parentPath || "__root__";
    if (proxyCache.has(cacheKey)) return proxyCache.get(cacheKey) as Record<string, unknown>;

    const p = new Proxy(target, {
      // ─── GET trap ─────────────────────────────────────────────────────────
      // Intercepts every property read. Builds the full dot-path, then:
      //   • nested plain object → returns a nested proxy
      //     (intermediate paths are not tracked, only leaf reads)
      //   • primitive → records the path in accessedPaths and returns it
      get(_t, key: string | symbol) {
        // Ignore symbol keys (e.g. Symbol.toPrimitive, Symbol.iterator) —
        // framework/runtime internals, not part of the values tree.
        if (typeof key === "symbol") return undefined;

        // Full dot-path for this access, e.g. "user" + "." + "name" = "user.name"
        const fullPath = parentPath ? `${parentPath}.${key}` : key;
        const val = target[key];

        // Plain objects are wrapped in another proxy to keep tracking deeper
        // reads, e.g. values.user.address.city.
        // Arrays and Dates are treated as leaf values (no recursion).
        if (val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
          return buildValuesProxy(val as Record<string, unknown>, fullPath);
        }

        // Leaf read — record the path so the resolver can be re-triggered
        // later when this specific value changes in the store.
        accessedPaths.add(fullPath);
        return val;
      },

      // ─── SET trap ─────────────────────────────────────────────────────────
      // Intercepts every assignment. Instead of mutating the real values
      // object, pushes a PendingWrite descriptor into the buffer.
      //
      // Writes are deliberately deferred:
      //   1. A resolver may perform several writes in a row; collect them all first.
      //   2. applyPendingWrites() runs after the resolver returns, so all
      //      mutations are applied atomically in a single applyPatch() call.
      //   3. The resolver cannot observe its own partially applied writes.
      set(_t, key: string | symbol, newValue: unknown) {
        if (typeof key === "symbol") return false;

        const fullPath = parentPath ? `${parentPath}.${key}` : key;
        // Buffer the write — the real store is untouched for now.
        pendingWrites.push({ path: fullPath, value: newValue });
        // Returning true tells the Proxy the assignment was "accepted"
        // (prevents a strict-mode TypeError despite no real mutation happening).
        return true;
      },
    });

    proxyCache.set(cacheKey, p);
    return p as Record<string, unknown>;
  }

  // Build the root-level proxy (parentPath = "" means no prefix).
  const proxy = buildValuesProxy(values, "");

  return {
    proxy,
    getAccessedPaths: () => accessedPaths,
    getPendingWrites: () => pendingWrites,
  };
}
