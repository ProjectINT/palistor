import { childKeys, isLeafConfig, type CubeConfig, type ListConfig, type Values } from "./config";
import { Cube, registerList } from "./cube";
import type { Hub } from "./hub";
import type { PublicNode } from "./node";
import { track, untracked } from "./track";

/**
 * List: a cube whose children are view cubes over registry rows, one per id,
 * made from the template. The same row through another list or template is
 * just another view over the same id.
 *
 * A list declared inside an entity template is a per-entity list: each item
 * gets its own instance, whose rows are owned by that item (store: ownerEntity,
 * one owner per child, cascade on delete).
 */
export class ListCube extends Cube {
  readonly template: CubeConfig;
  private ids: string[] = [];
  private initialIds: string[] = [];
  /** Membership was ever set. store: an untouched per-entity list had no state and added no key to values. */
  touched = false;
  private views = new Map<string, Cube>();
  /** Per membership version: the view cubes, their public nodes, their values. */
  private cache?: { version: number; items: Cube[]; nodes?: PublicNode[]; values?: Values[] };

  constructor(config: ListConfig, parent: Cube, key: string, hub: Hub) {
    super(config as unknown as CubeConfig, parent, key, hub, undefined, "list");
    this.template = config[0];
    rejectComputed(this.template, `${this.path}[]`);
    hub.lists.add(this);
  }

  /** The entity whose row owns this list's items (per-entity list), null for a root list. */
  get owner(): Cube | null { return this.item; }

  get items(): Cube[] { track(this); return this.snapshot().items; }

  /** Public nodes of the items, same array while the membership is unchanged. */
  itemNodes(): PublicNode[] {
    track(this);
    const c = this.snapshot();
    return (c.nodes ??= c.items.map((i) => i.node));
  }

  private snapshot() {
    if (this.cache?.version !== this.version) {
      this.cache = { version: this.version, items: this.ids.map((id) => this.view(id)) };
    }
    return this.cache;
  }
  get length() { track(this); return this.ids.length; }

  getById(id: string) {
    track(this);
    return this.ids.includes(id) ? this.view(id) : undefined;
  }

  override get value(): any {
    track(this);
    const c = this.snapshot();
    return (c.values ??= c.items.map((i) => i.values));
  }

  /** store: dirty by composition, the ids differ from the loaded ones. */
  override get dirty(): boolean {
    track(this);
    return !sameIds(this.ids, this.initialIds);
  }

  // ── mutations (store's list proxy) ──────────────────────────────────────────

  /**
   * add(id): an entity already in the registry — a root list ignores an unknown
   * id, a per-entity list throws. add(row): upserts the row (a tmp id when it
   * has none) and returns the item node. A per-entity list takes ownership.
   */
  add(row: Values | string): PublicNode | undefined {
    const fromValues = typeof row !== "string";
    let id: string;
    if (fromValues) {
      id = this.hub.setRows([row])[0];
    } else {
      id = row;
      if (!this.hub.registry.has(id)) {
        if (this.owner) throw new Error(`[palistor] per-entity list add("${id}"): entity not found in registry.`);
        return undefined;
      }
    }
    this.hub.batch(() => {
      this.own(id);
      this.touched = true;
      if (!this.ids.includes(id)) { this.ids = [...this.ids, id]; this.bump(); }
    });
    return fromValues ? this.view(id).node : undefined;
  }

  remove(id: string) {
    if (!this.ids.includes(id)) return;
    this.hub.batch(() => {
      this.ids = this.ids.filter((x) => x !== id);
      this.touched = true;
      this.drop(id);
      this.bump();
    });
  }

  /**
   * Replaces the membership: ids of rows already in the registry (a per-entity
   * list requires every one of them to exist) and/or rows (upserted). Duplicates
   * collapse to the first occurrence, as in store.
   */
  setItems(rows: Array<Values | string>) {
    if (this.owner) {
      for (const r of rows) {
        if (typeof r === "string" && !this.hub.registry.has(r)) {
          throw new Error(`[palistor] per-entity list setItems: entity "${r}" not found in registry.`);
        }
      }
    }
    this.hub.batch(() => {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const id = typeof r === "string" ? r : this.hub.setRows([r])[0];
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      for (const id of ids) this.own(id);
      for (const id of this.ids) if (!seen.has(id)) this.drop(id);
      this.ids = ids;
      this.touched = true;
      this.bump();
    });
  }

  private own(id: string) {
    const owner = this.owner;
    if (owner) this.hub.registry.setOwner(id, owner.entityId!, this.config);
  }

  // ── registry-driven maintenance (hub) ──────────────────────────────────────

  /** store.delete: the id leaves the membership (the initial ids keep it, as in store). */
  removeId(id: string) {
    if (!this.ids.includes(id)) return;
    this.ids = this.ids.filter((x) => x !== id);
    this.drop(id);
    this.bump();
  }

  /** store.rekey: the registry has already moved the row and re-pointed the views. */
  rekeyId(oldId: string, newId: string) {
    const view = this.views.get(oldId);
    if (view) { this.views.delete(oldId); this.views.set(newId, view); }
    let hit = false;
    const swap = (arr: string[]) => arr.map((x) => (x === oldId ? ((hit = true), newId) : x));
    this.ids = swap(this.ids);
    this.initialIds = swap(this.initialIds);
    if (hit) this.bump();
  }

  /** Full-form reset: back to the membership the last resolve (or nothing) loaded. */
  resetMembership() {
    if (sameIds(this.ids, this.initialIds)) return;
    const keep = new Set(this.initialIds);
    for (const id of this.ids) if (!keep.has(id)) this.drop(id);
    this.ids = [...this.initialIds];
    this.bump();
  }

  /** The list itself leaves the tree (its owner item was dropped): its views go with it. */
  release() {
    for (const [id, v] of this.views) { this.hub.registry.detach(id, v); v.dispose(); }
    this.views.clear();
    this.hub.lists.delete(this);
  }

  /** An id left the list: its view stops listening to the registry and its resolves stop. */
  private drop(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    this.hub.registry.detach(id, v);
    v.dispose();
  }

  private view(id: string): Cube {
    let c = this.views.get(id);
    if (!c) {
      c = new Cube(this.template, this, id, this.hub, id);
      this.hub.registry.attach(id, c);
      this.views.set(id, c);
    }
    return c;
  }

  override assign(rows: unknown) { if (Array.isArray(rows)) this.setItems(rows); }

  override applyResolved(rows: unknown, initial: boolean) {
    if (!Array.isArray(rows)) return;
    this.setItems(rows);
    if (initial) {
      this.initialIds = [...this.ids];
      for (const item of untracked(() => this.items)) item.walk((c) => c.captureInitial());
    }
  }

  override snapshotValue() {
    track(this);
    return untracked(() => this.plain());
  }

  override plain(): Values[] {
    return untracked(() => this.items).map((i) => i.plain() as Values);
  }

  protected override signature(): unknown[] {
    track(this);
    return [this.version, this.loading, this.error, this.resolveStatus, this.dirty];
  }
}

/** store: a template is a rule set shared by every item; a computed value there would never run. */
function rejectComputed(template: CubeConfig, path: string) {
  for (const k of childKeys(template)) {
    const sub = template[k] as CubeConfig;
    if (Array.isArray(sub)) continue;
    if (isLeafConfig(sub)) {
      if (typeof sub.value === "function") {
        throw new Error(
          `[palistor] computed "value" is not supported inside a list template (${path}.${k}): ` +
          `a template is a rule set shared by every item, its value comes from the item's data.`,
        );
      }
    } else rejectComputed(sub, `${path}.${k}`);
  }
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

registerList((config, parent, key, hub) => new ListCube(config, parent, key, hub));
