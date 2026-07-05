import { CONFIG_NODE, FLOW_STATE } from "../constants";
import type { Palistor } from "../store/palistor";
import type { FlowState } from "./flowState";

/** Stable steps-proxy cache — one per FlowState (like listProxyCache). */
const stepsProxyCache = new WeakMap<object, object>();

const NUMERIC_KEY = /^\d+$/;

/**
 * Proxy over the flow's step collection (flow.steps).
 *
 * Access:
 *   steps[0]        — by index (step array order)
 *   steps.welcome   — by key
 *   steps.current   — live reference to the active step's proxy
 *   steps.length    — number of steps
 *   [...steps]      — iteration over step proxies
 *
 * Step proxies are regular group proxies of the step nodes (cached in
 * proxyCache), enriched with `status` in the group GET trap (via stepToFlow).
 */
export function buildFlowStepsProxy(flowState: FlowState, kernel: Palistor<any, any>): object {
  const cached = stepsProxyCache.get(flowState as unknown as object);
  if (cached) return cached;

  const buildStep = (index: number): object =>
    kernel.proxyBuilder.build(flowState.stepNodes[index]) as object;

  const spreadKeys = (): string[] => [...flowState.stepKeys, "current", "length"];

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Tracking brand: navigation bumps the FlowState version.
      if (key === FLOW_STATE) return flowState;
      // steps is not a config node; transparent to the tracking proxy.
      if (key === CONFIG_NODE) return undefined;

      if (typeof key === "symbol") {
        if (key === Symbol.iterator) {
          return function* () {
            for (let i = 0; i < flowState.stepNodes.length; i++) yield buildStep(i);
          };
        }
        return undefined;
      }

      if (key === "length") return flowState.stepNodes.length;
      if (key === "current") return buildStep(flowState.currentIndex);

      if (NUMERIC_KEY.test(key)) {
        const index = Number(key);
        return index < flowState.stepNodes.length ? buildStep(index) : undefined;
      }

      const index = flowState.stepKeys.indexOf(key);
      if (index !== -1) return buildStep(index);

      return undefined;
    },

    set() {
      // The step set is static — writes are forbidden.
      return false;
    },

    ownKeys() {
      return spreadKeys();
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!spreadKeys().includes(key)) return undefined;
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  stepsProxyCache.set(flowState as unknown as object, proxy);
  return proxy;
}
