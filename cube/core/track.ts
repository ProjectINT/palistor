// ─────────────────────────────────────────────────────────────────────────────
// Reactive core: ONE mechanism for everything.
// Anything that can change is a Source with a version. Whoever reads it calls
// track(source); the current Observer records the version it saw. A memo, a
// resolve run or a signature is fresh while every recorded version still
// matches. That replaces groupDeps, dependencies, topologicalSort, recompute*
// and the values tracking proxies of store/.
// ─────────────────────────────────────────────────────────────────────────────

/** A cube, a list, the translator, a context key: anything with a version. */
export interface Source {
  version: number;
}

/** A standalone versioned value (translator, context keys). */
export class Signal implements Source {
  version = 0;
  bump() { this.version++; }
}

export class Observer {
  /** source → version at the first read. */
  readonly deps = new Map<Source, number>();

  add(s: Source) {
    if (!this.deps.has(s)) this.deps.set(s, s.version);
  }

  /** At least one source moved since it was read. */
  changed(): boolean {
    for (const [s, v] of this.deps) if (s.version !== v) return true;
    return false;
  }
}

let current: Observer | null = null;

export const track = (s: Source) => { current?.add(s); };

export function observe<T>(obs: Observer | null, fn: () => T): T {
  const prev = current;
  current = obs;
  try { return fn(); } finally { current = prev; }
}

/** Reads inside fn are invisible to the observer around the call. */
export const untracked = <T>(fn: () => T): T => observe(null, fn);
