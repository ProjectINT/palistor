import { CONFIG_NODE, ENTITY_ID, FLOW_STATE } from "../constants";
import type { MappableKey } from "../constants";
import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import type { FieldState } from "../compute/index";

import { computeProxyKeys } from "./computeProxyKeys";
import { handleLazyResolve } from "./handleLazyResolve";
import { initProxyCaches } from "./initProxyCaches";
import { buildListProxy } from "./buildListProxy";
import { isListNode } from "../store/NodeRegistry/nodeUtils";
import { isGroupNode } from "../traversal";
import { buildFlowStepsProxy } from "../flow/buildFlowStepsProxy";
import { getFlowApi } from "../flow/flowApi";
import {
  flowIsInvalid,
  flowLoading,
  getStepStatus,
  stepIsInvalid,
} from "../flow/flowNavigation";

/** Returns the cached value, creating it on first access. */
function getCached<V>(cache: WeakMap<object, V>, key: object, factory: () => V): V {
  let v = cache.get(key);
  if (v === undefined) {
    v = factory();
    cache.set(key, v);
  }
  return v;
}

/**
 * ProxyBuilder — builds the reactive Proxy for config nodes.
 *
 * The Proxy intercepts:
 *
 * GET:
 *   - FIELD_STATE_PROPS → from the computed FieldState (value, isVisible, error…)
 *   - any other key → recursive proxy of the child node
 *
 * SET:
 *   - "value" → write pipeline → recomputeAll → notify
 *   - everything else → forbidden
 *
 * OWNKEYS / GETOWNPROPERTYDESCRIPTOR:
 *   - Control which keys are visible in spread ({...proxy}), Object.keys()
 *     and for...in. They hide internal config keys (validate, formatter,
 *     setter, …) that must not leak as props.
 */
export class ProxyBuilder {
  private readonly caches = initProxyCaches();
  /** Compound cache for entity-leaf mode: (storage, via) → proxy. */
  private readonly _entityLeafProxyCache = new WeakMap<object, Map<object, object>>();

  constructor(private readonly kernel: Palistor<any, any>) {}

  build(node: AnyConfigNode, opts?: { via?: AnyConfigNode; parentEntityProxy?: object }): any {
    const via = opts?.via;

    if (via !== undefined) {
      // Entity-leaf mode: use compound (storage × via) cache for stable proxy identity.
      let leafMap = this._entityLeafProxyCache.get(node as object);
      if (leafMap?.has(via as object)) return leafMap.get(via as object);

      const proxy = this._buildEntityLeafProxy(node, via, opts?.parentEntityProxy);
      if (!leafMap) {
        leafMap = new Map();
        this._entityLeafProxyCache.set(node as object, leafMap);
      }
      leafMap.set(via as object, proxy);
      return proxy;
    }

    const proxyCache = this.kernel.nodes.proxyCache;
    if (proxyCache.has(node)) return proxyCache.get(node);

    // ── ListNode branch ─────────────────────────────────────────────────────
    // Root list: identified by its ListState (ownerEntity === null).
    // The proxy is cached inside buildListProxy by ListState, not in proxyCache.
    if (isListNode(node)) {
      return buildListProxy(this.kernel.nodes.listStates.get(node)!, this.kernel);
    }

    const builder = this;
    const kernel = this.kernel;
    const caches = this.caches;

    const proxyNode: Record<string, any> = new Proxy(node as Record<string, any>, {
      get(_target, key: string | symbol) {
        if (key === CONFIG_NODE) return node;

        // Flow brand: the FlowState of its own flow (flow node) or of the
        // owning flow (step node) — for the tracking proxy (status, currentStepKey, …).
        if (key === FLOW_STATE) {
          return kernel.nodes.flowStates.get(node) ?? kernel.nodes.stepToFlow.get(node);
        }

        // Any symbol other than CONFIG_NODE/FLOW_STATE is meaningless
        if (typeof key === "symbol") return undefined;

        // Reverse mapping on input: external → internal in one lookup.
        // All dispatch logic below works with the internal key `ikey`;
        // the original `key` is only used to navigate to child nodes.
        const ikey = kernel.externalToInternal[key] ?? key;

        // onValueChange — a stable functional setter for React
        if (ikey === "onValueChange") {
          return getCached(caches.onValueChange, node, () => (v: unknown) => { proxyNode.value = v; });
        }

        const currentNode = kernel.nodes.nodeState.get(node);
        const isGroup = isGroupNode(node);

        // ── Group node: methods and state ─────────────────────────────────
        if (isGroup) {
          // ── Flow node (defineFlow): navigation + derived state ──────────
          // Checked BEFORE the group handlers: a flow overrides
          // submit/loading/isInvalid (errors land in flow.errors, composite
          // loading, aggregate validity of visited steps).
          const flowState = kernel.nodes.flowStates.get(node);
          if (flowState) {
            switch (ikey) {
              case "currentStepKey":
                return flowState.stepKeys[flowState.currentIndex];
              case "currentStepIndex":
                return flowState.currentIndex;
              case "canGoBack":
                return flowState.visitStack.length > 0;
              case "history":
                return [...flowState.visitStack, flowState.stepKeys[flowState.currentIndex]];
              case "errors":
                return flowState.errors;
              case "steps":
                return buildFlowStepsProxy(flowState, kernel);
              case "nextStep":
                return getFlowApi(kernel, flowState).nextStep;
              case "back":
                return getFlowApi(kernel, flowState).back;
              case "goTo":
                return getFlowApi(kernel, flowState).goTo;
              case "validate":
                return getFlowApi(kernel, flowState).validate;
              case "submit":
                return getFlowApi(kernel, flowState).submit;
              case "loading":
                return flowLoading(kernel, flowState);
              case "isInvalid":
                return flowIsInvalid(kernel, flowState);
            }
          }

          // ── Step node: computed status + aggregate validity ─────────────
          const owningFlow = kernel.nodes.stepToFlow.get(node);
          if (owningFlow) {
            if (ikey === "status") return getStepStatus(owningFlow, node);
            if (ikey === "isInvalid") return stepIsInvalid(kernel, node);
          }

          const handlers = {
            "submitting": () => currentNode?.["submitting" as keyof FieldState] ?? false,
            "dirty": () => currentNode?.["dirty" as keyof FieldState] ?? false,
            "revalidate": () => currentNode?.["revalidate" as keyof FieldState] ?? false,
            "loading": () => currentNode?.["loading" as keyof FieldState] ?? false,
            "values": () => kernel.values.groupSlot.get(node),
            "submit": () => getCached(caches.submit, node, () => () => kernel.submitPipeline.execute(node)),
            "reset": () => getCached(caches.reset, node, () => (vals?: Record<string, unknown>) => kernel.resetPipeline.execute(node, vals)),
            "setValues": () => getCached(caches.setValues, node, () => (patch: Record<string, unknown>) => kernel.setValuesNode(node, patch)),
          }

          if (ikey in handlers) return handlers[ikey as keyof typeof handlers]();
          handleLazyResolve(node,
            kernel.resolveManager.triggerResolve,
            kernel.resolveManager.getResolveState,
          );
        }

        // ── Computed field state ─────────────────────────────────────────
        const translatableHandler = () => {
          const configValue = node[ikey];
          if (typeof configValue === "function") {
            return configValue(kernel.services.translate, kernel.values.values);
          }
          return currentNode ? currentNode[ikey as keyof FieldState] : configValue;
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
          "submitting":   currentNode?.submitting ?? false,
        };

        if (ikey === "submit") {
          return getCached(caches.submit, node, () => () => kernel.submitPipeline.execute(node));
        }

        if (ikey in fieldStateHandlers) {
          const field = fieldStateHandlers[ikey];
          if (typeof field === "function") return field();
          return field;
        }

        // Child node → recursive proxy (by the ORIGINAL key)
        const child = node[key];

        if (child && typeof child === "object") return builder.build(child as AnyConfigNode);

        return child;
      },

      set(_target, key: string | symbol, newValue: unknown) {
        const ikey = kernel.externalToInternal[key as string] ?? key;
        if (ikey !== "value") return false;

        // Group write: delegate to setValuesNode, bypass writePipeline
        // (Object.is() comparison on objects would always be false in writePipeline)
        if (isGroupNode(node)) {
          kernel.setValuesNode(node, newValue as Record<string, unknown>);
          return true;
        }

        // Capture the previous value for onChange
        const previousValue = kernel.nodes.nodeState.get(node)?.value;

        // The whole write is delegated to the write pipeline:
        // format → store → setter patch → recompute → merge changed
        const result = kernel.writePipeline.execute(node, newValue, previousValue);

        if (!result) return false;

        // The formatted value equals the current one — the write was skipped
        if (result.skipped) {
          console.warn(
            "[Palistor] Write skipped: the value did not change. " +
            "Your app may be doing redundant re-renders, " +
            "or you may be setting a value during render.",
          );
          return true;
        }

        kernel.notifyChanged(result.changed);

        // Fire onChange on ancestor groups (fire-and-forget, async)
        const actualNewValue = kernel.nodes.nodeState.get(node)?.value;
        kernel.onChangePipeline.fire(node, actualNewValue, previousValue);

        return true;
      },

      /**
       * Controls Object.keys(), Object.getOwnPropertyNames(), for...in, spread.
       * Hides internal config keys (validate, formatter, …) that must not
       * leak as props into UI components.
       */
      ownKeys() {
        return computeProxyKeys(node, kernel.fieldMapping);
      },

      /**
       * Must match ownKeys: every key gets an enumerable + configurable
       * descriptor, otherwise the Proxy throws an invariant violation.
       */
      getOwnPropertyDescriptor(_target, key: string | symbol) {
        if (typeof key === "symbol") return undefined;
        const keys = computeProxyKeys(node, kernel.fieldMapping);
        if (!keys.includes(key)) return undefined;
        return { configurable: true, enumerable: true, writable: true, value: proxyNode[key] };
      },
    });

    proxyCache.set(node, proxyNode);
    return proxyNode;
  }

  /**
   * Build a thin reactive proxy for an entity leaf accessed through a template field.
   *
   * - `storage` — the entity leaf node (holds the actual value in nodeState)
   * - `rules`   — the template field node (provides label, validate, formatter, etc.)
   *
   * Replaces the old `buildEntityLeafProxy` helper. Called from ProxyBuilder.build(node, { via }).
   */
  private _buildEntityLeafProxy(
    storage: AnyConfigNode,
    rules: AnyConfigNode,
    parentEntityProxy?: object,
  ): any {
    const kernel = this.kernel;
    const nodeState = kernel.nodes.nodeState;

    let submitFnRef: (() => Promise<unknown>) | null = null;
    let onValueChangeFn: ((v: unknown) => void) | null = null;

    return new Proxy(storage as Record<string, unknown>, {
      get(_target, key: string | symbol) {
        // CONFIG_NODE: expose storage when materialized, rules (templateField) for phantoms.
        // Phantoms return rules so the tracking proxy subscribes to templateField's version —
        // which IS bumped by notifyChanged when the field resolves/materialises.
        if (key === CONFIG_NODE) {
          return nodeState.has(storage as object) ? storage : rules;
        }

        if (typeof key === "symbol") return undefined;

        // Reverse mapping on input: external → internal. Then switch on `ikey`.
        const ikey = kernel.externalToInternal[key] ?? key;

        // Entity values from view (registered lazily in buildEntityProjectionProxy GET trap).
        const view = kernel.nodes.nodeViews.get(storage as object)?.get(rules as object);
        const allValues: Record<string, unknown> = view ? view.parent.getValues() : {};
        const translate = kernel.services.translate;
        const currentState = nodeState.get(storage as object) as
          | { value: unknown; dirty?: boolean; submitting?: boolean; loading?: boolean }
          | undefined;

        // ─── Lazy entity field resolve ──────────────────────────────────────
        // Trigger per-leaf template resolve on first access to value/loading.
        if ((ikey === "value" || ikey === "loading") && rules.resolve) {
          // For phantom leaves the NodeView may not be registered yet; fall back
          // to the entity projection proxy passed at construction time.
          const entityProxy = view?.parent?.proxy ?? parentEntityProxy;
          const entityId = entityProxy
            ? (entityProxy as Record<symbol, unknown>)[ENTITY_ID] as string | undefined
            : undefined;
          if (entityId) {
            const state = kernel.resolveManager.entityStates.get(entityId, rules);
            if (!state || state.status === "idle") {
              queueMicrotask(() =>
                kernel.resolveManager.triggerEntityFieldResolve(entityId, rules),
              );
            }
          }
        }

        switch (ikey) {
          case "value":
            return currentState?.value ?? storage.value;

          case "label": {
            const v = rules.label;
            return typeof v === "function" ? v(translate, allValues) : v;
          }
          case "placeholder": {
            const v = rules.placeholder;
            return typeof v === "function" ? v(translate, allValues) : v;
          }
          case "description": {
            const v = rules.description;
            return typeof v === "function" ? v(translate, allValues) : v;
          }

          case "isRequired": {
            const v = rules.isRequired;
            if (v === undefined) return false;
            return typeof v === "function"
              ? Boolean((v as (vals: unknown) => boolean)(allValues))
              : Boolean(v);
          }
          case "isReadOnly": {
            const v = rules.isReadOnly;
            if (v === undefined) return false;
            return typeof v === "function"
              ? Boolean((v as (vals: unknown) => boolean)(allValues))
              : Boolean(v);
          }
          case "isDisabled": {
            const v = rules.isDisabled;
            if (v === undefined) return false;
            return typeof v === "function"
              ? Boolean((v as (vals: unknown) => boolean)(allValues))
              : Boolean(v);
          }
          case "isVisible": {
            const v = rules.isVisible;
            if (v === undefined) return true;
            return typeof v === "function"
              ? Boolean((v as (vals: unknown) => boolean)(allValues))
              : Boolean(v);
          }

          case "errorMessage": {
            if (typeof rules.validate !== "function") return undefined;
            const currentValue = currentState?.value ?? storage.value;
            const result = (rules.validate as (
              v: unknown,
              vals: Record<string, unknown>,
              t: (...args: unknown[]) => string,
            ) => string | undefined | false)(currentValue, allValues, translate);
            return result || undefined;
          }

          case "isInvalid": {
            if (typeof rules.validate !== "function") return false;
            const currentValue = currentState?.value ?? storage.value;
            const result = (rules.validate as (
              v: unknown,
              vals: Record<string, unknown>,
              t: (...args: unknown[]) => string,
            ) => string | undefined | false)(currentValue, allValues, translate);
            return !!result;
          }

          case "dirty":
            return currentState?.dirty ?? false;

          case "loading":
            return currentState?.loading ?? false;

          case "submitting":
            return currentState?.submitting ?? false;

          case "submit": {
            if (!submitFnRef) {
              submitFnRef = () => {
                if (!nodeState.has(storage as object)) return Promise.resolve(); // phantom: no-op
                return kernel.submitPipeline.execute(storage, { via: rules });
              };
            }
            return submitFnRef;
          }

          case "onValueChange": {
            if (!onValueChangeFn) {
              onValueChangeFn = (v: unknown) => {
                if (!nodeState.has(storage as object)) return; // phantom: no-op
                const prev = (nodeState.get(storage as object) as { value: unknown } | undefined)?.value;
                const result = kernel.writePipeline.execute(storage, v, prev, { via: rules });
                if (!result || result.skipped) return;
                kernel.notifyChanged(result.changed);
                const newVal = (nodeState.get(storage as object) as { value: unknown } | undefined)?.value ?? v;
                kernel.onChangePipeline.fire(storage, newVal, prev, { via: rules });
              };
            }
            return onValueChangeFn;
          }

          default:
            return undefined;
        }
      },

      set(_target, key: string | symbol, newValue: unknown) {
        const ikey = kernel.externalToInternal[key as string] ?? key;
        if (ikey !== "value") return false;
        if (!nodeState.has(storage as object)) return true; // phantom: no-op
        const prev = (nodeState.get(storage as object) as { value: unknown } | undefined)?.value;
        const result = kernel.writePipeline.execute(storage, newValue, prev, { via: rules });
        if (!result || result.skipped) return true;
        kernel.notifyChanged(result.changed);
        const newVal = (nodeState.get(storage as object) as { value: unknown } | undefined)?.value ?? newValue;
        kernel.onChangePipeline.fire(storage, newVal, prev, { via: rules });
        return true;
      },

      ownKeys() {
        const fwd = kernel.fieldMapping;
        return [
          "value",
          "label",
          "placeholder",
          "description",
          "isRequired",
          "isReadOnly",
          "isDisabled",
          "isVisible",
          "isInvalid",
          "errorMessage",
          "dirty",
          "loading",
          "submitting",
          "submit",
          "onValueChange",
        ].map((k) => fwd[k as MappableKey] ?? k);
      },

      getOwnPropertyDescriptor(_target, key: string | symbol) {
        if (typeof key === "symbol") return undefined;
        return { configurable: true, enumerable: true, writable: true };
      },
    });
  }
}
