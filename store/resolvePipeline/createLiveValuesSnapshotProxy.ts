/**
 * createLiveValuesSnapshotProxy — a copy-on-read tracking proxy over the LIVE
 * values tree (`valuesCache.values`), used only by the paged list executor.
 *
 * The legacy executors hand the resolver a tracking proxy over a
 * `structuredClone` of the whole tree. For a paginated list that clone is
 * quadratic over a session (every page fetch clones every loaded page —
 * twice). This proxy instead:
 *
 *   1. deep-copies a value at FIRST access, caches the copy per path, and
 *      serves the cached copy on re-reads — repeatable reads across an internal
 *      `await`, and mutation containment (`values.tags.push(x)` mutates the
 *      copy, never the store). The copies MUST be deep: projection POJOs mutate
 *      in place, so a reference "snapshot" would compare equal to the live
 *      tree forever and blind the drift check;
 *   2. blocks mutation: `set` / `deleteProperty` / `defineProperty` never reach
 *      the live target;
 *   3. reports the accessed paths + their snapshots, so the executor's drift
 *      check is "snapshot-at-access vs live-at-completion" per path.
 *
 * Cost: O(Σ accessed subtrees) per fetch instead of O(tree) × 2.
 */

export interface LiveValuesSnapshotResult {
  proxy: Record<string, unknown>;
  /** Every leaf/array path the resolver read. */
  getAccessedPaths: () => Set<string>;
  /** The deep copy taken at first access of `path`. */
  getSnapshot: (path: string) => unknown;
}

export interface LiveValuesSnapshotOptions {
  /** Root keys hidden from the resolver (e.g. `$filters`). */
  hiddenRootKeys?: string[];
  /** The list's own slot path — a read of it (or below it) calls `onSelfRead`. */
  selfPath?: string;
  onSelfRead?: () => void;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

function deepCopy<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  try {
    return structuredClone(v);
  } catch {
    // Non-cloneable (functions inside values) — fall back to the reference.
    return v;
  }
}

export function createLiveValuesSnapshotProxy(
  live: Record<string, unknown>,
  options: LiveValuesSnapshotOptions = {},
): LiveValuesSnapshotResult {
  const hidden = new Set(options.hiddenRootKeys ?? []);
  const { selfPath, onSelfRead } = options;
  const accessedPaths = new Set<string>();
  const snapshots = new Map<string, unknown>();
  const proxyCache = new Map<string, Record<string, unknown>>();
  let selfWarned = false;

  const noteSelfRead = (path: string): void => {
    if (selfWarned || !selfPath || !onSelfRead) return;
    if (path === selfPath || path.startsWith(selfPath + ".")) {
      selfWarned = true;
      onSelfRead();
    }
  };

  function build(target: Record<string, unknown>, parentPath: string): Record<string, unknown> {
    const cacheKey = parentPath || "__root__";
    const cached = proxyCache.get(cacheKey);
    if (cached) return cached;

    const isRoot = parentPath === "";
    const p = new Proxy(target, {
      get(_t, key: string | symbol) {
        if (typeof key === "symbol") return undefined;
        if (isRoot && hidden.has(key)) return undefined;
        const fullPath = parentPath ? `${parentPath}.${key}` : key;
        const val = target[key];
        if (isPlainObject(val)) return build(val, fullPath);
        // Leaf / array: copy-on-first-read, cached per path.
        noteSelfRead(fullPath);
        accessedPaths.add(fullPath);
        if (!snapshots.has(fullPath)) snapshots.set(fullPath, deepCopy(val));
        return snapshots.get(fullPath);
      },
      set() {
        // Contained: the live tree is never written through this proxy.
        return true;
      },
      deleteProperty() {
        return true;
      },
      defineProperty() {
        return true;
      },
      has(_t, key) {
        if (typeof key === "symbol") return false;
        if (isRoot && hidden.has(key)) return false;
        return key in target;
      },
      ownKeys() {
        const keys = Reflect.ownKeys(target);
        return isRoot ? keys.filter((k) => typeof k === "symbol" || !hidden.has(k)) : keys;
      },
      getOwnPropertyDescriptor(_t, key) {
        if (typeof key === "string" && isRoot && hidden.has(key)) return undefined;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    proxyCache.set(cacheKey, p);
    return p;
  }

  return {
    proxy: build(live, ""),
    getAccessedPaths: () => accessedPaths,
    getSnapshot: (path) => snapshots.get(path),
  };
}
