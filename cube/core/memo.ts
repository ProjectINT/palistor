import { Observer, observe, track, type Source } from "./track";

/**
 * Lazy memo: recomputes only when the version of at least one dependency has
 * moved. Nobody "recomputes the tree": every getter knows on its own whether
 * it is stale. Its dependencies are forwarded to the observer above, so a
 * memo reading a memo depends on the leaves directly.
 */
export class Memo<T> {
  private deps: Map<Source, number> | null = null;
  private cached!: T;
  private computing = false;

  constructor(private readonly fn: () => T) {}

  get(): T {
    if (this.deps !== null && !stale(this.deps)) {
      for (const s of this.deps.keys()) track(s);
      return this.cached;
    }
    if (this.computing) throw new Error("palistor/cube: computed cycle (a computed value reads itself)");
    const obs = new Observer();
    this.computing = true;
    try {
      this.cached = observe(obs, this.fn);
    } finally {
      this.computing = false;
    }
    this.deps = obs.deps;
    for (const s of obs.deps.keys()) track(s);
    return this.cached;
  }
}

function stale(deps: Map<Source, number>) {
  for (const [s, v] of deps) if (s.version !== v) return true;
  return false;
}
