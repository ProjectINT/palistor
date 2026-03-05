import { FIELD_STATE_PROPS, CONFIG_NODE } from "../constants";
import { type AnyConfigNode } from "../collectValues";
import { writeValue, type WriteDeps } from "../writePipeline";
import type { FieldState } from "../compute";
import type { TranslateFn } from "../../core/types";
import type { ResolveState } from "../resolvePipeline";

import { TRANSLATABLE_PROPS } from "./translatableProps";
import { GROUP_BOOL_PROPS } from "./groupBoolProps";
import { computeProxyKeys } from "./computeProxyKeys";
import { handleLazyResolve } from "./handleLazyResolve";
import { initProxyCaches } from "./initProxyCaches";

export interface BuildProxyDeps {
  proxyCache: WeakMap<object, unknown>;
  nodeState: WeakMap<object, FieldState>;
  rootConfig: AnyConfigNode;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  /** Возвращает зарегистрированную функцию перевода (или null). */
  getTranslator: () => TranslateFn | null;
  /** Запуск submit pipeline для группового узла. */
  submitNode: (node: AnyConfigNode) => Promise<unknown>;
  /** Запуск reset для группового узла. */
  resetNode: (node: AnyConfigNode, values?: Record<string, unknown>) => void;
  /** Fire-and-forget onChange для листового узла. */
  onFieldChange?: (node: AnyConfigNode, newValue: unknown, previousValue: unknown) => void;
  /** Trigger resolve for a group node with resolve config. */
  triggerResolve?: (node: AnyConfigNode) => void;
  /** Get resolve state for a node (undefined if no resolve). */
  getResolveState?: (node: AnyConfigNode) => ResolveState | undefined;
}

/** Возвращает закэшированное значение, создавая при первом обращении. */
function getCached<V>(cache: WeakMap<object, V>, key: object, factory: () => V): V {
  let v = cache.get(key);
  if (v === undefined) {
    v = factory();
    cache.set(key, v);
  }
  return v;
}

/**
 * Создаёт функцию buildProxy, которая оборачивает узел конфига в Proxy.
 *
 * Proxy перехватывает:
 *
 * GET:
 *   - FIELD_STATE_PROPS → из вычисленного FieldState (value, isVisible, error…)
 *   - другой ключ → рекурсивный прокси дочернего узла
 *
 * SET:
 *   - "value" → formatter → update value → recomputeAll → notify
 *   - остальное → запрещено
 *
 * OWNKEYS / GETOWNPROPERTYDESCRIPTOR:
 *   - Контролируют, какие ключи видны при spread ({...proxy}),
 *     Object.keys() и for...in. Скрывают внутренние ключи конфига
 *     (validate, formatter, setter, …), которые не должны утекать как пропсы.
 */
export function createBuildProxy({
  proxyCache,
  nodeState,
  rootConfig,
  recomputeAll,
  notifyChanged,
  getTranslator,
  submitNode,
  resetNode,
  onFieldChange,
  triggerResolve,
  getResolveState,
}: BuildProxyDeps): (node: AnyConfigNode) => any {
  const caches = initProxyCaches();

  /** Зависимости write pipeline — собранные один раз для всех узлов. */
  const writeDeps: WriteDeps = { rootConfig, nodeState, recomputeAll };

  /** Зависимости для lazy resolve. */
  const resolveDeps = { triggerResolve, getResolveState };

  function buildProxy(node: AnyConfigNode): any {
    if (proxyCache.has(node)) return proxyCache.get(node);

    const proxyNode: Record<string, any> = new Proxy(node as Record<string, any>, {
      get(_target, key: string | symbol) {
        if (key === CONFIG_NODE) return node;
        const groupNode = !("value" in node);
        if (typeof key === "symbol") return undefined;

        // onValueChange — стабильный functional setter для React
        if (key === "onValueChange") {
          return getCached(caches.onValueChange, node, () => (v: unknown) => { proxyNode.value = v; });
        }

        // ── Групповой узел: методы и состояние ───────────────────────────
        if (groupNode) {
          if (GROUP_BOOL_PROPS.has(key)) {
            return nodeState.get(node)?.[key as keyof FieldState] ?? false;
          }
          if (key === "submit") {
            return getCached(caches.submit, node, () => () => submitNode(node));
          }
          if (key === "reset") {
            return getCached(caches.reset, node, () => (vals?: Record<string, unknown>) => resetNode(node, vals));
          }
          handleLazyResolve(node, resolveDeps);
        }

        // ── Вычисленное состояние поля ───────────────────────────────────
        if (FIELD_STATE_PROPS.has(key)) {
          if (TRANSLATABLE_PROPS.has(key)) {
            const configValue = node[key];
            if (typeof configValue === "function") {
              const t = getTranslator();
              if (t) return configValue(t);
            }
          }
          const state = nodeState.get(node);
          return state ? state[key as keyof FieldState] : node[key];
        }

        // Дочерний узел → рекурсивный прокси
        const child = node[key];
        if (child && typeof child === "object") return buildProxy(child as AnyConfigNode);

        return child;
      },

      set(_target, key: string | symbol, newValue: unknown) {
        if (key !== "value") return false;

        // Захватываем предыдущее значение для onChange
        const previousValue = nodeState.get(node)?.value;

        // Весь процесс записи делегирован write pipeline:
        // format → store → setter patch → recompute → merge changed
        const result = writeValue(node, newValue, writeDeps);
        if (!result) return false;

        notifyChanged(result.changed);

        // Fire onChange на группах-предках (fire-and-forget, async)
        if (onFieldChange) {
          const actualNewValue = nodeState.get(node)?.value;
          onFieldChange(node, actualNewValue, previousValue);
        }

        return true;
      },

      /**
       * Контролирует Object.keys(), Object.getOwnPropertyNames(), for...in, spread.
       * Скрывает внутренние ключи конфига (validate, formatter, …),
       * которые не должны утекать как пропсы в UI-компоненты.
       */
      ownKeys() {
        return computeProxyKeys(node, nodeState);
      },

      /**
       * Должен соответствовать ownKeys: для каждого ключа возвращаем
       * дескриптор enumerable + configurable, иначе Proxy выбросит invariant.
       */
      getOwnPropertyDescriptor(_target, key: string | symbol) {
        if (typeof key === "symbol") return undefined;
        const keys = computeProxyKeys(node, nodeState);
        if (!keys.includes(key)) return undefined;
        return { configurable: true, enumerable: true, writable: true, value: proxyNode[key] };
      },
    });

    proxyCache.set(node, proxyNode);
    return proxyNode;
  }

  return buildProxy;
}
