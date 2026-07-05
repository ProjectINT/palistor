import {
  CONFIG_PROPS,
  FLOW_SPREAD_KEYS,
  FLOW_STEPS_PROP,
  GROUP_SPREAD_KEYS,
} from "../constants";
import type { ExtractValues, ProxyStore } from "../store/types";

// ─── Step types ───────────────────────────────────────────────────────────────

/**
 * Flow step status — a computed step-proxy property derived from navigation
 * state (currentStepKey + visited set). Not a leaf node: never appears in
 * values, submit payloads or persisted state.
 *
 * - `null`        — the step has not been visited yet
 * - `"active"`    — the current step
 * - `"completed"` — was active, then left (forward or back)
 */
export type StepStatus = "active" | "completed" | null;

/** Flow validation error — same shape as in SubmitResult. */
export interface FlowError {
  path: string;
  message: string;
}

/**
 * Result of defineStep: the step's group config + its key within the flow.
 * defineFlow expands steps into regular child groups of the flow node.
 */
export interface FlowStep<
  K extends string = string,
  C extends Record<string, any> = Record<string, any>,
> {
  readonly key: K;
  readonly config: C;
}

export type AnyFlowStep = FlowStep<string, Record<string, any>>;

/** Flow values — all steps by key (accumulated state). */
export type FlowValues<S extends readonly AnyFlowStep[]> = {
  [Step in S[number] as Step["key"]]: ExtractValues<Step["config"]>;
};

// ─── FlowNode (brand) ─────────────────────────────────────────────────────────

declare const __flowBrand: unique symbol;

/**
 * A flow node in the config tree: a regular group (steps are child groups by
 * key), branded with the step tuple for proxy type inference.
 */
export type FlowNode<S extends readonly AnyFlowStep[]> = {
  readonly [__flowBrand]: S;
} & {
  [Step in S[number] as Step["key"]]: Step["config"];
};

/** Extract the step tuple from a FlowNode (never when the node is not a flow). */
export type InferFlowSteps<T> = T extends { readonly [__flowBrand]: infer S extends readonly AnyFlowStep[] }
  ? S
  : never;

// ─── defineStep ───────────────────────────────────────────────────────────────

/**
 * The name `status` is reserved on the step proxy for the computed step
 * status — a config field with that name is forbidden (like dirty/loading).
 */
const RESERVED_STEP_CONFIG_KEYS = new Set(["status"]);

/**
 * Wrap a group config into a flow step.
 *
 * A step config is a regular Palistor group node (fields, isVisible,
 * validate, resolve, onSubmit, …) plus the flow lifecycle callbacks
 * `onEnter` / `onReady`.
 *
 * @example
 * defineStep("welcome", {
 *   name: { value: "", isRequired: true },
 *   onSubmit: async (values, store, { nextStep }) => { nextStep(); },
 * })
 */
export function defineStep<const K extends string, const C extends Record<string, any>>(
  key: K,
  config: C & { status?: never },
): FlowStep<K, C> {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("[palistor] defineStep: key must be a non-empty string.");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`[palistor] defineStep("${key}"): config must be a plain object (group node).`);
  }
  if ("value" in config) {
    throw new Error(
      `[palistor] defineStep("${key}"): step config must be a group node — a "value" key makes it a leaf.`,
    );
  }
  for (const reserved of RESERVED_STEP_CONFIG_KEYS) {
    if (reserved in config) {
      throw new Error(
        `[palistor] defineStep("${key}"): "${reserved}" is reserved — the flow exposes it as a computed step property.`,
      );
    }
  }
  return { key, config: config as C };
}

// ─── defineFlow ───────────────────────────────────────────────────────────────

/**
 * Step keys that conflict with flow-proxy / steps-proxy properties or service
 * config keys — forbidden as step names.
 */
const RESERVED_STEP_KEYS = new Set<string>([
  ...CONFIG_PROPS,
  ...GROUP_SPREAD_KEYS,
  ...FLOW_SPREAD_KEYS,
  "setValues",
  "current",
  "length",
]);

export interface DefineFlowOptions<S extends readonly AnyFlowStep[]> {
  /** Ordered array of steps (defineStep). The order drives nextStep(). */
  steps: S;
  /** Flow-level submit: invoked by the standard submit pipeline over all steps. */
  onSubmit?: (
    values: FlowValues<S>,
    store: ProxyStore<any>,
    parent?: any,
  ) => Promise<unknown> | unknown;
  /** Group-level value transformation before submit. */
  beforeSubmit?: (values: FlowValues<S>) => FlowValues<S> | Promise<FlowValues<S>>;
  /** Post-processing after a successful onSubmit. */
  afterSubmit?: (result: unknown, actions: { reset: () => void }) => void | Promise<void>;
}

/**
 * Build a flow node from an ordered array of steps.
 *
 * The returned node is a regular group in the config tree (steps become child
 * groups under their keys), stamped with the {@link FLOW_STEPS_PROP} marker
 * holding the step order. It participates in values / persist / dirty like
 * any group; NodeRegistry creates a FlowState (navigation, statuses, history)
 * based on the marker.
 *
 * @example
 * const onboarding = defineFlow({
 *   steps: [
 *     defineStep("welcome", { name: { value: "", isRequired: true } }),
 *     defineStep("summary", {}),
 *   ],
 *   onSubmit: async (allValues, store) => api.completeOnboarding(allValues),
 * });
 */
export function defineFlow<const S extends readonly AnyFlowStep[]>(
  options: DefineFlowOptions<S>,
): FlowNode<S> {
  const { steps, onSubmit, beforeSubmit, afterSubmit } = options;

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("[palistor] defineFlow: `steps` must be a non-empty array of defineStep(...) results.");
  }

  const node: Record<string, unknown> = {};
  const stepKeys: string[] = [];

  for (const step of steps as readonly AnyFlowStep[]) {
    if (!step || typeof step !== "object" || typeof step.key !== "string" || !step.config) {
      throw new Error("[palistor] defineFlow: each entry of `steps` must be created via defineStep(key, config).");
    }
    if (RESERVED_STEP_KEYS.has(step.key)) {
      throw new Error(`[palistor] defineFlow: step key "${step.key}" is reserved by the flow/group proxy API.`);
    }
    if (stepKeys.includes(step.key)) {
      throw new Error(`[palistor] defineFlow: duplicate step key "${step.key}".`);
    }
    node[step.key] = step.config;
    stepKeys.push(step.key);
  }

  if (onSubmit) node.onSubmit = onSubmit;
  if (beforeSubmit) node.beforeSubmit = beforeSubmit;
  if (afterSubmit) node.afterSubmit = afterSubmit;

  // Flow marker: part of CONFIG_PROPS → all tree walks skip it.
  node[FLOW_STEPS_PROP] = stepKeys;

  return node as unknown as FlowNode<S>;
}
