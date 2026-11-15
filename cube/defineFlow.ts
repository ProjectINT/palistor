import { CONFIG_PROPS, FLOW_STEPS_PROP, type CubeConfig } from "./core";

/** Result of defineStep: a group config and its key in the flow (store's FlowStep). */
export interface FlowStep {
  readonly key: string;
  readonly config: CubeConfig;
}

/**
 * Names a step cannot take: service keys, the group's spread keys and the
 * flow's (store's RESERVED_STEP_KEYS). The flow node answers them itself, and
 * `current` / `length` belong to flow.steps.
 */
const RESERVED_STEP_KEYS = new Set<string>([
  ...CONFIG_PROPS,
  "value", "submitting", "dirty", "revalidate", "loading", "values", "submit", "reset",
  "currentStepKey", "currentStepIndex", "canGoBack", "history", "errors", "steps", "nextStep", "back", "goTo", "validate",
  "setValues", "current", "length",
]);

/** `status` is the step's computed navigation status: a config field cannot take it. */
const RESERVED_STEP_CONFIG_KEYS = ["status"];

/** A group config as a flow step; `onEnter` / `onReady` are its entry lifecycle. Same checks and messages as store. */
export function defineStep(key: string, config: CubeConfig): FlowStep {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("[palistor] defineStep: key must be a non-empty string.");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`[palistor] defineStep("${key}"): config must be a plain object (group node).`);
  }
  if ("value" in config) {
    throw new Error(`[palistor] defineStep("${key}"): step config must be a group node — a "value" key makes it a leaf.`);
  }
  for (const reserved of RESERVED_STEP_CONFIG_KEYS) {
    if (reserved in config) {
      throw new Error(
        `[palistor] defineStep("${key}"): "${reserved}" is reserved — the flow exposes it as a computed step property.`,
      );
    }
  }
  return { key, config };
}

interface DefineFlowOptions {
  steps: readonly FlowStep[];
  onSubmit?: CubeConfig["onSubmit"];
  beforeSubmit?: CubeConfig["beforeSubmit"];
  afterSubmit?: CubeConfig["afterSubmit"];
}

/**
 * A flow node: a plain group whose children are the steps under their keys,
 * plus the `__flowSteps` marker with their order (a service key, never a
 * child or a value). The store makes it a FlowCube (cube/core/flow.ts).
 */
export function defineFlow(options: DefineFlowOptions): CubeConfig {
  const { steps, onSubmit, beforeSubmit, afterSubmit } = options;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("[palistor] defineFlow: `steps` must be a non-empty array of defineStep(...) results.");
  }
  const node: CubeConfig = {};
  const keys: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || typeof step.key !== "string" || !step.config) {
      throw new Error("[palistor] defineFlow: each entry of `steps` must be created via defineStep(key, config).");
    }
    if (RESERVED_STEP_KEYS.has(step.key)) {
      throw new Error(`[palistor] defineFlow: step key "${step.key}" is reserved by the flow/group proxy API.`);
    }
    if (keys.includes(step.key)) throw new Error(`[palistor] defineFlow: duplicate step key "${step.key}".`);
    node[step.key] = step.config;
    keys.push(step.key);
  }
  if (onSubmit) node.onSubmit = onSubmit;
  if (beforeSubmit) node.beforeSubmit = beforeSubmit;
  if (afterSubmit) node.afterSubmit = afterSubmit;
  node[FLOW_STEPS_PROP] = keys;
  return node;
}
