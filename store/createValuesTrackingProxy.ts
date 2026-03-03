/**
 * createValuesTrackingProxy — wraps the values tree in a Proxy that:
 *   - READ: tracks accessed paths (auto-deps for resolver re-runs)
 *   - WRITE: buffers side-effects (batch mode, no intermediate re-renders)
 *
 * Used inside resolver execution: resolver receives this proxy instead of raw values.
 * After resolver completes, accessed paths are saved for dependency tracking,
 * and buffered writes are flushed in one batch.
 */

export interface PendingWrite {
  /** Dot-separated path in the values tree (e.g. "user.vehicleExists") */
  path: string;
  value: unknown;
}

export interface ValuesTrackingResult {
  /** Tracking write-proxy to pass to resolver */
  proxy: Record<string, unknown>;
  /** Returns all paths that were READ during resolver execution */
  getAccessedPaths: () => Set<string>;
  /** Returns all buffered WRITE operations */
  getPendingWrites: () => PendingWrite[];
}

/**
 * Creates a tracking write-proxy for the values tree.
 *
 * - Reading a primitive records the full dot-path (e.g. "user.id")
 * - Reading an object returns a nested proxy (recursive)
 * - Writing buffers the assignment in pendingWrites[]
 *
 * @param values — current values snapshot (from collectValues)
 */
export function createValuesTrackingProxy(
  values: Record<string, unknown>,
): ValuesTrackingResult {
  const accessedPaths = new Set<string>();
  const pendingWrites: PendingWrite[] = [];
  const proxyCache = new Map<string, unknown>();

  function buildProxy(target: Record<string, unknown>, parentPath: string): Record<string, unknown> {
    const cacheKey = parentPath || "__root__";
    if (proxyCache.has(cacheKey)) return proxyCache.get(cacheKey) as Record<string, unknown>;

    const p = new Proxy(target, {
      get(_t, key: string | symbol) {
        if (typeof key === "symbol") return undefined;

        const fullPath = parentPath ? `${parentPath}.${key}` : key;
        const val = target[key];

        // If the value is a plain object — return nested tracking proxy
        if (val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
          return buildProxy(val as Record<string, unknown>, fullPath);
        }

        // Primitive read — track the path
        accessedPaths.add(fullPath);
        return val;
      },

      set(_t, key: string | symbol, newValue: unknown) {
        if (typeof key === "symbol") return false;

        const fullPath = parentPath ? `${parentPath}.${key}` : key;
        pendingWrites.push({ path: fullPath, value: newValue });
        return true;
      },
    });

    proxyCache.set(cacheKey, p);
    return p as Record<string, unknown>;
  }

  const proxy = buildProxy(values, "");

  return {
    proxy,
    getAccessedPaths: () => accessedPaths,
    getPendingWrites: () => pendingWrites,
  };
}
