// ─────────────────────────────────────────────────────────────────────────────
// Persist: a snapshot of the form's values in a storage driver. enable()
// hydrates from the driver and autosaves after every notification cycle
// (debounced); disable() stops both. Store's PersistManager, over the cube tree.
//
//   • save      — getValues() through pick / omit, serialized. A payload equal
//                 to what the storage already reflects is not written again.
//   • hydrate   — raw state, like store's applyPatch: no formatter / setter /
//                 onChange, one notification. Lists get their membership and
//                 its baseline back, rows go to the registry, per-entity lists
//                 to the item that owns them.
//   • races     — a generation token: a hydration superseded by enable() /
//                 disable() while awaiting the driver applies nothing; saves
//                 (debounced and flush) wait until hydration has landed.
//   • clear     — removes the snapshot; the current values count as handled,
//                 so nothing writes them back until they change (store wrote
//                 them back on the next cycle, undoing clear-on-submit).
//
// Reserved snapshot keys `__flows` and `__pagination` belong to steps 2.7 and
// 2.5; until then hydration drops them.
// ─────────────────────────────────────────────────────────────────────────────

import { isLeafConfig, isPlainObject, type CubeConfig, type Values } from "./config";
import type { Cube } from "./cube";
import type { Hub } from "./hub";
import { idOf } from "./registry";
import type { ListCube } from "./listCube";

/** store/persist/types.ts: sync or async storage. */
export interface PersistDriver {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface PersistOptions {
  key: string;
  driver: PersistDriver;
  serialize?: (values: Values) => string;
  deserialize?: (raw: string) => Values;
  /** ms between the last change and the write (default 100, 0 = right away). */
  debounce?: number;
  /** Top-level keys to save; wins over omit. */
  pick?: string[];
  omit?: string[];
  onError?: (error: unknown, phase: "save" | "hydrate") => void;
}

interface Session {
  key: string;
  driver: PersistDriver;
  serialize: (values: Values) => string;
  deserialize: (raw: string) => Values;
  debounce: number;
  pick?: string[];
  omit?: string[];
  onError?: PersistOptions["onError"];
}

const RESERVED = ["__flows", "__pagination"];

export class Persist {
  private session: Session | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hydrating = false;
  /** Bumped by enable() / disable(): a hydration applies only under the generation it started in. */
  private generation = 0;
  /** The payload the storage already reflects (written, or deliberately cleared); not written again. */
  private settled: string | null = null;

  constructor(private readonly hub: Hub) {}

  isEnabled(): boolean { return this.session !== null; }

  /** Hydrate from the driver and autosave from now on; an active session is disabled first. */
  enable(options: PersistOptions): Promise<void> {
    if (this.session) this.disable();
    this.generation++;
    this.session = {
      key: options.key,
      driver: options.driver,
      serialize: options.serialize ?? JSON.stringify,
      deserialize: options.deserialize ?? JSON.parse,
      debounce: options.debounce ?? 100,
      pick: options.pick,
      omit: options.omit,
      onError: options.onError,
    };
    this.settled = null;
    this.unsubscribe = this.hub.subscribe(this.schedule);
    return this.hydrate();
  }

  /** Stop autosaving; a pending write is dropped, a hydration in flight applies nothing. */
  disable(): void {
    this.session = null;
    this.cancel();
    this.generation++;
    this.hydrating = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.settled = null;
  }

  /** Write now (no debounce). A no-op while hydration is in flight: it would store the not-yet-hydrated values. */
  async flush(): Promise<void> {
    if (this.hydrating) return;
    this.cancel();
    await this.save();
  }

  /** Read the driver and apply the snapshot. */
  async hydrate(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const generation = this.generation;
    this.hydrating = true;
    try {
      const raw = await s.driver.getItem(s.key);
      if (generation !== this.generation || raw == null) return;
      const values = s.deserialize(raw);
      if (!isPlainObject(values)) return;
      for (const k of RESERVED) delete values[k];
      const hub = this.hub;
      hub.batch(() => restoreGroup(hub, hub.root, values));
    } catch (e) {
      this.report(s, e, "hydrate");
    } finally {
      // A superseded run finishing late must not unmark a newer one still in flight.
      if (generation === this.generation) this.hydrating = false;
    }
  }

  /** Remove the snapshot. The current values are not written back until they change. */
  async clear(): Promise<void> {
    const s = this.session;
    if (!s) return;
    let marker: string | null = null;
    try { marker = s.serialize(this.payload(s)); } catch { /* reported by the next save */ }
    this.settled = marker;
    try {
      await s.driver.removeItem(s.key);
    } catch {
      if (this.settled === marker) this.settled = null;
    }
  }

  /** A hub listener: every notification cycle schedules a write. */
  private readonly schedule = (): void => {
    const s = this.session;
    if (!s || this.hydrating) return;
    this.cancel();
    if (s.debounce <= 0) { void this.save(); return; }
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, s.debounce);
  };

  private cancel() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  /** The driver is called synchronously: usePersist's cleanup flushes right before it disables. */
  private async save(): Promise<void> {
    const s = this.session;
    if (!s) return;
    let text: string;
    try {
      text = s.serialize(this.payload(s));
    } catch (e) {
      this.report(s, e, "save");
      return;
    }
    if (text === this.settled) return;
    this.settled = text;
    try {
      await s.driver.setItem(s.key, text);
    } catch (e) {
      if (this.settled === text) this.settled = null;
      this.report(s, e, "save");
    }
  }

  private payload(s: Session): Values {
    const values = this.hub.root.getValues();
    if (s.pick?.length) {
      const out: Values = {};
      for (const k of s.pick) if (k in values) out[k] = values[k];
      return out;
    }
    if (s.omit?.length) for (const k of s.omit) delete values[k];
    return values;
  }

  private report(s: Session, error: unknown, phase: "save" | "hydrate") {
    try { s.onError?.(error, phase); } catch { /* onError must not break the store */ }
  }
}

// ── hydration ───────────────────────────────────────────────────────────────

/** A form group: leaves take the stored value raw, groups recurse, lists are restored. */
function restoreGroup(hub: Hub, group: Cube, values: Values) {
  for (const [k, c] of group.children) {
    if (!(k in values)) continue;
    const v = values[k];
    if (c.kind === "leaf") { if (typeof c.config.value !== "function") c.assign(v); }
    else if (c.kind === "group") { if (isPlainObject(v)) restoreGroup(hub, c, v); }
    else if (Array.isArray(v)) restoreList(hub, c as ListCube, v);
  }
}

/** Rows go to the registry (merged), the list gets the ids as membership and baseline, then each item's own lists. */
function restoreList(hub: Hub, list: ListCube, rows: unknown[]) {
  const items: Array<[string, Values]> = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const id = idOf(row);
    if (hub.registry.set({ ...rowData(row, list.template), id })) hub.touch();
    items.push([id, row]);
  }
  const views = list.restore(items.map(([id]) => id));
  items.forEach(([, row], i) => restoreItemLists(hub, views[i], row));
}

/** Inside an item: only lists (its fields already came with the row), in groups too. */
function restoreItemLists(hub: Hub, cube: Cube, values: Values) {
  for (const [k, c] of cube.children) {
    const v = values[k];
    if (c.kind === "list") { if (Array.isArray(v)) restoreList(hub, c as ListCube, v); }
    else if (c.kind === "group" && isPlainObject(v)) restoreItemLists(hub, c, v);
  }
}

/** A row without the template's list keys: those belong to the per-entity lists. */
function rowData(row: Values, config: CubeConfig): Values {
  const out: Values = {};
  for (const k in row) {
    const sub = config[k];
    if (Array.isArray(sub)) continue;
    const v = row[k];
    out[k] = isPlainObject(sub) && !isLeafConfig(sub) && isPlainObject(v) ? rowData(v, sub as CubeConfig) : v;
  }
  return out;
}

// ── drivers ─────────────────────────────────────────────────────────────────

/**
 * A Web Storage driver. Without the storage (SSR) it reads nothing and writes
 * nowhere. Failures reach the persist manager, which reports them to onError
 * (store's drivers swallowed them, so a quota error never reached onError).
 */
function webStorage(get: () => Storage | undefined): PersistDriver {
  return {
    getItem: (key) => get()?.getItem(key) ?? null,
    setItem: (key, value) => { get()?.setItem(key, value); },
    removeItem: (key) => { get()?.removeItem(key); },
  };
}

export const localStorageDriver = webStorage(() => (typeof localStorage === "undefined" ? undefined : localStorage));
export const sessionStorageDriver = webStorage(() => (typeof sessionStorage === "undefined" ? undefined : sessionStorage));
