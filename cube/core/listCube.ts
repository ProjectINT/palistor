import type { CubeConfig, Resolve, Values } from "./config";
import { Cube, registerList } from "./cube";
import { track } from "./track";

/** List: a cube whose children are made from an array by a template. */
export class ListCube extends Cube {
  private ids: string[] = [];
  private cache = new Map<string, Cube>(); // id → view cube for THIS list

  constructor(readonly template: CubeConfig, resolve: Resolve | undefined, parent: Cube, key: string) {
    super(resolve ? { resolve } : {}, parent, key);
  }

  get items(): Cube[] { track(this); this.loading; return this.ids.map((id) => this.item(id)); }
  get length() { return this.items.length; }
  map<T>(fn: (item: Cube, i: number) => T) { return this.items.map(fn); }
  getById(id: string) { return this.items.find((i) => i.entityId === id); }

  override get value() { return this.items.map((i) => i.values); }

  setItems(rows: Values[]) {
    for (const r of rows) this.registry.set(r);
    this.ids = rows.map((r) => String(r.id));
    this.bump();
    this.root.notify();
  }
  add(row: Values) { this.setItems([...this.ids.map((id) => this.registry.get(id)!), row]); }
  remove(id: string) { this.ids = this.ids.filter((x) => x !== id); this.bump(); this.root.notify(); }

  /** The same registry row through another template is just another ListCube/Cube over the same id. */
  private item(id: string) {
    let c = this.cache.get(id);
    if (!c) {
      c = new Cube(this.template, this, id);
      c.entityId = id;
      this.registry.bind(id, c);
      this.cache.set(id, c);
    }
    return c;
  }

  protected override assign(rows: unknown) { if (Array.isArray(rows)) this.setItems(rows); }

  protected override snapshot(forSubmit: boolean) { return this.items.map((i) => i.getValues(forSubmit)); }

  protected override apply(result: unknown) {
    this.setItems(result as Values[]);
  }
}

registerList((template, resolve, parent, key) => new ListCube(template, resolve, parent, key));
