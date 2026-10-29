import { childKeys, isLeafConfig, type CubeConfig, type ListConfig, type Values } from "./config";
import { Cube, registerList } from "./cube";
import type { Hub } from "./hub";
import type { PublicNode } from "./node";
import { track, untracked } from "./track";

let tmpSeq = 0;

/**
 * List: a cube whose children are view cubes over registry rows, one per id,
 * made from the template. The same row through another list or template is
 * just another view over the same id.
 */
export class ListCube extends Cube {
  readonly template: CubeConfig;
  private ids: string[] = [];
  private initialIds: string[] = [];
  private views = new Map<string, Cube>();
  /** Per membership version: the view cubes, their public nodes, their values. */
  private cache?: { version: number; items: Cube[]; nodes?: PublicNode[]; values?: Values[] };

  constructor(config: ListConfig, parent: Cube, key: string, hub: Hub) {
    super(config as unknown as CubeConfig, parent, key, hub, undefined, "list");
    this.template = config[0];
    rejectComputed(this.template, `${this.path}[]`);
  }

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

  /** Rows (`{ id, ...fields }`, written to the registry) or ids of rows already there. */
  setItems(rows: Array<Values | string>) {
    this.hub.batch(() => {
      const ids = rows.map((r) => this.upsert(r));
      const kept = new Set(ids);
      for (const id of this.ids) if (!kept.has(id)) this.drop(id);
      this.ids = ids;
      this.bump();
    });
  }

  add(row: Values | string) {
    this.hub.batch(() => {
      const id = this.upsert(row);
      if (!this.ids.includes(id)) { this.ids = [...this.ids, id]; this.bump(); }
    });
  }

  remove(id: string) {
    if (!this.ids.includes(id)) return;
    this.hub.batch(() => {
      this.ids = this.ids.filter((x) => x !== id);
      this.drop(id);
      this.bump();
    });
  }

  private upsert(row: Values | string): string {
    if (typeof row === "string") return row;
    const id = row.id == null || row.id === "" ? `_tmp_${++tmpSeq}` : String(row.id);
    this.hub.registry.set({ ...row, id });
    return id;
  }

  /** An id left the list: its view stops listening to the registry and its resolves stop. */
  private drop(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    this.hub.registry.unbind(id, v);
    v.dispose();
  }

  private view(id: string): Cube {
    let c = this.views.get(id);
    if (!c) {
      c = new Cube(this.template, this, id, this.hub, id);
      this.hub.registry.bind(id, c);
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
    return untracked(() => this.items).map((i) => ({ id: i.entityId, ...(i.plain() as Values) }));
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
