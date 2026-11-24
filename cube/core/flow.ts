// ─────────────────────────────────────────────────────────────────────────────
// Flows (defineFlow): a form group whose children are ordered steps, plus
// navigation. Store's FlowState, its NodeRegistry hooks, the flow and steps
// proxies and flowNavigation, as two Cube subclasses:
//
//   • FlowCube — the group carrying the defineFlow marker (`__flowSteps`, the
//     step order). Navigation is the active step, the visit stack, the visited
//     set and the last errors, all behind one Signal (`nav`). Overrides
//     `loading` (any step pending), `isInvalid` (visited visible steps),
//     `submit` (errors land in flow.errors) and `restart` (a reset covering
//     the flow sends it back to the first step).
//   • StepCube — one step: `status` derived from `nav`, `isInvalid` live over
//     its own leaves (visits don't matter), `exempt` while hidden, so an
//     untaken branch never blocks a submit started above it.
//
// Entering a step: onEnter → the step's resolve if it is idle → onReady once
// that run lands (right away without a resolve, or with a result that came as
// `initialData`); both get the flow's values and the store, fire-and-forget.
// A held store (hub.held) enters nothing until store.start(). Navigation is not a
// value: it never enters values or payloads. Persist keeps it under `__flows`
// (persist.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { isPlainObject, type CubeConfig, type SubmitError, type SubmitResult } from "./config";
import { Cube, registerFlow } from "./cube";
import type { Hub } from "./hub";
import { stepsNode, type PublicNode } from "./node";
import type { ResolveState } from "./resolve";
import { Signal, track, untracked } from "./track";

/** The defineFlow marker on a flow's config: the ordered step keys. A service key (CONFIG_PROPS). */
export const FLOW_STEPS_PROP = "__flowSteps";

export type StepStatus = "active" | "completed" | null;

/** Persisted navigation of one flow (store's FlowNavSnapshot). Step statuses are derived, never stored. */
export interface FlowNavSnapshot {
  currentStepKey: string;
  visitStack: string[];
  visitedKeys: string[];
}

export class FlowCube extends Cube {
  /** Navigation version: active step, visit stack, visited set, errors. */
  readonly nav = new Signal();
  private index = 0;
  private stack: string[] = [];
  private visited: Set<string>;
  private errors_: SubmitError[] = [];
  private steps_?: StepCube[];
  private stepsNode_?: PublicNode;

  constructor(config: CubeConfig, parent: Cube | null, key: string, hub: Hub) {
    super(config, parent, key, hub);
    this.visited = new Set([this.stepKeys[0]]);
  }

  override get flowRole(): "flow" { return "flow"; }

  /** Read from the config: also valid while the base constructor builds the children. */
  get stepKeys(): string[] { return this.config[FLOW_STEPS_PROP] as string[]; }

  get steps(): StepCube[] {
    return (this.steps_ ??= this.stepKeys.map((k) => this.children.get(k) as StepCube));
  }

  /** flow.steps: by index, by key, `current`, `length`, iteration. */
  get stepsNode(): PublicNode { return (this.stepsNode_ ??= stepsNode(this)); }

  protected override makeChild(config: CubeConfig, key: string): Cube {
    return this.stepKeys.includes(key) ? new StepCube(config, this, key, this.hub) : super.makeChild(config, key);
  }

  // ── navigation state ─────────────────────────────────────────────────────

  get currentStepKey(): string { track(this.nav); return this.stepKeys[this.index]; }
  get currentStepIndex(): number { track(this.nav); return this.index; }
  get canGoBack(): boolean { track(this.nav); return this.stack.length > 0; }
  get history(): string[] { track(this.nav); return [...this.stack, this.stepKeys[this.index]]; }
  get errors(): SubmitError[] { track(this.nav); return this.errors_; }
  get current(): StepCube { track(this.nav); return this.steps[this.index]; }

  statusOf(step: StepCube): StepStatus {
    track(this.nav);
    const i = this.steps.indexOf(step);
    if (i === this.index) return "active";
    return this.visited.has(step.key) ? "completed" : null;
  }

  /** Composite: true while any step's resolve is pending. */
  override get loading(): boolean {
    for (const s of this.steps) if (s.loading === true) return true;
    return false;
  }

  /** Any error in a visited visible step. */
  override get isInvalid(): boolean {
    return this.memo("flowInvalid", () => this.collect().length > 0);
  }

  /** Errors of the visited visible steps, paths relative to the flow ("step.field"), as on flow.submit(). */
  private collect(): SubmitError[] {
    track(this.nav);
    const out: SubmitError[] = [];
    this.steps.forEach((s, i) => {
      if (this.visited.has(this.stepKeys[i]) && s.isVisible !== false) s.collectInto(out, s.key);
    });
    return out;
  }

  /** flow.validate(): the errors of the visited visible steps, kept in flow.errors. Empty = valid. */
  validate(): SubmitError[] {
    const errors = untracked(() => this.collect());
    this.hub.batch(() => { this.errors_ = errors; this.changed(); });
    return errors;
  }

  /** flow.submit(): the group submit over every step (hidden ones exempt); validation errors land in flow.errors. */
  override async submit(): Promise<SubmitResult> {
    const result = await super.submit();
    this.hub.batch(() => { this.errors_ = result.success ? [] : result.errors; this.changed(); });
    return result;
  }

  /** The next visible step in order; past the last one, finalize through flow.submit(). */
  nextStep(): void {
    const next = untracked(() => this.steps.findIndex((s, i) => i > this.index && s.isVisible !== false));
    if (next === -1) { void this.submit(); return; }
    this.enter(next, true);
  }

  /** Back along the visit stack; a no-op when it is empty. */
  back(): void {
    const key = this.stack.pop();
    if (key === undefined) return;
    const target = this.stepKeys.indexOf(key);
    if (target === -1) { this.hub.batch(() => this.changed()); return; } // a stale key (hydrated from an older config)
    this.enter(target, false);
  }

  /** A jump by key or index; an unknown one throws (a typo), the active step is a no-op. */
  goTo(keyOrIndex: string | number): void {
    const keys = this.stepKeys;
    let target: number;
    if (typeof keyOrIndex === "number") {
      if (!Number.isInteger(keyOrIndex) || keyOrIndex < 0 || keyOrIndex >= keys.length) {
        throw new Error(`[palistor] flow.goTo(${keyOrIndex}): step index out of range (0..${keys.length - 1}).`);
      }
      target = keyOrIndex;
    } else {
      target = keys.indexOf(keyOrIndex);
      if (target === -1) {
        throw new Error(`[palistor] flow.goTo("${keyOrIndex}"): unknown step key. Steps: ${keys.join(", ")}.`);
      }
    }
    if (target !== this.index) this.enter(target, true);
  }

  /** `push`: nextStep / goTo put the step being left on the stack; back() has already popped it. */
  private enter(target: number, push: boolean) {
    const prevKey = this.stepKeys[this.index];
    // Held: the step being left is no longer the one store.start() enters.
    const left = this.hub.held ? this.steps[this.index].rs : undefined;
    if (left) this.hub.deferred.delete(left);
    this.hub.batch(() => {
      if (push) this.stack.push(prevKey);
      this.index = target;
      this.visited.add(prevKey);
      this.visited.add(this.stepKeys[target]);
      this.changed();
    });
    this.enterCurrent();
  }

  /** The active step's entry lifecycle: at construction, after a navigation, a reset, a hydration. */
  enterCurrent(): void {
    const step = this.steps[this.index];
    const hub = this.hub;
    // Held: no callback, no request. store.start() enters the step; until then its resolve reads as loading.
    if (hub.held) {
      if (step.rs?.status === "idle") hub.deferred.add(step.rs);
      return;
    }
    const values = this.values;
    const store = hub.store;
    fire(step.config.onEnter, values, store);
    const ready = () => fire(step.config.onReady, values, store);
    const rs = step.rs;
    if (!rs) { ready(); return; }
    // A result that came as initialData has met no entry yet: this one answers it, also when a
    // dependency has restarted the resolve since (then once that run lands).
    const state = rs as Partial<ResolveState>;
    const seeded = state.seeded === true;
    state.seeded = false;
    // Pending: started by another entry, which fires onReady. Resolved or failed: cached, no second onReady.
    if (rs.status !== "idle") {
      if (!seeded) return;
    } else rs.start();
    if (rs.promise) void rs.promise.then(ready, () => {});
    else ready();
  }

  /** A reset covering the flow: the first step again, nothing visited, step resolves idle, the entry lifecycle anew. */
  protected override restart(): void {
    this.hub.batch(() => {
      this.index = 0;
      this.stack = [];
      this.visited = new Set([this.stepKeys[0]]);
      this.errors_ = [];
      for (const s of this.steps) (s.rs as ResolveState | undefined)?.reset();
      this.changed();
    });
    this.enterCurrent();
  }

  private changed() { this.nav.bump(); this.hub.touch(); }

  protected override signature(): unknown[] {
    const sig = super.signature();
    track(this.nav);
    sig.push(this.nav.version, this.loading, this.isInvalid);
    return sig;
  }

  // ── persist ──────────────────────────────────────────────────────────────

  snapshot(): FlowNavSnapshot {
    return { currentStepKey: this.stepKeys[this.index], visitStack: [...this.stack], visitedKeys: [...this.visited] };
  }

  /**
   * Hydration: unknown step keys are dropped, an unknown active step leaves
   * the flow as it is. True when the active step moved (its entry lifecycle
   * runs again once every value is back).
   */
  restore(snap: unknown): boolean {
    if (!isPlainObject(snap) || typeof snap.currentStepKey !== "string") return false;
    const keys = this.stepKeys;
    const target = keys.indexOf(snap.currentStepKey);
    if (target === -1) return false;
    const known = (k: unknown): k is string => typeof k === "string" && keys.includes(k);
    const moved = target !== this.index;
    this.index = target;
    this.stack = Array.isArray(snap.visitStack) ? snap.visitStack.filter(known) : [];
    this.visited = new Set(Array.isArray(snap.visitedKeys) ? snap.visitedKeys.filter(known) : []);
    this.visited.add(snap.currentStepKey);
    this.errors_ = [];
    this.changed();
    return moved;
  }
}

export class StepCube extends Cube {
  override get flowRole(): "step" { return "step"; }

  get flow(): FlowCube { return this.parent as FlowCube; }

  get status(): StepStatus { return this.flow.statusOf(this); }

  /** Live, over the step's own leaves: neither visits nor its own visibility matter. */
  override get isInvalid(): boolean {
    return this.memo("stepInvalid", () => {
      const out: SubmitError[] = [];
      this.collectInto(out, "");
      return out.length > 0;
    });
  }

  protected override get exempt(): boolean { return this.isVisible === false; }

  /** store's collectStepErrors: every visible leaf below (lists skipped), validated as on submit. */
  collectInto(out: SubmitError[], prefix: string) {
    const walk = (c: Cube, base: string) => {
      for (const [k, child] of c.children) {
        const path = base ? `${base}.${k}` : k;
        if (child.kind === "group") walk(child, path);
        else if (child.kind === "leaf" && child.isVisible !== false) {
          const message = child.rawError;
          if (message) out.push({ path, message });
        }
      }
    };
    walk(this, prefix);
  }

  protected override signature(): unknown[] {
    const sig = super.signature();
    sig.push(this.status, this.isInvalid);
    return sig;
  }
}

/** Lifecycle callbacks are fire-and-forget: a throw or a rejection never reaches navigation. */
function fire(cb: unknown, values: unknown, store: unknown) {
  if (typeof cb !== "function") return;
  try {
    void Promise.resolve(cb(values, store)).catch(() => {});
  } catch { /* swallowed, as in store */ }
}

registerFlow((config, parent, key, hub) => {
  const marker = config[FLOW_STEPS_PROP];
  if (!Array.isArray(marker)) return null;
  for (const k of marker) {
    const step = config[k];
    if (!isPlainObject(step) || "value" in step) {
      throw new Error(`[palistor] defineFlow: step "${k}" is not a group node in the flow config.`);
    }
  }
  return new FlowCube(config, parent, key, hub);
});
