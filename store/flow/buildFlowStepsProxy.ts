import { CONFIG_NODE, FLOW_STATE } from "../constants";
import type { Palistor } from "../store/palistor";
import type { FlowState } from "./flowState";

/** Стабильный кэш steps-proxy — один на FlowState (как listProxyCache). */
const stepsProxyCache = new WeakMap<object, object>();

const NUMERIC_KEY = /^\d+$/;

/**
 * Proxy коллекции шагов флоу (flow.steps).
 *
 * Доступ:
 *   steps[0]        — по индексу (порядок массива шагов)
 *   steps.welcome   — по ключу
 *   steps.current   — живая ссылка на прокси активного шага
 *   steps.length    — число шагов
 *   [...steps]      — итерация по step-прокси
 *
 * Step-прокси — обычные group-прокси step-нод (кэшируются в proxyCache),
 * обогащённые `status` в group GET-трапе (через stepToFlow).
 */
export function buildFlowStepsProxy(flowState: FlowState, kernel: Palistor<any, any>): object {
  const cached = stepsProxyCache.get(flowState as unknown as object);
  if (cached) return cached;

  const buildStep = (index: number): object =>
    kernel.proxyBuilder.build(flowState.stepNodes[index]) as object;

  const spreadKeys = (): string[] => [...flowState.stepKeys, "current", "length"];

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Бренд трекинга: навигация бампает версию FlowState.
      if (key === FLOW_STATE) return flowState;
      // steps — не config-узел; для tracking proxy прозрачен.
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
      // Состав шагов статичен — запись запрещена.
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
