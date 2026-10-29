import type { Cube } from "./cube";
import { observe, track, type Observer } from "./track";

/**
 * Lazy memo: recomputes only when the version of at least one dependency has
 * moved. This is the replacement for recompute / recomputeTargeted /
 * groupDepsMap: nobody "recomputes the tree", every getter knows on its own
 * whether it is stale.
 */
export class Memo<T> {
  private deps = new Map<Cube, number>();
  private cached!: T;
  private valid = false;

  constructor(private readonly fn: () => T) {}

  get(): T {
    if (this.valid && [...this.deps].every(([c, v]) => c.version === v)) {
      this.deps.forEach((_, c) => track(c)); // forward the dependencies to the observer above
      return this.cached;
    }
    const obs: Observer = { deps: new Set() };
    this.cached = observe(obs, this.fn);
    this.deps = new Map([...obs.deps].map((c) => [c, c.version]));
    obs.deps.forEach(track);
    this.valid = true;
    return this.cached;
  }
}
