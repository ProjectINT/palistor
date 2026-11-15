import { childKeys, isLeafConfig, type CubeConfig, type ListConfig, type Values } from "./config";
import { Cube, registerList } from "./cube";
import { FilterCube, warnNestedFilters } from "./filter";
import type { Hub } from "./hub";
import type { PublicNode } from "./node";
import { Pager } from "./pagination";
import { track, untracked } from "./track";

/**
 * List: a cube whose children are view cubes over registry rows, one per id,
 * made from the template. The same row through another list or template is
 * just another view over the same id.
 *
 * A list declared inside an entity template is a per-entity list: each item
 * gets its own instance, whose rows are owned by that item (store: ownerEntity,
 * one owner per child, cascade on delete). Its membership lives in the hub per
 * (owner id, list config) — every view of the owner (another list with the
 * same template, useForm(entity, template)) shows the same one, as store's
 * one ListState per owner and list node did.
 *
 * A root list may carry a filter (filter.ts). Then `items`, `length`, `map`
 * and iteration show the visible rows; `getById`, `getValues`, `dirty` and the
 * list's value in the form stay on the full membership.
 *
 * A list with `resolve.pagination` (root or per-entity) keeps a page cache
 * (pagination.ts): its membership is the projection of the current window,
 * local edits go to the page entries, `dirty` is the per-page rollup.
 */
export class ListCube extends Cube {
  readonly template: CubeConfig;
  /** Membership, baseline and page cache: this list's own, or (per-entity) shared by every view of the owner. */
  readonly state: ListState;
  private views = new Map<string, Cube>();
  /** The full membership and the visible one: view cubes, their public nodes, their values. */
  private full?: Snapshot;
  private shown?: Snapshot;
  /** The last visible ids, kept while a new projection has the same ones. */
  private shownIds?: string[];
  /** `defineList({ filter })` on a root list. A per-entity list ignores it (warned at construction, as store). */
  readonly filter?: FilterCube;

  constructor(config: ListConfig, parent: Cube, key: string, hub: Hub) {
    super(config as unknown as CubeConfig, parent, key, hub, undefined, "list");
    this.template = config[0];
    rejectComputed(this.template, `${this.path}[]`);
    this.state = this.item ? hub.entityListState(this.item.entityId!, config) : new ListState();
    this.state.cubes.add(this);
    const resolve = config[1]?.resolve;
    if (resolve?.pagination && typeof resolve.resolver === "function") {
      const pager = (this.state.pager ??= new Pager(this, resolve, hub));
      pager.attach(this);
      this.rs = pager;
      hub.resolving.add(pager);
    }
    if (!this.item) {
      warnNestedFilters(this.template, `${this.path}[]`);
      const block = config[1]?.filter;
      if (block) this.filter = new FilterCube(block as Values, this, hub);
    }
    hub.lists.add(this);
  }

  /** The entity whose row owns this list's items (per-entity list), null for a root list. */
  get owner(): Cube | null { return this.item; }

  /** `resolve.pagination`: the page cache; also the list's `rs`. */
  get pager(): Pager | undefined { return this.state.pager; }

  private get ids(): string[] { return this.state.ids; }
  private set ids(v: string[]) { this.state.ids = v; }
  private get initialIds(): string[] { return this.state.initialIds; }
  private set initialIds(v: string[]) { this.state.initialIds = v; }
  /** Membership was ever set. store: an untouched per-entity list had no state and added no key to values. */
  get touched(): boolean { return this.state.touched; }
  set touched(v: boolean) { this.state.touched = v; }

  /** A shared membership changed: every view of it moves. */
  override bump() {
    const cubes = this.state.cubes;
    if (cubes.size <= 1) return super.bump();
    for (const c of cubes) c.bumpOwn();
  }

  private bumpOwn() { super.bump(); }

  /** View cubes of the full membership. */
  get items(): Cube[] { track(this); return this.snapshot().items; }

  /** View cubes of the visible rows (map). */
  visibleItems(): Cube[] { return this.shownSnapshot().items; }

  /** Public nodes of the visible rows, same array while they are unchanged. */
  itemNodes(): PublicNode[] {
    const c = this.shownSnapshot();
    return (c.nodes ??= c.items.map((i) => i.node));
  }

  /** Visible rows. */
  get length() { return this.visibleIds().length; }

  /** The full loaded membership (`list.fullLength` of a filtered list). */
  get fullLength() { track(this); return this.ids.length; }

  /**
   * The ids the list shows: the client filter's projection over the
   * membership (re-run when the membership, a filter field or any registry
   * row moves), the membership itself otherwise. Tracked.
   */
  visibleIds(): string[] {
    track(this);
    const f = this.filter;
    if (!f?.hasClient) return this.ids;
    return this.memo("visible", () => {
      track(this);
      track(this.hub.registry);
      const next = f.project(this.ids, this.initialIds, (id) => this.hub.registry.get(id));
      const prev = this.shownIds;
      return (this.shownIds = next !== this.ids && prev && sameIds(prev, next) ? prev : next);
    });
  }

  private snapshot(): Snapshot {
    const ids = this.ids;
    if (this.full?.ids !== ids && this.state.cubes.size > 1) {
      // Another view changed the shared membership: views of ids that left it go.
      const keep = new Set(ids);
      for (const id of [...this.views.keys()]) if (!keep.has(id)) this.drop(id);
    }
    return (this.full = this.snap(ids, this.full));
  }

  private shownSnapshot(): Snapshot {
    const ids = this.visibleIds();
    return ids === this.ids ? this.snapshot() : (this.shown = this.snap(ids, this.shown));
  }

  /** Ids arrays are replaced, never mutated: same array, same snapshot. */
  private snap(ids: string[], prev: Snapshot | undefined): Snapshot {
    return prev?.ids === ids ? prev : { ids, items: ids.map((id) => this.view(id)) };
  }

  getById(id: string) {
    track(this);
    return this.ids.includes(id) ? this.view(id) : undefined;
  }

  override get value(): any {
    track(this);
    const c = this.snapshot();
    return (c.values ??= c.items.map((i) => i.values));
  }

  /** store: dirty by composition, the ids differ from the loaded ones; paginated: any cached page differs from its baseline. */
  override get dirty(): boolean {
    track(this);
    return this.pager ? this.pager.isDirty() : !sameIds(this.ids, this.initialIds);
  }

  /** Paginated: some page of the current query is in flight (several can be). */
  override get loading(): boolean | undefined {
    if (!this.pager) return super.loading;
    track(this);
    return this.pager.isFetching;
  }

  /**
   * A read through the public node (items, length, map, values): wakes the
   * lazy resolve; with `options.suspense` a pending run throws its promise.
   * A paginated list suspends only while nothing is renderable (the first
   * page, or a new query without keepPreviousData).
   */
  override touch() {
    const rs = this.rs;
    if (!rs) return;
    rs.touch();
    const resolve = (this.config as unknown as ListConfig)[1]?.resolve;
    if (resolve?.options?.suspense !== true || rs.status !== "pending" || !rs.promise) return;
    if (this.pager && (this.ids.length > 0 || this.pager.isPreviousData)) return;
    throw rs.promise;
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
      if (this.pager) this.pager.add(id);
      else if (!this.ids.includes(id)) { this.ids = [...this.ids, id]; this.bump(); }
    });
    return fromValues ? this.view(id).node : undefined;
  }

  remove(id: string) {
    if (this.pager) return this.pager.remove(id);
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
      if (this.pager) return this.pager.setItems(ids);
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

  /** store.delete: the id leaves the membership (the initial ids keep it, as in store); paginated: every cached page. */
  removeId(id: string) {
    if (this.pager) { this.drop(id); return this.pager.deleteId(id); }
    if (!this.ids.includes(id)) { this.drop(id); return; } // a shared membership: another view already took it out
    this.ids = this.ids.filter((x) => x !== id);
    this.drop(id);
    this.bump();
  }

  /** store.rekey: the registry has already moved the row and re-pointed the views. */
  rekeyId(oldId: string, newId: string) {
    const view = this.views.get(oldId);
    if (view) { this.views.delete(oldId); this.views.set(newId, view); }
    if (this.pager) return this.pager.rekey(oldId, newId);
    let hit = false;
    const swap = (arr: string[]) => (arr.includes(oldId) ? ((hit = true), arr.map((x) => (x === oldId ? newId : x))) : arr);
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

  /**
   * Persist hydration: the membership and its baseline at once (store set
   * itemIds and initialItemIds), so the restored list is not dirty. The rows
   * are already in the registry. Returns the item views, in order.
   */
  restore(ids: string[]): Cube[] {
    const next = [...new Set(ids)];
    this.hub.batch(() => {
      const keep = new Set(next);
      for (const id of next) this.own(id);
      for (const id of this.ids) if (!keep.has(id)) this.drop(id);
      this.ids = next;
      this.initialIds = [...next];
      this.touched = true;
      this.bump();
    });
    return ids.map((id) => this.view(id));
  }

  /**
   * Pagination: the projected window becomes the membership and its
   * baseline. Views of ids that left it are released. The pager notifies.
   */
  setWindow(ids: string[], initialIds: string[]) {
    const keep = new Set(ids);
    for (const id of this.ids) if (!keep.has(id)) this.drop(id);
    this.ids = ids;
    this.initialIds = initialIds;
    this.touched = true;
  }

  /** The membership as it is, untracked and without waking a lazy resolve. */
  windowIds(): string[] { return this.ids; }

  /** The list itself leaves the tree (its owner item was dropped): its views go with it. */
  release() {
    this.state.cubes.delete(this);
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

  /** The resolver's third argument: the filter at launch (store passed it always, empty without a block). */
  resolveContext(): unknown {
    return this.filter?.launch() ?? { filter: { values: {}, params: undefined, key: "" }, queryKey: "" };
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
    const sig: unknown[] = [this.version, this.loading, this.error, this.resolveStatus, this.dirty];
    if (this.filter?.hasClient) sig.push(this.visibleIds()); // a keystroke in a `where` field re-renders the rows
    return sig;
  }
}

interface Snapshot { ids: string[]; items: Cube[]; nodes?: PublicNode[]; values?: Values[] }

/**
 * The membership of a list (store's ListState): ids, the dirty baseline, the
 * page cache. A root list owns one; a per-entity list's lives in the hub per
 * (owner id, list config) until the owner is deleted.
 */
export class ListState {
  ids: string[] = [];
  initialIds: string[] = [];
  touched = false;
  pager?: Pager;
  /** The list cubes showing it (one per view of the owner). */
  readonly cubes = new Set<ListCube>();
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
