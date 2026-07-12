/**
 * PersistManager — manages hydration and auto-saving of form state.
 *
 * Instantiated inside Palistor.
 * React-independent — can be wired up from any environment.
 *
 * Lifecycle:
 *   1. Created by new Palistor(...) (inactive).
 *   2. Activated via enable(options) — hydration + auto-save.
 *   3. Deactivated via disable() — unsubscribes from the store, cancels timers.
 */

import type { PersistDriver, PersistOptions } from "./types";
import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify } from "../compute/recompute";
import type { Palistor } from "../store/palistor";
import {
  restoreFlowNav,
  runFlowEntryLifecycle,
  serializeFlowNav,
  type FlowNavSnapshot,
} from "../flow/flowNavigation";

/**
 * Reserved persist-snapshot key for flow navigation (defineFlow):
 * `{ [flowPath]: { currentStepKey, visitStack, visitedKeys } }`.
 * Step field values are stored as regular values; step statuses are not
 * saved — derived from navigation on hydrate.
 */
const FLOWS_PERSIST_KEY = "__flows";

// ─── Field filtering ─────────────────────────────────────────────────────────

/**
 * Filter values by pick/omit.
 * pick takes priority. When neither is set — everything is returned.
 */
function filterValues(
  values: Record<string, unknown>,
  pick?: string[],
  omit?: string[],
): Record<string, unknown> {
  if (pick && pick.length > 0) {
    const result: Record<string, unknown> = {};
    for (const key of pick) {
      if (key in values) result[key] = values[key];
    }
    return result;
  }

  if (omit && omit.length > 0) {
    const omitSet = new Set(omit);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(values)) {
      if (!omitSet.has(key)) result[key] = values[key];
    }
    return result;
  }

  return values;
}

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * The form's persistence manager.
 *
 * Accesses all form data through the `kernel` (Palistor instance).
 */
export class PersistManager {
  private readonly kernel: Palistor<any, any>;

  // ─── Internal state ───────────────────────────────────────────────────────

  private active = false;
  private currentKey: string | null = null;
  private currentDriver: PersistDriver | null = null;
  private serialize: (v: Record<string, unknown>) => string = JSON.stringify;
  private deserialize: (raw: string) => Record<string, unknown> = JSON.parse;
  private debounceMs = 100;
  private pickFields: string[] | undefined;
  private omitFields: string[] | undefined;

  /** Unsubscribe from subscribeGlobal. */
  private unsubscribe: (() => void) | null = null;

  /** Debounce timer ID. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flag preventing saves during hydration. */
  private isHydrating = false;

  /**
   * Hydration generation. Bumped by enable()/disable(); an in-flight
   * hydrateFromStorage run applies its result only if the generation it
   * captured at start is still current (guards against a superseded enable()'s
   * slow hydration landing over a newer one).
   */
  private hydrationGeneration = 0;

  constructor(kernel: Palistor<any, any>) {
    this.kernel = kernel;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private cancelDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Save the current values to storage (no debounce).
   */
  private async saveToStorage(): Promise<void> {
    if (!this.active || !this.currentKey || !this.currentDriver) return;

    const allValues = this.kernel.getValues() as Record<string, unknown>;
    const filtered = filterValues(allValues, this.pickFields, this.omitFields);

    // Flow: navigation is stored under a separate reserved key, not subject
    // to pick/omit (it is not a form field).
    const flowNav = serializeFlowNav(this.kernel);
    const payload = flowNav ? { ...filtered, [FLOWS_PERSIST_KEY]: flowNav } : filtered;

    try {
      const serialized = this.serialize(payload);
      await Promise.resolve(this.currentDriver.setItem(this.currentKey, serialized));
    } catch {
      // Serialization/write errors are silenced (production-safe)
    }
  }

  /**
   * Schedule a debounced save.
   */
  private scheduleSave = (): void => {
    if (!this.active || this.isHydrating) return;

    this.cancelDebounce();

    if (this.debounceMs <= 0) {
      this.saveToStorage();
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.saveToStorage();
    }, this.debounceMs);
  };

  /**
   * Read from storage and apply the values to nodeState.
   */
  private async hydrateFromStorage(): Promise<void> {
    if (!this.currentKey || !this.currentDriver) return;

    // Capture the generation this run belongs to. enable()/disable() bump it,
    // so a hydration that was superseded while awaiting getItem must NOT apply
    // its (now stale, possibly other-key) payload — otherwise a slower driver
    // wins over a newer enable() and the next autosave writes the old key's
    // data into the new key.
    const gen = this.hydrationGeneration;
    this.isHydrating = true;

    try {
      const raw = await Promise.resolve(this.currentDriver.getItem(this.currentKey));
      if (gen !== this.hydrationGeneration) return; // superseded while awaiting
      if (raw === null) return;

      const values = this.deserialize(raw);
      if (!values || typeof values !== "object") return;

      // Flow: extract the navigation snapshot before applying the values patch.
      const flowSnapshots = (values as Record<string, unknown>)[FLOWS_PERSIST_KEY] as
        | Record<string, FlowNavSnapshot>
        | undefined;
      if (flowSnapshots !== undefined) {
        delete (values as Record<string, unknown>)[FLOWS_PERSIST_KEY];
      }

      // Apply as a patch — applyPatch walks the config tree recursively
      // (scalar/group fields; list nodes are skipped).
      const patchedNodes = applyPatch(
        this.kernel.rootConfig,
        this.kernel.nodes.nodeState,
        values,
        new Set(),
      );

      // Restore root and per-entity list membership from the snapshot.
      // No-op for configs without lists (graceful for older snapshots).
      const listChanged = this.kernel.restoreLists(values);
      for (const n of listChanged) patchedNodes.add(n);

      // Flow: restore navigation (active step, stack, visited).
      // Step statuses are recomputed from the navigation state.
      let enteredFlows: ReturnType<typeof restoreFlowNav>["entered"] = [];
      if (flowSnapshots && typeof flowSnapshots === "object") {
        const { changed: flowChanged, entered } = restoreFlowNav(this.kernel, flowSnapshots);
        for (const n of flowChanged) patchedNodes.add(n);
        enteredFlows = entered;
      }

      // Recompute, merge, and notify subscribers
      recomputeAndNotify(
        patchedNodes,
        () => this.kernel.recompute(),
        (c) => this.kernel.notifyChanged(c),
      );

      // Flow: when the active step changed during hydration — the restored
      // step is "entered" anew: onEnter → resolve → onReady.
      for (const flowState of enteredFlows) {
        runFlowEntryLifecycle(this.kernel, flowState);
      }
    } catch {
      // Deserialization errors are silenced
    } finally {
      // Only the CURRENT run may clear the flag — a superseded run finishing
      // late must not unmark a newer hydration that is still in flight.
      if (gen === this.hydrationGeneration) this.isHydrating = false;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Activate persistence: hydrate from storage + auto-save on changes.
   *
   * When persist is already active, the previous one is disabled first.
   * Returns a Promise that resolves after successful hydration.
   */
  enable(options: PersistOptions): Promise<void> {
    // Already active — disable the previous one
    if (this.active) this.disable();

    // Invalidate any hydration still in flight from a previous enable()
    this.hydrationGeneration++;

    // Store the settings
    this.currentKey = options.key;
    this.currentDriver = options.driver;
    this.serialize = options.serialize ?? JSON.stringify;
    this.deserialize = options.deserialize ?? JSON.parse;
    this.debounceMs = options.debounce ?? 100;
    this.pickFields = options.pick as string[] | undefined;
    this.omitFields = options.omit as string[] | undefined;
    this.active = true;

    // Subscribe to changes for auto-save
    this.unsubscribe = this.kernel.hub.subscribeGlobal(this.scheduleSave);

    // Hydrate
    return this.hydrateFromStorage();
  }

  /** Deactivate: unsubscribe from the store, cancel timers, clear state. */
  disable(): void {
    this.active = false;
    this.cancelDebounce();

    // Abort an in-flight hydration (it checks the generation before applying)
    // and clear the flag it would otherwise leave dangling.
    this.hydrationGeneration++;
    this.isHydrating = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.currentKey = null;
    this.currentDriver = null;
  }

  /** Force-save the current values to storage (no debounce). */
  async flush(): Promise<void> {
    // Nothing meaningful to save before hydration completed — saving here
    // would overwrite the stored snapshot with the not-yet-hydrated (empty)
    // values. isHydrating guards the debounced scheduleSave; guard flush too.
    if (this.isHydrating) return;
    this.cancelDebounce();
    await this.saveToStorage();
  }

  /** Force-hydrate from storage. */
  async hydrate(): Promise<void> {
    await this.hydrateFromStorage();
  }

  /** Remove the data from storage under the current key. */
  async clear(): Promise<void> {
    if (!this.currentKey || !this.currentDriver) return;

    try {
      await Promise.resolve(this.currentDriver.removeItem(this.currentKey));
    } catch {
      // noop
    }
  }

  /** Whether persistence is currently active. */
  isEnabled(): boolean {
    return this.active;
  }
}
