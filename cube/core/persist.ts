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
//                 to the item that owns them (restore.ts, shared with the
//                 constructor's `initialData`).
//   • races     — a generation token: a hydration superseded by enable() /
//                 disable() while awaiting the driver applies nothing; saves
//                 (debounced and flush) wait until hydration has landed.
//   • clear     — removes the snapshot; the current values count as handled,
//                 so nothing writes them back until they change (store wrote
//                 them back on the next cycle, undoing clear-on-submit).
//   • pages     — a paginated root list adds its window blob under
//                 `__pagination[listPath]` (pagination.ts) when its array
//                 survived pick / omit; a quota failure retries with every
//                 window trimmed to its pointer, then without blobs. No write
//                 while a root list fetches a page (a torn window). disable()
//                 drops every page cache: it belongs to the persisted session.
//
//   • flows     — the navigation of every flow under `__flows[flowPath]`
//                 (flow.ts), outside pick / omit: it is not a form field.
//                 Hydration restores it after the values; a flow whose active
//                 step moved enters it again (onEnter → resolve → onReady).
// ─────────────────────────────────────────────────────────────────────────────

import { isPlainObject, type Values } from "./config";
import type { Hub } from "./hub";
import { restoreDraft } from "./restore";

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

const FLOWS_KEY = "__flows";
const PAGINATION_KEY = "__pagination";

/** store/persist/persistManager.ts: only a quota failure is worth retrying smaller. */
function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014;
}

type PageMode = "full" | "pointer" | "none";

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
    this.hub.clearPageCaches();
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
      const blobs = values[PAGINATION_KEY];
      const flows = values[FLOWS_KEY];
      delete values[PAGINATION_KEY];
      delete values[FLOWS_KEY];
      const hub = this.hub;
      const entered = hub.batch(() => {
        restoreDraft(hub, values, isPlainObject(blobs) ? blobs : undefined);
        return isPlainObject(flows) ? hub.flows.filter((f) => f.restore(flows[f.path])) : [];
      });
      for (const flow of entered) flow.enterCurrent();
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

  /**
   * The driver is called synchronously: usePersist's cleanup flushes right
   * before it disables (a sync driver's quota throw retries synchronously too).
   */
  private async save(): Promise<void> {
    const s = this.session;
    if (!s || this.fetchingPage()) return;
    const values = this.values(s);
    let lastError: unknown;
    for (const mode of ["full", "pointer", "none"] as const) {
      let text: string;
      try {
        text = s.serialize(this.withPages(values, mode));
      } catch (e) {
        this.report(s, e, "save");
        return;
      }
      if (text === this.settled) return;
      this.settled = text;
      try {
        await s.driver.setItem(s.key, text);
        return;
      } catch (e) {
        if (this.settled === text) this.settled = null;
        lastError = e;
        if (!isQuotaError(e)) break;
      }
    }
    this.report(s, lastError, "save");
  }

  /** A root list's page fetch in flight: its window is a torn intermediate state. */
  private fetchingPage(): boolean {
    for (const list of this.hub.lists) if (list.pager && !list.item && list.pager.isFetching) return true;
    return false;
  }

  private payload(s: Session): Values { return this.withPages(this.values(s), "full"); }

  /** The navigation of every flow, keyed by its path; null without flows. */
  private flows(): Values | null {
    const flows = this.hub.flows;
    if (flows.length === 0) return null;
    const out: Values = {};
    for (const f of flows) out[f.path] = f.snapshot();
    return out;
  }

  private values(s: Session): Values {
    const values = this.hub.root.getValues();
    if (s.pick?.length) {
      const out: Values = {};
      for (const k of s.pick) if (k in values) out[k] = values[k];
      return out;
    }
    if (s.omit?.length) for (const k of s.omit) delete values[k];
    return values;
  }

  /** The payload: the values, the flows' navigation, the window blobs of paginated root lists whose array is in it. */
  private withPages(values: Values, mode: PageMode): Values {
    const flows = this.flows();
    let blobs: Values | null = null;
    if (mode !== "none") {
      for (const list of this.hub.lists) {
        const pager = list.pager;
        if (!pager || list.item || !Array.isArray(valueAt(values, list.path))) continue;
        const blob = pager.serialize(mode === "pointer");
        if (blob) (blobs ??= {})[list.path] = blob;
      }
    }
    if (!flows && !blobs) return values;
    const out: Values = { ...values };
    if (flows) out[FLOWS_KEY] = flows;
    if (blobs) out[PAGINATION_KEY] = blobs;
    return out;
  }

  private report(s: Session, error: unknown, phase: "save" | "hydrate") {
    try { s.onError?.(error, phase); } catch { /* onError must not break the store */ }
  }
}

// ── hydration ───────────────────────────────────────────────────────────────

function valueAt(values: Values, path: string): unknown {
  let cur: unknown = values;
  for (const k of path.split(".")) cur = isPlainObject(cur) ? cur[k] : undefined;
  return cur;
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
