import { CONFIG_NODE } from "../constants";
import { collectValues, type AnyConfigNode } from "../collectValues";
import { writeValue, type WriteDeps } from "../writePipeline";
import type { FieldState } from "../compute";
import type { TranslateFn } from "../types";
import type { ResolveState } from "../resolvePipeline";

import { computeProxyKeys } from "./computeProxyKeys";
import { handleLazyResolve } from "./handleLazyResolve";
import { initProxyCaches } from "./initProxyCaches";

export interface BuildProxyDeps {
  proxyCache: WeakMap<object, unknown>;
  nodeState: WeakMap<object, FieldState>;
  rootConfig: AnyConfigNode;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  /** Функция перевода (гарантированно существует, см. store.ts). */
  translate: TranslateFn;
  /** Запуск submit pipeline для группового узла. */
  submitNode: (node: AnyConfigNode) => Promise<unknown>;
  /** Запуск reset для группового узла. */
  resetNode: (node: AnyConfigNode, values?: Record<string, unknown>) => void;
  /** Bulk-обновление значений для группового узла (один recompute + notify). */
  setValuesNode: (node: AnyConfigNode, patch: Record<string, unknown>) => void;
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
  translate,
  submitNode,
  resetNode,
  setValuesNode,
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
       
        // Любой символ кроме CONFIG_NODE не имеет смысла
        if (typeof key === "symbol") return undefined;
       
        // onValueChange — стабильный functional setter для React
        if (key === "onValueChange") {
          return getCached(caches.onValueChange, node, () => (v: unknown) => { proxyNode.value = v; });
        }
        
        const currentNode = nodeState.get(node);
        const isGroupNode = !("value" in node);
        
        // ── Групповой узел: методы и состояние ───────────────────────────
        if (isGroupNode) {
          const handlers = {
            "submitting": () => currentNode?.[key as keyof FieldState] ?? false,
            "dirty": () => currentNode?.[key as keyof FieldState] ?? false,
            "revalidate": () => currentNode?.[key as keyof FieldState] ?? false,
            "loading": () => currentNode?.[key as keyof FieldState] ?? false,
            "submit": () => getCached(caches.submit, node, () => () => submitNode(node)),
            "reset": () => getCached(caches.reset, node, () => (vals?: Record<string, unknown>) => resetNode(node, vals)),
            "setValues": () => getCached(caches.setValues, node, () => (patch: Record<string, unknown>) => setValuesNode(node, patch)),
          }
          
          if (key in handlers) return handlers[key as keyof typeof handlers]();
          handleLazyResolve(node, resolveDeps);
        }

        // ── Вычисленное состояние поля ───────────────────────────────────
        const translatableHandler = () => {
          const configValue = node[key];
          if (typeof configValue === "function") {
            const allValues = collectValues(rootConfig, nodeState);
            return configValue(translate, allValues);
          }
          return currentNode ? currentNode[key as keyof FieldState] : configValue;
        };

        const fieldStateHandlers: Record<string, (() => unknown) | unknown> = {
          "value":        currentNode ? currentNode.value        : node.value,
          "label":        translatableHandler,
          "placeholder":  translatableHandler,
          "description":  translatableHandler,
          "isRequired":   currentNode ? currentNode.isRequired   : node.isRequired,
          "isReadOnly":   currentNode ? currentNode.isReadOnly   : node.isReadOnly,
          "isDisabled":   currentNode ? currentNode.isDisabled   : node.isDisabled,
          "isVisible":    currentNode ? currentNode.isVisible    : node.isVisible,
          "isInvalid":    currentNode ? currentNode.isInvalid    : node.isInvalid,
          "errorMessage": currentNode ? currentNode.errorMessage : node.errorMessage,
          "dirty":        currentNode?.dirty,
          "loading":      currentNode?.loading,
        };

        if (key in fieldStateHandlers) {
          const field = fieldStateHandlers[key];
          if (typeof field === "function") return field();
          return field;
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
        const result = writeValue(node, newValue, writeDeps, previousValue);

        if (!result) return false;

        // Значение после форматирования совпадает с текущим — запись пропущена
        if (result.skipped) {
          console.warn(
            "[Palistor] Запись пропущена: значение не изменилось. " +
            "Возможно, ваше приложение делает лишние ре-рендеры, " +
            "или вы пытаетесь установить значение внутри рендера.",
          );
          return true;
        }

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
        return computeProxyKeys(node);
      },

      /**
       * Должен соответствовать ownKeys: для каждого ключа возвращаем
       * дескриптор enumerable + configurable, иначе Proxy выбросит invariant.
       */
      getOwnPropertyDescriptor(_target, key: string | symbol) {
        if (typeof key === "symbol") return undefined;
        const keys = computeProxyKeys(node);
        if (!keys.includes(key)) return undefined;
        return { configurable: true, enumerable: true, writable: true, value: proxyNode[key] };
      },
    });

    proxyCache.set(node, proxyNode);
    return proxyNode;
  }

  return buildProxy;
}
