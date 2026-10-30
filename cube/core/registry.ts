import { isPlainObject, type Values } from "./config";
import type { Cube } from "./cube";

let tmpSeq = 0;

/** store/entityRegistry/generateId.ts: `_tmp_<time36>_<8 random>_<seq>`. */
export function generateTmpId(): string {
  return `_tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}_${++tmpSeq}`;
}

/** The id a row is stored under: its own when it has one, a fresh `_tmp_` id otherwise. */
export function idOf(row: Values): string {
  const id = row.id;
  return id == null || id === "" ? generateTmpId() : String(id);
}

export interface Owner {
  ownerId: string;
  ownerListNode: object;
}

const MISSING = Symbol("missing");

/** Value at a key path inside a plain tree, MISSING when any step is absent. */
export function getAt(obj: Values | undefined, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isPlainObject(cur) || !(k in cur)) return MISSING;
    cur = cur[k];
  }
  return cur;
}
getAt.MISSING = MISSING;

/** `{ ...base, a: { b: value } }` for the path `["a", "b"]`. */
export function patchAt(base: Values, path: string[], value: unknown): Values {
  const out = { ...base };
  let cur = out;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] = {};
  cur[path[path.length - 1]] = value;
  return out;
}

function clonePlain<T>(v: T): T {
  if (!isPlainObject(v)) return v;
  const out: Values = {};
  for (const k in v) out[k] = clonePlain((v as Values)[k]);
  return out as T;
}

/**
 * Entity registry (one per store): id → row, plus everything store kept next
 * to an entity. One row can be shown through several lists and templates:
 * every view cube reads and writes the same row, and a changed key bumps that
 * key's cube in every view that has built it.
 *
 *   • rows        — the data, merged recursively on `set` (absent keys survive)
 *   • baselines   — the dirty baseline per row: a key is seeded when it first
 *                   appears, moved by a resolve result or a reset
 *   • views       — the cubes showing a row (list items, useForm(entity) views)
 *   • owners      — child → owner for per-entity lists (cascade delete)
 *   • bindings    — templates currently showing an entity (useForm mount)
 *   • resolved    — (entity, template) pairs whose template resolve ran
 */
export class Registry {
  private readonly rows = new Map<string, Values>();
  private readonly baselines = new Map<string, Values>();
  private readonly views = new Map<string, Set<Cube>>();
  private readonly owners = new Map<string, Owner>();
  private readonly childrenByOwner = new Map<string, Set<string>>();
  private readonly bindings = new Map<string, Set<object>>();
  private readonly resolved = new Map<string, Set<object>>();

  // ── rows ───────────────────────────────────────────────────────────────────

  get(id: string): Values | undefined { return this.rows.get(id); }
  has(id: string): boolean { return this.rows.has(id); }
  get size(): number { return this.rows.size; }
  ids(): IterableIterator<string> { return this.rows.keys(); }

  /**
   * Upsert: a new row is stored as given, an existing one is merged key by key
   * (nested plain objects recursively; a key missing from the patch is kept).
   * Returns true when something changed. Changed keys bump the matching cube
   * in every view that has built it.
   */
  set(row: Values): boolean {
    const id = String(row.id);
    const prev = this.rows.get(id);
    if (!prev) {
      const fresh = clonePlain(row);
      fresh.id = id;
      this.rows.set(id, fresh);
      this.baselines.set(id, clonePlain(fresh));
      return true;
    }
    const changed: string[][] = [];
    merge(prev, this.baselines.get(id)!, row, [], changed);
    if (changed.length === 0) return false;
    const views = this.views.get(id);
    if (views) for (const v of views) for (const p of changed) bumpPath(v, p);
    return true;
  }

  /** The dirty baseline of a row. */
  baseline(id: string): Values | undefined { return this.baselines.get(id); }

  /** The value at `path` becomes the row's dirty baseline for that key. */
  setBaseline(id: string, path: string[], value: unknown): void {
    let base = this.baselines.get(id);
    if (!base) this.baselines.set(id, (base = { id }));
    let cur = base;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!isPlainObject(cur[k])) cur[k] = {};
      cur = cur[k] as Values;
    }
    cur[path[path.length - 1]] = value;
  }

  /** Removes the row and everything attached to it. Returns the views that were showing it. */
  delete(id: string): Set<Cube> {
    const views = this.views.get(id) ?? new Set<Cube>();
    this.rows.delete(id);
    this.baselines.delete(id);
    this.views.delete(id);
    this.bindings.delete(id);
    this.resolved.delete(id);
    this.childrenByOwner.delete(id);
    const owner = this.owners.get(id);
    if (owner) {
      this.owners.delete(id);
      this.childrenByOwner.get(owner.ownerId)?.delete(id);
    }
    return views;
  }

  /**
   * Moves a row to a new id: data, baseline, views (their `entityId` follows),
   * ownership links, bindings and the resolved cache. Returns the views so the
   * caller can bump them.
   */
  rekey(oldId: string, newId: string): Set<Cube> {
    const row = this.rows.get(oldId);
    if (!row) return new Set();
    this.rows.delete(oldId);
    row.id = newId;
    this.rows.set(newId, row);
    const base = this.baselines.get(oldId);
    if (base) { this.baselines.delete(oldId); base.id = newId; this.baselines.set(newId, base); }

    const views = this.views.get(oldId) ?? new Set<Cube>();
    this.views.delete(oldId);
    if (views.size) this.views.set(newId, views);
    for (const v of views) v.entityId = newId;

    const owned = this.childrenByOwner.get(oldId);
    if (owned) {
      this.childrenByOwner.delete(oldId);
      this.childrenByOwner.set(newId, owned);
      for (const child of owned) { const o = this.owners.get(child); if (o) o.ownerId = newId; }
    }
    const owner = this.owners.get(oldId);
    if (owner) {
      this.owners.delete(oldId);
      this.owners.set(newId, owner);
      const set = this.childrenByOwner.get(owner.ownerId);
      if (set?.has(oldId)) { set.delete(oldId); set.add(newId); }
    }
    moveKey(this.bindings, oldId, newId);
    moveKey(this.resolved, oldId, newId);
    return views;
  }

  // ── views (cubes showing a row) ────────────────────────────────────────────

  attach(id: string, view: Cube): void {
    let set = this.views.get(id);
    if (!set) this.views.set(id, (set = new Set()));
    set.add(view);
  }

  detach(id: string, view: Cube): void {
    const set = this.views.get(id);
    if (!set) return;
    set.delete(view);
    if (set.size === 0) this.views.delete(id);
  }

  /** How many views a row has (tests). */
  viewCount(id: string): number { return this.views.get(id)?.size ?? 0; }

  // ── ownership (per-entity nested lists) ────────────────────────────────────

  /** One owner per child: a re-parented child leaves its previous owner's set. */
  setOwner(childId: string, ownerId: string, ownerListNode: object): void {
    const prev = this.owners.get(childId);
    if (prev && prev.ownerId !== ownerId) this.childrenByOwner.get(prev.ownerId)?.delete(childId);
    this.owners.set(childId, { ownerId, ownerListNode });
    let set = this.childrenByOwner.get(ownerId);
    if (!set) this.childrenByOwner.set(ownerId, (set = new Set()));
    set.add(childId);
  }

  ownerOf(childId: string): Owner | undefined { return this.owners.get(childId); }

  getChildrenByOwner(ownerId: string): ReadonlySet<string> | undefined { return this.childrenByOwner.get(ownerId); }

  // ── template bindings and the resolved cache (useForm(entity, template)) ───

  bind(id: string, templateNode: object): void {
    let set = this.bindings.get(id);
    if (!set) this.bindings.set(id, (set = new Set()));
    set.add(templateNode);
  }

  unbind(id: string, templateNode: object): void { this.bindings.get(id)?.delete(templateNode); }

  getBindings(id: string): ReadonlySet<object> | undefined { return this.bindings.get(id); }

  markResolved(id: string, templateNode: object): void {
    let set = this.resolved.get(id);
    if (!set) this.resolved.set(id, (set = new Set()));
    set.add(templateNode);
  }

  isResolved(id: string, templateNode: object): boolean { return this.resolved.get(id)?.has(templateNode) ?? false; }

  clearResolved(id: string, templateNode?: object): void {
    if (templateNode === undefined) this.resolved.delete(id);
    else this.resolved.get(id)?.delete(templateNode);
  }
}

function merge(target: Values, base: Values, patch: Values, path: string[], changed: string[][]) {
  for (const k in patch) {
    if (k === "id" && path.length === 0) continue;
    const v = patch[k];
    const cur = target[k];
    if (isPlainObject(v) && isPlainObject(cur)) {
      if (!isPlainObject(base[k])) base[k] = {};
      merge(cur, base[k] as Values, v, [...path, k], changed);
      continue;
    }
    if (Object.is(cur, v)) continue;
    const had = k in target;
    target[k] = clonePlain(v);
    if (!had) base[k] = clonePlain(v); // a key's first appearance seeds its dirty baseline (store: initialValueMap at registration)
    changed.push([...path, k]);
  }
}

/** The cube at `path` under a view, if that part of the subtree is built, and everything below it. */
function bumpPath(view: Cube, path: string[]) {
  let c: Cube | undefined = view;
  for (const k of path) {
    c = c.builtChild(k);
    if (!c) return;
  }
  c.bumpDeep();
}

function moveKey<V>(map: Map<string, V>, from: string, to: string) {
  const v = map.get(from);
  if (v === undefined) return;
  map.delete(from);
  map.set(to, v);
}
