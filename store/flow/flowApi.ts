import type { Palistor } from "../store/palistor";
import type { SubmitResult } from "../submitPipeline/types";
import type { FlowError } from "./defineFlow";
import type { FlowState } from "./flowState";
import {
  flowBack,
  flowGoTo,
  flowNextStep,
  flowSubmit,
  flowValidate,
} from "./flowNavigation";

/**
 * Navigation methods of the flow proxy. All are closures bound over
 * (kernel, flowState), so destructuring in onSubmit works:
 * `(values, store, { nextStep }) => …`.
 */
export interface FlowApi {
  nextStep: () => void;
  back: () => void;
  goTo: (keyOrIndex: string | number) => void;
  validate: () => FlowError[];
  submit: () => Promise<SubmitResult>;
}

/** Stable method references — one FlowApi per FlowState (for React). */
const flowApiCache = new WeakMap<object, FlowApi>();

export function getFlowApi(kernel: Palistor<any, any>, flowState: FlowState): FlowApi {
  const cached = flowApiCache.get(flowState as unknown as object);
  if (cached) return cached;

  const api: FlowApi = {
    nextStep: () => flowNextStep(kernel, flowState),
    back: () => flowBack(kernel, flowState),
    goTo: (keyOrIndex: string | number) => flowGoTo(kernel, flowState, keyOrIndex),
    validate: () => flowValidate(kernel, flowState),
    submit: () => flowSubmit(kernel, flowState),
  };

  flowApiCache.set(flowState as unknown as object, api);
  return api;
}
