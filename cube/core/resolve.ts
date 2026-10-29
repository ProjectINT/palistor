// ─────────────────────────────────────────────────────────────────────────────
// Resolve: one mechanism for information and for cubes. Leaf → the result
// becomes the value, group → it patches the children, list → it becomes the
// items. Dependencies are whatever the run read, through a values object
// bound to the run's own observer: reads after an `await` count too.
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
  private deps = new Map<Source, number>();
  private scheduled = false;
  private run_: object | null = null;
  private autoRuns = 0;

  constructor(private readonly cube: Cube, readonly config: ResolveConfig) {}

  get lazy() { return this.config.options?.lazy !== false; }

  /** First read of a lazy resolve: start it on the next microtask (never inside a render). */
  touch() {
    if (this.status !== "idle" || this.scheduled || !this.lazy) return;
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
        console.warn("[palistor/cube] resolve restarted too many times in a row, stopping (dependency cycle?)", this.cube.path);
        this.deps.clear();
        return;
      }
      this.start();
      return;
    }
  }

  /** The cube left the tree (list item removed): drop in-flight results. */
  dispose() { this.run_ = DISPOSED; }

  start() {
    const { cube, config } = this;
    const hub = cube.hub;
    const run = {};
    this.run_ = run;
    this.status = "pending";
    this.error = null;
    hub.batch(() => {
      cube.bump();
      if (!config.optimisticResolver) return;
      try {
        const r = untracked(() => config.optimisticResolver!(hub.root.values));
        if (r !== undefined) cube.applyResolved(r, false);
      } catch (e) {
        console.warn("Error in optimistic resolver:", e);
      }
    });
    this.promise = this.execute(run);
  }

  private async execute(run: object): Promise<unknown> {
    const { cube, config } = this;
    const hub = cube.hub;
    const attempts = config.options?.retry?.attempts ?? 0;
    const delay = config.options?.retry?.delay ?? 1000;
    let lastError: unknown;
    let obs = new Observer();

    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (attempt > 0) {
        await sleep(delay);
        if (this.run_ !== run) return;
      }
      obs = new Observer();
      for (const p of config.deps ?? []) {
        const dep = hub.root.find(p);
        if (dep) observe(obs, () => dep.value);
      }
      const writes: Array<[Cube, unknown]> = [];
      try {
        const values = bindValues(hub.root, obs, writes);
        const result = await untracked(() => config.resolver(values, storeFor(hub, obs)));
        if (this.run_ !== run) return result;
        // Changed while in flight: decided before our own result moves anything.
        const stale = obs.changed();
        hub.batch(() => {
          if (result !== undefined) cube.applyResolved(result, true);
          for (const [target, v] of writes) target.assign(v);
          this.status = "resolved";
          cube.bump();
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
    hub.batch(() => { this.status = "error"; cube.bump(); this.settle(obs); });
    if (stale) this.start();
    return undefined;
  }

  /** The next restart compares against the state after this run applied its result. */
  private settle(obs: Observer) {
    this.deps = new Map([...obs.deps.keys()].map((s) => [s, s.version]));
  }
}

const DISPOSED = {};

/**
 * The resolver's `values`: the root values tree, each read recorded on the
 * run's observer (before and after any await), each write buffered and
 * applied together with the result.
 */
function bindValues(group: Cube, obs: Observer, writes: Array<[Cube, unknown]>): Values {
  const out: Values = {};
  for (const [k, child] of group.children) {
    let nested: Values | undefined;
    Object.defineProperty(out, k, {
      enumerable: true,
      get: () => {
        if (child.kind !== "group") return observe(obs, () => child.snapshotValue());
        return (nested ??= bindValues(child, obs, writes));
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
