import type { Values } from "./config";
import type { Cube } from "./cube";

/**
 * Entity registry (one per store): id → row. One row can be shown through
 * several lists and templates: view cubes read and write the same row, and a
 * changed key bumps that key's leaf in every view. Replaces EntityRegistry +
 * entityProjectionObjs + buildEntityProjectionProxy.
 */
export class Registry {
  private rows = new Map<string, Values>();
  /** id → its view, or its views once a second one binds (most rows have one). */
  private views = new Map<string, Cube | Set<Cube>>();

  get(id: string) { return this.rows.get(id); }

  set(row: Values) {
    const id = String(row.id);
    const prev = this.rows.get(id);
    this.rows.set(id, { ...prev, ...row });
    const views = this.views.get(id);
    if (!views) return;
    for (const k in row) {
      if (prev && Object.is(prev[k], row[k])) continue;
      if (views instanceof Set) views.forEach((item) => item.builtChild(k)?.bump());
      else views.builtChild(k)?.bump();
    }
  }

  bind(id: string, view: Cube) {
    const v = this.views.get(id);
    if (!v) this.views.set(id, view);
    else if (v instanceof Set) v.add(view);
    else if (v !== view) this.views.set(id, new Set([v, view]));
  }

  unbind(id: string, view: Cube) {
    const v = this.views.get(id);
    if (v === view) this.views.delete(id);
    else if (v instanceof Set) {
      v.delete(view);
      if (v.size === 1) this.views.set(id, v.values().next().value!);
    }
  }

  /** How many views a row has (tests). */
  viewCount(id: string) {
    const v = this.views.get(id);
    return v instanceof Set ? v.size : v ? 1 : 0;
  }
}
