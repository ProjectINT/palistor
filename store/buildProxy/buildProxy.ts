import { CONFIG_NODE } from "../constants";
import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import type { FieldState } from "../compute/index";

import { computeProxyKeys } from "./computeProxyKeys";
import { handleLazyResolve } from "./handleLazyResolve";
import { initProxyCaches } from "./initProxyCaches";
import { buildListProxy } from "./buildListProxy";
import { isListNode } from "../store/NodeRegistry/nodeUtils";

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
 * ProxyBuilder — строит реактивный Proxy для узлов конфига.
 *
 * Proxy перехватывает:
 *
 * GET:
 *   - FIELD_STATE_PROPS → из вычисленного FieldState (value, isVisible, error…)
 *   - другой ключ → рекурсивный прокси дочернего узла
 *
 * SET:
 *   - "value" → write pipeline → recomputeAll → notify
 *   - остальное → запрещено
 *
 * OWNKEYS / GETOWNPROPERTYDESCRIPTOR:
 *   - Контролируют, какие ключи видны при spread ({...proxy}),
 *     Object.keys() и for...in. Скрывают внутренние ключи конфига
 *     (validate, formatter, setter, …), которые не должны утекать как пропсы.
 */
export class ProxyBuilder {
  private readonly caches = initProxyCaches();

  constructor(private readonly kernel: Palistor<any>) {}

  build(node: AnyConfigNode): any {
    const proxyCache = this.kernel.nodes.proxyCache;
    if (proxyCache.has(node)) return proxyCache.get(node);

    // ── ListNode branch ─────────────────────────────────────────────────────
    if (isListNode(node)) {
      const listProxy = buildListProxy(node as unknown as unknown[], this.kernel);
      proxyCache.set(node, listProxy);
      return listProxy;
    }

    const builder = this;
    const kernel = this.kernel;
    const caches = this.caches;

    const proxyNode: Record<string, any> = new Proxy(node as Record<string, any>, {
      get(_target, key: string | symbol) {
        if (key === CONFIG_NODE) return node;

        // Любой символ кроме CONFIG_NODE не имеет смысла
        if (typeof key === "symbol") return undefined;

        // onValueChange — стабильный functional setter для React
        if (key === "onValueChange") {
          return getCached(caches.onValueChange, node, () => (v: unknown) => { proxyNode.value = v; });
        }

        const currentNode = kernel.nodes.nodeState.get(node);
        const isGroupNode = !("value" in node);

        // ── Групповой узел: методы и состояние ───────────────────────────
        if (isGroupNode) {
          const handlers = {
            "submitting": () => currentNode?.[key as keyof FieldState] ?? false,
            "dirty": () => currentNode?.[key as keyof FieldState] ?? false,
            "revalidate": () => currentNode?.[key as keyof FieldState] ?? false,
            "loading": () => currentNode?.[key as keyof FieldState] ?? false,
            "values": () => kernel.values.groupSlot.get(node),
            "submit": () => getCached(caches.submit, node, () => () => kernel.submitPipeline.execute(node)),
            "reset": () => getCached(caches.reset, node, () => (vals?: Record<string, unknown>) => kernel.resetPipeline.execute(node, vals)),
            "setValues": () => getCached(caches.setValues, node, () => (patch: Record<string, unknown>) => kernel.setValuesNode(node, patch)),
          }

          if (key in handlers) return handlers[key as keyof typeof handlers]();
          handleLazyResolve(node,
            kernel.resolveManager.triggerResolve,
            kernel.resolveManager.getResolveState,
          );
        }

        // ── Вычисленное состояние поля ───────────────────────────────────
        const translatableHandler = () => {
          const configValue = node[key];
          if (typeof configValue === "function") {
            return configValue(kernel.services.translate, kernel.values.values);
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

        if (child && typeof child === "object") return builder.build(child as AnyConfigNode);

        return child;
      },

      set(_target, key: string | symbol, newValue: unknown) {
        if (key !== "value") return false;

        // Захватываем предыдущее значение для onChange
        const previousValue = kernel.nodes.nodeState.get(node)?.value;

        // Весь процесс записи делегирован write pipeline:
        // format → store → setter patch → recompute → merge changed
        const result = kernel.writePipeline.execute(node, newValue, previousValue);

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

        kernel.notifyChanged(result.changed);

        // Fire onChange на группах-предках (fire-and-forget, async)
        const actualNewValue = kernel.nodes.nodeState.get(node)?.value;
        kernel.onChangePipeline.fire(node, actualNewValue, previousValue);

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
}
