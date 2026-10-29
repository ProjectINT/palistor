import type { Values } from "./config";
import type { Cube } from "./cube";

/**
 * Entity registry (lives on the root): id → row. One row can be shown through
 * several lists and templates: view cubes read and write the same row and are
 * all bumped together when it changes. Replaces EntityRegistry +
 * entityProjectionObjs + buildEntityProjectionProxy.
 */
export class Registry {
  private rows = new Map<string, Values>();
  private views = new Map<string, Set<Cube>>();

  get(id: string) { return this.rows.get(id); }

  set(row: Values) {
    const id = String(row.id);
    this.rows.set(id, { ...this.rows.get(id), ...row });
    this.views.get(id)?.forEach((c) => c.bump());
  }

  bind(id: string, view: Cube) {
    let set = this.views.get(id);
    if (!set) this.views.set(id, (set = new Set()));
    set.add(view);
  }
}
