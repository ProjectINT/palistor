import type { NotifyFn, Translate } from "./config";
import type { Cube } from "./cube";
import { Registry } from "./registry";
import { Signal } from "./track";

const identity: Translate = (k) => k;

/**
 * Root services shared by every cube of one store: change batching and the
 * notification cycle, subscriptions, the translator, the non-reactive context
 * (with per-key signals for resolvers), the entity registry and the cubes
 * that carry a resolve.
 */
export class Hub {
  root!: Cube;
  /** The facade passed to onSubmit / resolvers as `store`. */
  store: unknown = null;

  /** Notification cycles so far: store.getVersion(). */
  cycle = 0;
  private depth = 0;
  private dirty = false;
  private flushing = false;

  readonly listeners = new Set<() => void>();
  /** store.subscribe(configNode): the cube and the state version its listeners last saw. */
  private readonly watched = new Map<Cube, { seen: number; fns: Set<() => void> }>();
  /** Config object → its cube (root tree only; list items share a template). */
  readonly byConfig = new WeakMap<object, Cube>();
  readonly resolving = new Set<Cube>();
  readonly registry = new Registry();
  /** State-version sequence, so versions of different cubes never repeat. */
  stateSeq = 0;

  t: Translate = identity;
  readonly translator = new Signal();
  notifier: NotifyFn | null = null;
  readonly notify: NotifyFn = (...args) => this.notifier?.(...args);

  context: Record<string, unknown> = {};
  private readonly contextKeys = new Map<string, Signal>();

  /** Marks the current batch as changing something. Called by every bump. */
  touch() { this.dirty = true; }

  /** Runs fn as one change: subscribers are notified once, after it returns. */
  batch<T>(fn: () => T): T {
    this.depth++;
    try {
      return fn();
    } finally {
      if (--this.depth === 0 && this.dirty) this.flush();
    }
  }

  /** Construction is not a change: drop whatever it bumped. */
  settle() { this.dirty = false; }

  private flush() {
    if (this.flushing) return; // a write from a listener: the loop below picks it up
    this.flushing = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        this.cycle++;
        for (const [cube, w] of this.watched) {
          const v = cube.stateVersion();
          if (v !== w.seen) { w.seen = v; w.fns.forEach((fn) => fn()); }
        }
        this.listeners.forEach((fn) => fn());
        for (const c of this.resolving) c.rs!.checkDeps();
      }
    } finally {
      this.flushing = false;
    }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  watch(cube: Cube, fn: () => void) {
    let w = this.watched.get(cube);
    if (!w) this.watched.set(cube, (w = { seen: cube.stateVersion(), fns: new Set() }));
    w.fns.add(fn);
    return () => {
      w!.fns.delete(fn);
      if (w!.fns.size === 0) this.watched.delete(cube);
    };
  }

  /** Returns false when nothing changed (same translator). */
  setTranslator(t: Translate | null): boolean {
    const next = t ?? identity;
    if (next === this.t) return false;
    this.t = next;
    this.batch(() => { this.translator.bump(); this.touch(); });
    return true;
  }

  contextKey(key: string): Signal {
    let s = this.contextKeys.get(key);
    if (!s) this.contextKeys.set(key, (s = new Signal()));
    return s;
  }

  /** Not a notification (store does not notify on setContext): only resolvers re-run. */
  setContext(ctx: Record<string, unknown>) {
    const changed = Object.keys(ctx).filter((k) => this.context[k] !== ctx[k]);
    this.context = { ...this.context, ...ctx };
    if (changed.length === 0) return;
    for (const k of changed) this.contextKey(k).bump();
    for (const c of this.resolving) c.rs!.checkDeps();
  }
}
