// ─────────────────────────────────────────────────────────────────────────────
// Resolve: one mechanism for information and for cubes. Leaf → the result
// becomes the value, group → it patches the children, list → it becomes the
// items. Dependencies are whatever the run read, through a values object
// bound to the run's own observer: reads after an `await` count too.
//
// An entity cube (a list item's field, a per-entity list) shares its state
// with every view of the same row: store keyed these per (entityId, config).
// ─────────────────────────────────────────────────────────────────────────────

import type { ResolveConfig, Values } from "./config";
import type { Cube } from "./cube";
import type { Hub } from "./hub";
import type { ListCube } from "./listCube";
import { Observer, observe, untracked, type Source } from "./track";

export type ResolveStatus = "idle" | "pending" | "resolved" | "error";

/**
 * Automatic restarts in a row before a resolve is treated as a dependency
 * cycle. Automatic: nothing outside a resolve changed since the run started
 * (hub.userEpoch), so another resolve's result moved what this one read.
 */
const MAX_AUTO_RUNS = 20;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What a cube's `rs` is: a ResolveState, or the Pager of a paginated list (pagination.ts). */
export interface Resolving {
  readonly status: ResolveStatus;
  readonly error: unknown;
  readonly promise: Promise<unknown> | null;
  readonly lazy: boolean;
  /** First read of a lazy resolve. */
  touch(): void;
  start(): void;
  /** list.reload() and the like: run again now. */
  reload(): void;
  /** An outside request for fresh data (the list filter's gate). */
  invalidate(): void;
  /** After every notification cycle. */
  checkDeps(): void;
  dispose(): void;
  /** The cube left the tree; true when no view is left. */
  detach(cube: Cube): boolean;
}

export class ResolveState implements Resolving {
  status: ResolveStatus = "idle";
  error: unknown = null;
  promise: Promise<unknown> | null = null;
  /** The cubes showing this resolve (one, or every view of an entity's row). */
  private readonly cubes = new Set<Cube>();
  private primary: Cube;
  private deps = new Map<Source, number>();
  private scheduled = false;
  private run_: object | null = null;
  private autoRuns = 0;
  /** hub.userEpoch when the last run started. */
  private epoch = 0;
  /** contextDeps not met: idle until setContext brings them (store queued the entry). */
  private waiting = false;
  /** invalidate() during a run: start again once it lands. */
  private rerun = false;

  constructor(cube: Cube, readonly config: ResolveConfig) {
    this.primary = cube;
    this.cubes.add(cube);
  }

  get cube(): Cube { return this.primary; }

  get lazy() { return this.config.options?.lazy !== false; }

  attach(cube: Cube) {
    this.cubes.add(cube);
    if (this.run_ === DISPOSED) this.run_ = null;
  }

  /** The cube left the tree. Returns true when no view is left. */
  detach(cube: Cube): boolean {
    this.cubes.delete(cube);
    if (this.primary === cube && this.cubes.size) this.primary = this.cubes.values().next().value!;
    return this.cubes.size === 0;
  }

  private bump() { for (const c of this.cubes) c.bump(); }

  /**
   * First read of a lazy resolve: start it on the next microtask (never inside
   * a render). An entity field whose row already carries a value other than
   * the template default is treated as resolved (store: skipIfResolved).
   */
  touch() {
    if (this.status !== "idle" || this.scheduled || this.waiting || !this.lazy) return;
    const c = this.primary;
    if (c.item && c.kind === "leaf" && (this.config.options?.skipIfResolved ?? true)) {
      const v = c.peek();
      if (v != null && v !== c.config.value) { this.status = "resolved"; return; }
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.status === "idle" && this.run_ !== DISPOSED) this.start();
    });
  }

  reload() {
    this.autoRuns = 0;
    if (this.status !== "pending") this.start();
  }

  /**
   * An outside request for fresh data (a list filter's server key moved): run
   * now, or right after the run in flight. User-driven, so it is not counted
   * against the restart cap (store counted it and went silent after 10 searches).
   */
  invalidate() {
    if (this.status === "pending") this.rerun = true;
    else this.start();
  }

  /**
   * After every notification cycle (and setContext): restart when something
   * the last run read has moved; a waiting resolve starts once its contextDeps
   * are met.
   */
  checkDeps() {
    if (this.waiting) {
      if (this.contextReady()) this.start();
      return;
    }
    if (this.status !== "resolved" && this.status !== "error") return;
    for (const [s, v] of this.deps) {
      if (s.version === v) continue;
      if (this.mayRestart()) this.start();
      return;
    }
  }

  /**
   * A restart after a change from outside a resolve follows the user and
   * starts the count over (store counted every restart, so a field the
   * resolver read went silent after 10 edits). One with no such change since
   * the run started is counted; over the cap the resolve keeps its last result,
   * re-armed on the current versions, until the next outside change.
   */
  private mayRestart(): boolean {
    if (this.primary.hub.userEpoch !== this.epoch) this.autoRuns = 0;
    if (++this.autoRuns <= MAX_AUTO_RUNS) return true;
    if (this.autoRuns === MAX_AUTO_RUNS + 1) {
      console.warn("[palistor/cube] resolve restarted too many times in a row, stopping (dependency cycle?)", this.primary.path);
    }
    this.deps = new Map([...this.deps.keys()].map((s) => [s, s.version]));
    return false;
  }

  /** contextDeps: every key non-null (store: isContextSatisfied). An entity cube never waits, as in store. */
  private contextReady(): boolean {
    const keys = this.config.contextDeps;
    if (!keys || keys.length === 0 || this.primary.item) return true;
    const ctx = this.primary.hub.context;
    return keys.every((k) => ctx[k] != null);
  }

  /** contextDeps not met: the resolve goes idle (its last result stays) and waits. */
  private park() {
    this.waiting = true;
    if (this.status === "idle") return;
    this.run_ = {};
    this.status = "idle";
    this.error = null;
    this.promise = null;
    this.primary.hub.resolveBatch(() => this.bump());
  }

  /** The cube left the tree (entity deleted): drop in-flight results. */
  dispose() { this.run_ = DISPOSED; }

  /** Full-form reset: back to idle, an in-flight run is dropped, the next read starts over. */
  reset() {
    this.run_ = {};
    this.status = "idle";
    this.error = null;
    this.promise = null;
    this.deps.clear();
    this.autoRuns = 0;
    this.waiting = false;
    this.rerun = false;
    this.bump();
  }

  start() {
    const { primary: cube, config } = this;
    const hub = cube.hub;
    if (!this.contextReady()) { this.park(); return; }
    this.waiting = false;
    this.epoch = hub.userEpoch;
    const run = {};
    this.run_ = run;
    this.rerun = false;
    this.status = "pending";
    this.error = null;
    // A list resolve has no optimistic placeholder and no retry, as in store.
    const optimistic = cube.kind === "list" ? undefined : config.optimisticResolver;
    hub.resolveBatch(() => {
      this.bump();
      if (!optimistic) return;
      try {
        const r = untracked(() => optimistic((cube.item ?? hub.root).values));
        if (r !== undefined) cube.applyResolved(r, false);
      } catch (e) {
        console.warn("Error in optimistic resolver:", e);
      }
    });
    this.promise = this.execute(run);
  }

  private async execute(run: object): Promise<unknown> {
    const { primary: cube, config } = this;
    const hub = cube.hub;
    const attempts = cube.kind === "list" ? 0 : config.options?.retry?.attempts ?? 0;
    const delay = config.options?.retry?.delay ?? 1000;
    /** An entity cube's resolver sees its row (store: the entity's flat values), the rest see the form. */
    const base = cube.item ?? hub.root;
    let lastError: unknown;
    let obs = new Observer();

    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (attempt > 0) {
        await sleep(delay);
        if (this.run_ !== run) return;
      }
      obs = new Observer();
      for (const p of config.deps ?? []) {
        const dep = base.find(p);
        if (dep) observe(obs, () => dep.value);
      }
      const writes: Array<[Cube, unknown]> = [];
      try {
        const values = bindValues(base, obs, writes, base !== hub.root);
        const store = storeFor(hub, obs);
        const result = await untracked(() =>
          cube.kind === "list" ? config.resolver(values, store, (cube as ListCube).resolveContext()) : config.resolver(values, store),
        );
        if (this.run_ !== run) return result;
        // Changed while in flight: decided before our own result moves anything.
        const drift = obs.changed();
        const rerun = this.rerun;
        hub.resolveBatch(() => {
          if (result !== undefined) cube.applyResolved(result, true);
          for (const [target, v] of writes) target.assign(v);
          this.status = "resolved";
          this.bump();
          this.settle(obs); // before the batch notifies: checkDeps must not see our own result as a change
        });
        if (rerun || (drift && this.mayRestart())) this.start();
        return result;
      } catch (e) {
        lastError = e;
      }
    }

    if (this.run_ !== run) return;
    const drift = obs.changed();
    const rerun = this.rerun;
    this.error = lastError;
    try { config.onError?.(lastError, { notify: hub.notify }); } catch { /* onError must not break the store */ }
    hub.resolveBatch(() => { this.status = "error"; this.bump(); this.settle(obs); });
    if (rerun || (drift && this.mayRestart())) this.start();
    return undefined;
  }

  /** The next restart compares against the state after this run applied its result. */
  private settle(obs: Observer) {
    this.deps = new Map([...obs.deps.keys()].map((s) => [s, s.version]));
  }
}

const DISPOSED = {};

/**
 * The resolver's `values`: the base group's values tree, each read recorded on
 * the run's observer (before and after any await), each write buffered and
 * applied together with the result. An entity's tree skips its lists (store:
 * the owner's flat snapshot).
 */
function bindValues(group: Cube, obs: Observer, writes: Array<[Cube, unknown]>, skipLists: boolean): Values {
  const out: Values = {};
  if (group.entityId !== undefined) {
    Object.defineProperty(out, "id", { enumerable: true, configurable: true, get: () => observe(obs, () => group.idValue()) });
  }
  for (const [k, child] of group.children) {
    if (skipLists && child.kind === "list") continue;
    let nested: Values | undefined;
    Object.defineProperty(out, k, {
      enumerable: true,
      configurable: true,
      get: () => {
        if (child.kind !== "group") return observe(obs, () => child.snapshotValue());
        return (nested ??= bindValues(child, obs, writes, skipLists));
      },
      set: (v) => { writes.push([child, v]); },
    });
  }
  return out;
}

/** The `store` argument: the facade with `context` frozen to this run and tracked per key. */
function storeFor(hub: Hub, obs: Observer): unknown {
  const ctx = hub.context;
  const context = new Proxy(ctx, {
    get(target, key) {
      if (typeof key === "string") obs.add(hub.contextKey(key));
      return Reflect.get(target, key);
    },
  });
  return Object.create(hub.store as object, { context: { value: context } });
}
