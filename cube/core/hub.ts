import type { CubeConfig, NotifyFn, ResolveConfig, Translate, Values } from "./config";
import { Cube } from "./cube";
import type { ListCube } from "./listCube";
import { idOf, Registry } from "./registry";
import { ResolveState } from "./resolve";
import { Signal } from "./track";

const identity: Translate = (k) => k;

/**
 * Root services shared by every cube of one store: change batching and the
 * notification cycle, subscriptions, the translator, the non-reactive context
 * (with per-key signals for resolvers), the entity registry with the store's
 * entity operations, the resolves to re-check after a cycle, and the cubes a
 * row is shown through.
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
  /** Every resolve whose dependencies are re-checked after a notification cycle. */
  readonly resolving = new Set<ResolveState>();
  /** Every list alive: root lists and the per-entity lists of built items. */
  readonly lists = new Set<ListCube>();
  readonly registry = new Registry();
  /**
   * Resolve state of an entity cube, per (entity id, config node), shared by
   * every view of that row (store: EntityResolveStateMap). Lives until the
   * entity is deleted or the form is reset.
   */
  private readonly entityResolves = new Map<string, Map<object, ResolveState>>();
  /** useForm(entity, template): one view cube per (entity id, template), stable across mounts. */
  private readonly entityViews = new Map<string, Map<CubeConfig, Cube>>();
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
        for (const rs of this.resolving) rs.checkDeps();
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
    for (const rs of this.resolving) rs.checkDeps();
  }

  // ── entities (store.set / delete / rekey) ──────────────────────────────────

  /** Upserts rows (a row without an id gets a `_tmp_` one); one notification. Returns the ids. */
  setRows(rows: Values[]): string[] {
    return this.batch(() =>
      rows.map((r) => {
        const id = idOf(r);
        if (this.registry.set({ ...r, id })) this.touch();
        return id;
      }),
    );
  }

  /**
   * store.delete: the entity's children (per-entity lists) go first, then the
   * id leaves every list, its resolve states and views are released, and the
   * row is removed. No-op (no notification) for an unknown id.
   */
  deleteEntity(id: string): boolean {
    if (!this.registry.has(id)) return false;
    this.batch(() => {
      for (const child of [...(this.registry.getChildrenByOwner(id) ?? [])]) this.deleteEntity(child);
      for (const list of this.lists) list.removeId(id);
      const resolves = this.entityResolves.get(id);
      if (resolves) {
        for (const rs of resolves.values()) { rs.dispose(); this.resolving.delete(rs); }
        this.entityResolves.delete(id);
      }
      const views = this.entityViews.get(id);
      if (views) {
        for (const v of views.values()) v.dispose();
        this.entityViews.delete(id);
      }
      for (const v of this.registry.delete(id)) v.bumpDeep(); // a mounted useForm(entity) view re-renders on defaults
      this.touch();
    });
    return true;
  }

  /** store.rekey: the row moves to a new id everywhere it is referenced; every view re-renders. */
  rekeyEntity(oldId: string, newId: string): void {
    if (!this.registry.has(oldId)) return;
    this.batch(() => {
      const views = this.registry.rekey(oldId, newId);
      for (const list of this.lists) list.rekeyId(oldId, newId);
      moveKey(this.entityResolves, oldId, newId);
      moveKey(this.entityViews, oldId, newId);
      for (const v of views) v.bumpDeep();
      this.touch();
    });
  }

  /** The shared resolve state of an entity cube; `cube` becomes one of its views. */
  entityResolve(id: string, config: object, cube: Cube, resolve: ResolveConfig): ResolveState {
    let byConfig = this.entityResolves.get(id);
    if (!byConfig) this.entityResolves.set(id, (byConfig = new Map()));
    let rs = byConfig.get(config);
    if (!rs) byConfig.set(config, (rs = new ResolveState(cube, resolve)));
    else rs.attach(cube);
    this.resolving.add(rs);
    return rs;
  }

  /** The cube showing `id` through `template` for useForm(entity, template); created once. */
  entityView(id: string, template: CubeConfig): Cube {
    let byTemplate = this.entityViews.get(id);
    if (!byTemplate) this.entityViews.set(id, (byTemplate = new Map()));
    let view = byTemplate.get(template);
    if (!view) {
      view = new Cube(template, null, id, this, id);
      this.registry.attach(id, view);
      byTemplate.set(template, view);
    }
    return view;
  }

  /**
   * Full-form reset (store's resetPipeline on the root): every per-entity
   * list is back to its initial membership, every entity field resolve starts
   * over on its next read. Root lists keep their membership, as in store.
   */
  resetEntities(): void {
    for (const list of this.lists) if (list.item) list.resetMembership();
    for (const byConfig of this.entityResolves.values()) for (const rs of byConfig.values()) rs.reset();
  }
}

function moveKey<V>(map: Map<string, V>, from: string, to: string) {
  const v = map.get(from);
  if (v === undefined) return;
  map.delete(from);
  map.set(to, v);
}
