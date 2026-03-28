import { CONFIG_NODE, CONFIG_PROPS, ENTITY_ID, STORE_REF } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { EntityNode, EntityLeafNode, EntityGroupNode } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import { storeValue } from "../writePipeline/storeValue";
import { formatValue } from "../writePipeline/formatValue";
import { mergeChanged } from "../writePipeline/mergeChanged";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a flat values object from an entity node for use in computed
 * template rules (formatter, validate, isRequired, etc.).
 */
function buildEntityValues(
  entityNode: EntityNode | EntityGroupNode,
  nodeState: WeakMap<object, { value: unknown }>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(entityNode)) {
    const field = (entityNode as Record<string, unknown>)[key];
    if (field && typeof field === "object") {
      if ("value" in field) {
        values[key] = (nodeState.get(field as object) as { value: unknown } | undefined)?.value
          ?? (field as EntityLeafNode).value;
      } else {
        values[key] = buildEntityValues(field as EntityGroupNode, nodeState);
      }
    }
  }
  return values;
}

/**
 * Write a value to an entity leaf node through template formatter/setter rules.
 *
 * - Applies template formatter (if any) to the raw value
 * - Skips write if value is unchanged (Object.is)
 * - Stores value in nodeState (also updates valuesCache via nodeSlot if registered)
 * - If template has a setter, applies resulting patch to sibling entity fields
 * - Runs recompute + notifyChanged
 */
function writeEntityLeafValue(
  entityLeaf: EntityLeafNode,
  templateField: AnyConfigNode,
  rawValue: unknown,
  entityNode: EntityNode,
  kernel: Palistor<any>,
): void {
  const nodeState = kernel.nodes.nodeState;
  const entityValues = buildEntityValues(
    entityNode,
    nodeState as WeakMap<object, { value: unknown }>,
  );

  // Phase 1: formatter from template
  const processedValue = formatValue(rawValue, templateField, entityValues);

  // Fast exit: value unchanged
  const currentState = nodeState.get(entityLeaf as object);
  if (currentState && Object.is(processedValue, currentState.value)) return;

  // Phase 2: store value (updates nodeState + valuesCache nodeSlot if registered)
  const stored = storeValue(
    entityLeaf as unknown as AnyConfigNode,
    processedValue,
    nodeState,
    kernel.values,
  );
  if (!stored) return;

  // Keep entity leaf object's .value in sync (matches mergeEntityNode behaviour)
  (entityLeaf as { value: unknown }).value = processedValue;

  // Phase 3: setter (apply patch to sibling entity fields)
  const patchedNodes = new Set<object>();
  if (typeof templateField.setter === "function") {
    const patch = (
      templateField.setter as (
        v: unknown,
        vals: Record<string, unknown>,
        prev: unknown,
      ) => Record<string, unknown>
    )(processedValue, entityValues, currentState?.value);

    if (patch && typeof patch === "object") {
      for (const k of Object.keys(patch)) {
        if (k === "id") continue;
        const entityField = (entityNode as Record<string, unknown>)[k];
        if (
          entityField &&
          typeof entityField === "object" &&
          "value" in entityField
        ) {
          storeValue(
            entityField as unknown as AnyConfigNode,
            patch[k],
            nodeState,
            kernel.values,
          );
          patchedNodes.add(entityField as object);
        }
      }
    }
  }

  // Phase 4: recompute + notify
  const changedSoFar = new Set<object>([entityLeaf as unknown as object]);
  for (const n of patchedNodes) changedSoFar.add(n);
  const recomputedNodes = kernel.recompute(changedSoFar);
  const allChanged = mergeChanged(
    entityLeaf as unknown as AnyConfigNode,
    patchedNodes,
    recomputedNodes,
  );
  kernel.notifyChanged(allChanged);
}

// ─── Entity leaf proxy ───────────────────────────────────────────────────────

/**
 * Build a proxy for a single entity field through a template field config.
 *
 * Exposes: value, label, placeholder, description, isRequired, isReadOnly,
 * isDisabled, isVisible, isInvalid, errorMessage, dirty, onValueChange.
 *
 * Reading `.value` returns the current entity leaf value from nodeState.
 * Setting `.value = x` runs template formatter → stores in entity leaf → notifies.
 */
function buildEntityLeafProxy(
  entityLeaf: EntityLeafNode,
  templateField: AnyConfigNode,
  entityNode: EntityNode,
  kernel: Palistor<any>,
  leafProxyCache: WeakMap<object, object>,
): object {
  const cacheKey = entityLeaf as object;
  const cached = leafProxyCache.get(cacheKey);
  if (cached) return cached;

  const nodeState = kernel.nodes.nodeState;

  const leafProxy = new Proxy(entityLeaf as unknown as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Transparent for tracking proxy — exposes the entity leaf as config node
      if (key === CONFIG_NODE) return entityLeaf;

      if (typeof key === "symbol") return undefined;

      const entityValues = buildEntityValues(
        entityNode,
        nodeState as WeakMap<object, { value: unknown }>,
      );
      const translate = kernel.services.translate;

      switch (key) {
        case "value":
          return (
            (nodeState.get(entityLeaf as object) as { value: unknown } | undefined)
              ?.value ?? entityLeaf.value
          );

        case "label": {
          const v = templateField.label;
          return typeof v === "function" ? v(translate, entityValues) : v;
        }
        case "placeholder": {
          const v = templateField.placeholder;
          return typeof v === "function" ? v(translate, entityValues) : v;
        }
        case "description": {
          const v = templateField.description;
          return typeof v === "function" ? v(translate, entityValues) : v;
        }

        case "isRequired": {
          const v = templateField.isRequired;
          if (v === undefined) return false;
          return typeof v === "function"
            ? Boolean((v as (vals: unknown) => boolean)(entityValues))
            : Boolean(v);
        }
        case "isReadOnly": {
          const v = templateField.isReadOnly;
          if (v === undefined) return false;
          return typeof v === "function"
            ? Boolean((v as (vals: unknown) => boolean)(entityValues))
            : Boolean(v);
        }
        case "isDisabled": {
          const v = templateField.isDisabled;
          if (v === undefined) return false;
          return typeof v === "function"
            ? Boolean((v as (vals: unknown) => boolean)(entityValues))
            : Boolean(v);
        }
        case "isVisible": {
          const v = templateField.isVisible;
          if (v === undefined) return true;
          return typeof v === "function"
            ? Boolean((v as (vals: unknown) => boolean)(entityValues))
            : Boolean(v);
        }

        case "errorMessage": {
          if (typeof templateField.validate !== "function") return undefined;
          const currentValue =
            (nodeState.get(entityLeaf as object) as { value: unknown } | undefined)?.value
            ?? entityLeaf.value;
          const result = (
            templateField.validate as (
              v: unknown,
              vals: Record<string, unknown>,
              t: (...args: any[]) => string,
            ) => string | undefined | false
          )(currentValue, entityValues, translate);
          return result || undefined;
        }

        case "isInvalid": {
          if (typeof templateField.validate !== "function") return false;
          const currentValue =
            (nodeState.get(entityLeaf as object) as { value: unknown } | undefined)?.value
            ?? entityLeaf.value;
          const result = (
            templateField.validate as (
              v: unknown,
              vals: Record<string, unknown>,
              t: (...args: any[]) => string,
            ) => string | undefined | false
          )(currentValue, entityValues, translate);
          return !!result;
        }

        case "dirty":
          return (nodeState.get(entityLeaf as object) as { dirty?: boolean } | undefined)
            ?.dirty ?? false;

        case "onValueChange":
          return (v: unknown) =>
            writeEntityLeafValue(entityLeaf, templateField, v, entityNode, kernel);

        default:
          return undefined;
      }
    },

    set(_target, key: string | symbol, newValue: unknown) {
      if (key !== "value") return false;
      writeEntityLeafValue(entityLeaf, templateField, newValue, entityNode, kernel);
      return true;
    },

    ownKeys() {
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
        "onValueChange",
      ];
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      return { configurable: true, enumerable: true, writable: true };
    },
  });

  leafProxyCache.set(cacheKey, leafProxy);
  return leafProxy;
}

// ─── Entity projection proxy ─────────────────────────────────────────────────

/**
 * Build an EntityProjectionProxy: a proxy for an entity through a template node.
 *
 * Provides entity leaf values accessed through template structure.
 * Template rules (formatter, setter, validate, isRequired, label, etc.) are applied.
 *
 * Accessing `proxy.name` → EntityLeafProxy with template rules for that field.
 * Writing `proxy.name.value = 'X'` → updates entity leaf via template formatter.
 *
 * @param entityNode      EntityNode from entityRegistry
 * @param templateNode    Template config node (the `array[0]` of a ListNode)
 * @param kernel          Palistor instance
 * @param entityProxyCache Per-list cache (keyed by entityNode) for stable references
 * @param leafProxyCache  Shared leaf proxy cache for stable field proxy references
 */
export function buildEntityProjectionProxy(
  entityNode: EntityNode | EntityGroupNode,
  templateNode: AnyConfigNode,
  kernel: Palistor<any>,
  entityProxyCache?: WeakMap<object, object>,
  leafProxyCache?: WeakMap<object, object>,
): object {
  const cacheKey = entityNode as object;
  const cached = entityProxyCache?.get(cacheKey);
  if (cached) return cached;

  const resolvedLeafCache = leafProxyCache ?? new WeakMap<object, object>();
  const templateKeys = Object.keys(templateNode).filter((k) => !CONFIG_PROPS.has(k));

  // The top-level entityNode for building entity values in leaf proxies
  // For nested groups, we still need the root entity node context
  const rootEntityNode = entityNode as EntityNode;

  // Stable submit function reference (created lazily)
  let submitFnRef: (() => Promise<unknown>) | null = null;

  // Helper: get current entity id from nodeState or entity leaf
  const getEntityId = (): string => {
    if ("id" in entityNode) {
      const idLeaf = (entityNode as EntityNode).id;
      return (
        (kernel.nodes.nodeState.get(idLeaf as object) as { value: unknown } | undefined)?.value ??
        idLeaf.value
      ) as string;
    }
    return "";
  };

  const proxy = new Proxy(entityNode as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Transparent for tracking proxy
      if (key === CONFIG_NODE) return entityNode;

      // Expose entity ID and store for useForm(entity, templateSelector) overload
      if (key === ENTITY_ID) {
        if ("id" in entityNode) {
          const idLeaf = (entityNode as EntityNode).id;
          return (
            (kernel.nodes.nodeState.get(idLeaf as object) as { value: unknown } | undefined)
              ?.value ?? idLeaf.value
          );
        }
        return undefined;
      }
      if (key === STORE_REF) return kernel;

      if (typeof key === "symbol") return undefined;

      // id is always exposed directly as value (not as a leaf proxy)
      if (key === "id" && "id" in entityNode) {
        const idLeaf = (entityNode as EntityNode).id;
        return (
          (kernel.nodes.nodeState.get(idLeaf as object) as { value: unknown } | undefined)
            ?.value ?? idLeaf.value
        );
      }

      // ─── Phase 3B: loading / submitting / submit ──────────────────────────
      // Only exposed on root entity proxy (the one that has an "id" field).
      if ("id" in entityNode) {
        if (key === "loading") {
          const eid = getEntityId();
          return kernel._getEntityBindingState(eid, templateNode as object)?.loading ?? false;
        }
        if (key === "submitting") {
          const eid = getEntityId();
          return kernel._getEntityBindingState(eid, templateNode as object)?.submitting ?? false;
        }
        if (key === "submit") {
          if (!submitFnRef) {
            submitFnRef = () => {
              const eid = getEntityId();
              return kernel.executeEntityTemplateSubmit(eid, templateNode, proxy);
            };
          }
          return submitFnRef;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const templateField = templateNode[key as string];
      if (
        !templateField ||
        typeof templateField !== "object" ||
        Array.isArray(templateField)
      ) {
        return undefined;
      }

      const entityField = (entityNode as Record<string, unknown>)[key as string];

      if (entityField && typeof entityField === "object") {
        if ("value" in entityField) {
          // Leaf field — build entity leaf proxy through template field
          return buildEntityLeafProxy(
            entityField as EntityLeafNode,
            templateField as AnyConfigNode,
            rootEntityNode,
            kernel,
            resolvedLeafCache,
          );
        }
        // Nested group — recurse (nested group proxy shares same root entity context)
        return buildEntityProjectionProxy(
          entityField as EntityGroupNode,
          templateField as AnyConfigNode,
          kernel,
          undefined, // no entity proxy cache for sub-groups
          resolvedLeafCache,
        );
      }

      // Entity does not yet have this field.
      // If template has a leaf here, return a phantom proxy showing template defaults.
      if ("value" in (templateField as AnyConfigNode)) {
        const phantom: EntityLeafNode = {
          value: (templateField as AnyConfigNode).value,
        };
        return buildEntityLeafProxy(
          phantom,
          templateField as AnyConfigNode,
          rootEntityNode,
          kernel,
          new WeakMap(), // no caching for phantom leaves
        );
      }

      return undefined;
    },

    ownKeys() {
      const hasId = "id" in entityNode;
      if (hasId) {
        return ["id", ...templateKeys, "loading", "submitting", "submit"];
      }
      return templateKeys;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      const hasId = "id" in entityNode;
      const extraKeys = hasId ? ["loading", "submitting", "submit"] : [];
      const keys = hasId ? ["id", ...templateKeys, ...extraKeys] : templateKeys;
      if (!keys.includes(key as string)) return undefined;
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  entityProxyCache?.set(cacheKey, proxy);
  return proxy;
}
