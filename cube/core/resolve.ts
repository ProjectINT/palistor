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
import { Observer, observe, untracked, type Source } from "./track";

export type ResolveStatus = "idle" | "pending" | "resolved" | "error";

/** Automatic restarts in a row before a resolve is treated as a dependency cycle. */
const MAX_AUTO_RUNS = 20;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ResolveState {
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
    if (this.status !== "idle" || this.scheduled || !this.lazy) return;
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

  /** After every notification cycle: restart when something the last run read has moved. */
  checkDeps() {
    if (this.status !== "resolved" && this.status !== "error") return;
    for (const [s, v] of this.deps) {
      if (s.version === v) continue;
      if (++this.autoRuns > MAX_AUTO_RUNS) {
        console.warn("[palistor/cube] resolve restarted too many times in a row, stopping (dependency cycle?)", this.primary.path);
        this.deps.clear();
        return;
      }
      this.start();
      return;
    }
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
    this.bump();
  }

  start() {
    const { primary: cube, config } = this;
    const hub = cube.hub;
    const run = {};
    this.run_ = run;
    this.status = "pending";
    this.error = null;
    hub.batch(() => {
      this.bump();
      if (!config.optimisticResolver) return;
      try {
        const r = untracked(() => config.optimisticResolver!((cube.item ?? hub.root).values));
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
    const attempts = config.options?.retry?.attempts ?? 0;
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
          cube.kind === "list" ? config.resolver(values, store, listContext()) : config.resolver(values, store),
        );
        if (this.run_ !== run) return result;
        // Changed while in flight: decided before our own result moves anything.
        const stale = obs.changed();
        hub.batch(() => {
          if (result !== undefined) cube.applyResolved(result, true);
          for (const [target, v] of writes) target.assign(v);
          this.status = "resolved";
          this.bump();
          this.settle(obs); // before the batch notifies: checkDeps must not see our own result as a change
        });
        if (stale) this.start();
        return result;
      } catch (e) {
        lastError = e;
      }
    }

    if (this.run_ !== run) return;
    const stale = obs.changed();
    this.error = lastError;
    try { config.onError?.(lastError, { notify: hub.notify }); } catch { /* onError must not break the store */ }
    hub.batch(() => { this.status = "error"; this.bump(); this.settle(obs); });
    if (stale) this.start();
    return undefined;
  }

  /** The next restart compares against the state after this run applied its result. */
  private settle(obs: Observer) {
    this.deps = new Map([...obs.deps.keys()].map((s) => [s, s.version]));
  }
}

const DISPOSED = {};

/** store: the third list-resolver argument, always present (the filter block is Phase 2.3). */
function listContext() {
  return { filter: { values: {}, params: undefined, key: "" }, queryKey: "" };
}

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
