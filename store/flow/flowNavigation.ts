import { computeFieldState } from "../compute";
import { walkFull } from "../traversal";
import { resetResolveState } from "../resolvePipeline";
import type { AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import type { SubmitResult } from "../submitPipeline/types";
import type { FlowError, StepStatus } from "./defineFlow";
import type { FlowState } from "./flowState";

type Kernel = Palistor<any, any>;

// ─── Derived state ────────────────────────────────────────────────────────────

/** Step status — derived from navigation state (not stored). */
export function getStepStatus(flowState: FlowState, stepNode: object): StepStatus {
  const idx = flowState.stepNodes.indexOf(stepNode as AnyConfigNode);
  if (idx === -1) return null;
  if (idx === flowState.currentIndex) return "active";
  return flowState.visitedKeys.has(flowState.stepKeys[idx]) ? "completed" : null;
}

/** Step visibility — from the group's computed FieldState (isVisible is reactive). */
export function isStepVisible(kernel: Kernel, stepNode: object): boolean {
  return kernel.nodes.nodeState.get(stepNode)?.isVisible !== false;
}

/** Composite flow loading: true when at least one step is resolving. */
export function flowLoading(kernel: Kernel, flowState: FlowState): boolean {
  for (const stepNode of flowState.stepNodes) {
    if (kernel.nodes.nodeState.get(stepNode as object)?.loading === true) return true;
  }
  return false;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Collect leaf errors of a step's subtree. Validation is computed "live" via
 * computeFieldState(revalidate=true) — independent of the group's revalidate
 * flag (which only the submit pipeline sets). Hidden leaves are skipped.
 * Lists inside a step are skipped (parity with collectLeafStates).
 *
 * `basePath` — prefix for error paths. The flow passes the step KEY: paths
 * come out relative to the flow node ("welcome.name") — the same base the
 * submit pipeline uses for errors on flow.submit() (collectLeafStates builds
 * paths from the submitted node).
 */
export function collectStepErrors(
  kernel: Kernel,
  stepNode: AnyConfigNode,
  basePath = "",
): FlowError[] {
  const errors: FlowError[] = [];
  const { nodeState } = kernel.nodes;
  const translate = kernel.services.translate;

  walkFull(stepNode, {
    onLeaf(leaf, _key, path) {
      const state = nodeState.get(leaf);
      if (!state || state.isVisible === false) return;
      const groupValues =
        kernel.values.nodeSlot.get(leaf)?.parent ?? kernel.values.values;
      const computed = computeFieldState(
        leaf as Record<string, any>,
        state.value,
        groupValues,
        true,
        translate,
      );
      if (computed.isInvalid && computed.errorMessage) {
        errors.push({ path, message: computed.errorMessage });
      }
    },
  }, basePath);

  return errors;
}

/** Live aggregate of step validity (flow.steps.x.isInvalid). */
export function stepIsInvalid(kernel: Kernel, stepNode: AnyConfigNode): boolean {
  return collectStepErrors(kernel, stepNode).length > 0;
}

/**
 * Flow errors over visited visible steps (the scope of flow.validate()).
 * Hidden steps are always excluded — an untaken branch must not block.
 * Error paths are relative to the flow node ("stepKey.field") — same as
 * SubmitResult on flow.submit().
 */
export function collectFlowErrors(kernel: Kernel, flowState: FlowState): FlowError[] {
  const errors: FlowError[] = [];
  for (let i = 0; i < flowState.stepNodes.length; i++) {
    const stepNode = flowState.stepNodes[i];
    if (!flowState.visitedKeys.has(flowState.stepKeys[i])) continue;
    if (!isStepVisible(kernel, stepNode as object)) continue;
    errors.push(...collectStepErrors(kernel, stepNode, flowState.stepKeys[i]));
  }
  return errors;
}

/** Aggregate flow.isInvalid: any errors in visited visible steps. */
export function flowIsInvalid(kernel: Kernel, flowState: FlowState): boolean {
  return collectFlowErrors(kernel, flowState).length > 0;
}

/**
 * flow.validate(): collect errors of the visited steps, write them into the
 * reactive flow.errors and return them. Empty array = all valid.
 */
export function flowValidate(kernel: Kernel, flowState: FlowState): FlowError[] {
  const errors = collectFlowErrors(kernel, flowState);
  flowState.errors = errors;
  kernel.notifyChanged(new Set<object>([flowState as unknown as object, flowState.flowNode as object]));
  return errors;
}

/**
 * Filter out submit-pipeline errors from leaves under HIDDEN steps of any
 * flow: the base pipeline validates all leaves regardless of visibility, and
 * without this filter an untaken branch with isRequired fields would block
 * finalization forever.
 *
 * `submittedNode` — the node the submit ran for: pipeline error paths are
 * RELATIVE to it (collectLeafStates builds paths from the submitted node),
 * so the absolute paths of hidden steps are rebased to the same base.
 */
export function filterHiddenFlowStepErrors(
  kernel: Kernel,
  errors: Array<{ path: string; message: string }>,
  submittedNode: AnyConfigNode,
): Array<{ path: string; message: string }> {
  const flows = kernel.nodes.allFlowStates;
  if (flows.length === 0 || errors.length === 0) return errors;

  const basePath = submittedNode === kernel.rootConfig
    ? ""
    : kernel.nodes.nodePaths.get(submittedNode as object) ?? "";

  const hiddenPrefixes: string[] = [];
  for (const flowState of flows) {
    for (const stepNode of flowState.stepNodes) {
      if (isStepVisible(kernel, stepNode as object)) continue;
      const stepPath = kernel.nodes.nodePaths.get(stepNode as object);
      if (!stepPath) continue;
      if (basePath === "") {
        hiddenPrefixes.push(stepPath + ".");
      } else if (stepPath.startsWith(basePath + ".")) {
        hiddenPrefixes.push(stepPath.slice(basePath.length + 1) + ".");
      }
      // stepPath outside the submitted node's subtree — its leaves never appear in errors.
    }
  }
  if (hiddenPrefixes.length === 0) return errors;

  return errors.filter((e) => !hiddenPrefixes.some((prefix) => e.path.startsWith(prefix)));
}

// ─── Submit (finalization) ────────────────────────────────────────────────────

/**
 * flow.submit(): the standard group-submit pipeline over the flow node
 * (submitting → beforeSubmit → validate → onSubmit → afterSubmit; leaves of
 * hidden steps are filtered by the pipeline). Validation errors land in the
 * reactive flow.errors; on success errors are cleared.
 */
export async function flowSubmit(kernel: Kernel, flowState: FlowState): Promise<SubmitResult> {
  const result = await kernel.submitPipeline.execute(flowState.flowNode);
  flowState.errors = result.success ? [] : result.errors;
  kernel.notifyChanged(new Set<object>([flowState as unknown as object, flowState.flowNode as object]));
  return result;
}

// ─── Entry lifecycle ─────────────────────────────────────────────────────────

function fireCallback(cb: unknown, values: Record<string, unknown>, kernel: Kernel): void {
  if (typeof cb !== "function") return;
  try {
    void Promise.resolve((cb as (v: Record<string, unknown>, s: unknown) => unknown)(values, kernel))
      .catch(() => { /* fire-and-forget: lifecycle errors are swallowed */ });
  } catch {
    /* synchronous throws are swallowed too */
  }
}

/**
 * Step entry lifecycle: onEnter → resolve (eager) → onReady.
 *
 * - `onEnter` / `onReady` receive FLOW-scoped values (all steps by key) —
 *   the flow's live groupSlot reference; fire-and-forget.
 * - the step's resolve is a standard group resolve; the flow triggers it ON
 *   ENTRY (equivalent to first access). Already resolved/error (cached) — not
 *   re-run, and onReady is NOT invoked again.
 * - Without resolve — onReady fires right after onEnter.
 */
export function runEntryLifecycle(kernel: Kernel, flowState: FlowState, stepNode: AnyConfigNode): void {
  const flowValues =
    kernel.values.groupSlot.get(flowState.flowNode as object) ?? kernel.values.values;

  fireCallback((stepNode as Record<string, unknown>).onEnter, flowValues, kernel);

  const onReady = (stepNode as Record<string, unknown>).onReady;
  const fireReady = () => fireCallback(onReady, flowValues, kernel);

  const resolve = (stepNode as Record<string, unknown>).resolve as
    | { resolver?: unknown }
    | undefined;
  const hasResolve = !!resolve && typeof resolve.resolver === "function";

  if (!hasResolve) {
    fireReady();
    return;
  }

  const state = kernel.resolveManager.getResolveState(stepNode);
  if (state && state.status === "idle") {
    kernel.resolveManager.triggerResolve(stepNode);
    const after = kernel.resolveManager.getResolveState(stepNode);
    if (after?.promise) {
      void after.promise.then(fireReady).catch(() => {});
    } else {
      fireReady();
    }
  }
  // pending — the resolve was started by another entry (onReady attached there);
  // resolved / error — cached: onReady is not re-run.
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function notifyNavigation(kernel: Kernel, flowState: FlowState, prevNode: object, nextNode: object): void {
  const changed = new Set<object>([
    flowState as unknown as object,
    flowState.flowNode as object,
    prevNode,
    nextNode,
  ]);
  kernel.notifyChanged(changed);
}

/**
 * Common transition to step targetIndex.
 * `push: true`  — nextStep()/goTo() (the current key is pushed onto the stack);
 * `push: false` — back() (the stack was already popped by the caller).
 */
function enterStep(kernel: Kernel, flowState: FlowState, targetIndex: number, push: boolean): void {
  const prevIndex = flowState.currentIndex;
  const prevKey = flowState.stepKeys[prevIndex];
  const prevNode = flowState.stepNodes[prevIndex] as object;

  if (push) flowState.visitStack.push(prevKey);

  flowState.currentIndex = targetIndex;
  const nextKey = flowState.stepKeys[targetIndex];
  const nextNode = flowState.stepNodes[targetIndex];

  // The previous step becomes visited (status → "completed"), the new one is active.
  flowState.visitedKeys.add(prevKey);
  flowState.visitedKeys.add(nextKey);

  notifyNavigation(kernel, flowState, prevNode, nextNode as object);
  runEntryLifecycle(kernel, flowState, nextNode);
}

/**
 * nextStep(): the next VISIBLE step in array order; hidden ones are skipped.
 * When no visible steps remain ahead — finalize via flow.submit() (on
 * validation errors onSubmit is not called, errors land in flow.errors, the
 * step does not change).
 */
export function flowNextStep(kernel: Kernel, flowState: FlowState): void {
  for (let i = flowState.currentIndex + 1; i < flowState.stepNodes.length; i++) {
    if (isStepVisible(kernel, flowState.stepNodes[i] as object)) {
      enterStep(kernel, flowState, i, true);
      return;
    }
  }
  void flowSubmit(kernel, flowState);
}

/** back(): go back along the visit stack. No-op when the stack is empty (canGoBack). */
export function flowBack(kernel: Kernel, flowState: FlowState): void {
  if (flowState.visitStack.length === 0) return;
  const targetKey = flowState.visitStack.pop()!;
  const targetIndex = flowState.stepKeys.indexOf(targetKey);
  if (targetIndex === -1) return; // corrupted stack (hydrated against an older config)
  enterStep(kernel, flowState, targetIndex, false);
}

/**
 * goTo(keyOrIndex): arbitrary jump by key or index.
 * Unknown key/index — throws (catches typos during development).
 * Jumping to the current step is a no-op.
 */
export function flowGoTo(kernel: Kernel, flowState: FlowState, keyOrIndex: string | number): void {
  let targetIndex: number;
  if (typeof keyOrIndex === "number") {
    if (!Number.isInteger(keyOrIndex) || keyOrIndex < 0 || keyOrIndex >= flowState.stepKeys.length) {
      throw new Error(`[palistor] flow.goTo(${keyOrIndex}): step index out of range (0..${flowState.stepKeys.length - 1}).`);
    }
    targetIndex = keyOrIndex;
  } else {
    targetIndex = flowState.stepKeys.indexOf(keyOrIndex);
    if (targetIndex === -1) {
      throw new Error(`[palistor] flow.goTo("${keyOrIndex}"): unknown step key. Steps: ${flowState.stepKeys.join(", ")}.`);
    }
  }
  if (targetIndex === flowState.currentIndex) return;
  enterStep(kernel, flowState, targetIndex, true);
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/**
 * Reset flow navigation: the first step is active, the stack and visited set
 * are cleared, step resolve states go back to idle. The first step's entry
 * lifecycle (onEnter → resolve → onReady) runs anew — mirroring initialization.
 */
export function resetFlowNav(kernel: Kernel, flowState: FlowState): void {
  flowState.currentIndex = 0;
  flowState.visitStack = [];
  flowState.visitedKeys = new Set([flowState.stepKeys[0]]);
  flowState.errors = [];

  const changed = new Set<object>([flowState as unknown as object, flowState.flowNode as object]);
  for (const stepNode of flowState.stepNodes) {
    changed.add(stepNode as object);
    const resolve = (stepNode as Record<string, unknown>).resolve as { resolver?: unknown } | undefined;
    if (resolve && typeof resolve.resolver === "function") {
      resetResolveState(stepNode, kernel.resolveManager.states);
    }
  }
  kernel.notifyChanged(changed);
  runEntryLifecycle(kernel, flowState, flowState.stepNodes[0]);
}

/**
 * Reset navigation of all flows that fall into the reset subtree.
 * Called from ResetPipeline (root reset → all flows; group reset → flows inside it).
 */
export function resetFlowNavForSubtree(kernel: Kernel, groupNode: AnyConfigNode): void {
  const flows = kernel.nodes.allFlowStates;
  if (flows.length === 0) return;

  const basePath = groupNode === kernel.rootConfig
    ? ""
    : kernel.nodes.nodePaths.get(groupNode as object);
  if (basePath === undefined) return;

  for (const flowState of flows) {
    const within =
      basePath === "" ||
      flowState.path === basePath ||
      flowState.path.startsWith(basePath + ".");
    if (within) resetFlowNav(kernel, flowState);
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Initialization lifecycle: the first step of every flow is "entered" at
 * store creation (onEnter → resolve → onReady). Called from the Palistor
 * constructor.
 *
 * Also pre-warms the proxyCache of flow nodes: a step's identity view reads
 * parent.proxy from the cache on the first step.submit(), and the flow proxy
 * must already exist by then — otherwise the step's onSubmit would receive
 * undefined as its third argument.
 */
export function initFlows(kernel: Kernel): void {
  for (const flowState of kernel.nodes.allFlowStates) {
    kernel.proxyBuilder.build(flowState.flowNode);
    runEntryLifecycle(kernel, flowState, flowState.stepNodes[flowState.currentIndex]);
  }
}

// ─── Persist ─────────────────────────────────────────────────────────────────

/** Flow navigation snapshot in the persist payload (field values are stored separately). */
export interface FlowNavSnapshot {
  currentStepKey: string;
  visitStack: string[];
  visitedKeys: string[];
}

/**
 * Serialize navigation of all flows for persist: key — the flow node's dot-path.
 * Step statuses are not saved — they are derived from navigation on hydrate.
 */
export function serializeFlowNav(kernel: Kernel): Record<string, FlowNavSnapshot> | null {
  const flows = kernel.nodes.allFlowStates;
  if (flows.length === 0) return null;
  const out: Record<string, FlowNavSnapshot> = {};
  for (const flowState of flows) {
    out[flowState.path] = {
      currentStepKey: flowState.stepKeys[flowState.currentIndex],
      visitStack: [...flowState.visitStack],
      visitedKeys: [...flowState.visitedKeys],
    };
  }
  return out;
}

/**
 * Restore flow navigation from a persist snapshot. Unknown step keys (the
 * config changed) are dropped; an incompatible currentStepKey leaves the flow
 * in its current state. Returns the changed nodes for notify and the flows
 * whose active step changed (for a repeated entry lifecycle).
 */
export function restoreFlowNav(
  kernel: Kernel,
  snapshots: Record<string, FlowNavSnapshot>,
): { changed: Set<object>; entered: FlowState[] } {
  const changed = new Set<object>();
  const entered: FlowState[] = [];

  for (const flowState of kernel.nodes.allFlowStates) {
    const snap = snapshots[flowState.path];
    if (!snap || typeof snap !== "object" || typeof snap.currentStepKey !== "string") continue;

    const targetIndex = flowState.stepKeys.indexOf(snap.currentStepKey);
    if (targetIndex === -1) continue;

    const isKnownKey = (k: unknown): k is string =>
      typeof k === "string" && flowState.stepKeys.includes(k);

    const prevIndex = flowState.currentIndex;
    flowState.currentIndex = targetIndex;
    flowState.visitStack = Array.isArray(snap.visitStack)
      ? snap.visitStack.filter(isKnownKey)
      : [];
    flowState.visitedKeys = new Set(
      Array.isArray(snap.visitedKeys) ? snap.visitedKeys.filter(isKnownKey) : [],
    );
    flowState.visitedKeys.add(snap.currentStepKey);
    flowState.errors = [];

    changed.add(flowState as unknown as object);
    changed.add(flowState.flowNode as object);
    for (const stepNode of flowState.stepNodes) changed.add(stepNode as object);

    if (prevIndex !== targetIndex) entered.push(flowState);
  }

  return { changed, entered };
}

/** Entry lifecycle of the current step (used by persist after hydration). */
export function runFlowEntryLifecycle(kernel: Kernel, flowState: FlowState): void {
  runEntryLifecycle(kernel, flowState, flowState.stepNodes[flowState.currentIndex]);
}
