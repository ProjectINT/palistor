import { CONFIG_NODE, CONFIG_PROPS, ENTITY_ID, ENTITY_ID_LEAF, STORE_REF } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { EntityNode, EntityLeafNode, EntityGroupNode } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import type { NodeView } from "../store/NodeRegistry/nodeView";
import { isLeafNode } from "../traversal";

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
      if (isLeafNode(field as object)) {
        values[key] = (nodeState.get(field as object) as { value: unknown } | undefined)?.value
          ?? (field as EntityLeafNode).value;
      } else {
        values[key] = buildEntityValues(field as EntityGroupNode, nodeState);
      }
    }
  }
  return values;
}

// ─── Entity leaf proxy ───────────────────────────────────────────────────────


// buildEntityLeafProxy removed — entity leaf proxies are now built by
// ProxyBuilder._buildEntityLeafProxy(storage, rules) via proxyBuilder.build(node, { via }).

// ─── Entity projection proxy ─────────────────────────────────────────────────

/**
 * Build an EntityProjectionProxy: a proxy for an entity through a template node.
 *
 * Provides entity leaf values accessed through template structure.
 * Template rules (formatter, setter, validate, isRequired, label, etc.) are applied.
 *
 * Accessing `proxy.name` → entity-leaf proxy (built by ProxyBuilder) with template rules.
 * Writing `proxy.name.value = 'X'` → updates entity leaf via template formatter.
 *
 * @param entityNode       EntityNode from entityRegistry
 * @param templateNode     Template config node (the `array[0]` of a ListNode)
 * @param kernel           Palistor instance
 * @param entityProxyCache Per-list cache (keyed by entityNode) for stable references
 */
export function buildEntityProjectionProxy(
  entityNode: EntityNode | EntityGroupNode,
  templateNode: AnyConfigNode,
  kernel: Palistor<any>,
  entityProxyCache?: WeakMap<object, object>,
): object {
  const cacheKey = entityNode as object;
  const cached = entityProxyCache?.get(cacheKey);
  if (cached) return cached;

  const templateKeys = Object.keys(templateNode).filter((k) => !CONFIG_PROPS.has(k));

  // The top-level entityNode for building entity values in leaf proxies.
  // For nested groups, we still need the root entity node context.
  const rootEntityNode = entityNode as EntityNode;

  // Stable submit function reference (created lazily)
  let submitFnRef: (() => Promise<unknown>) | null = null;

  const nodeState = kernel.nodes.nodeState;

  // Helper: get current entity id from nodeState or entity leaf
  const getEntityId = (): string => {
    if ("id" in entityNode) {
      const idLeaf = (entityNode as EntityNode).id;
      return (
        (nodeState.get(idLeaf as object) as { value: unknown } | undefined)?.value ??
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
            (nodeState.get(idLeaf as object) as { value: unknown } | undefined)
              ?.value ?? idLeaf.value
          );
        }
        return undefined;
      }
      // Expose the id leaf node for tracking proxy — lets it subscribe to rekey() changes
      if (key === ENTITY_ID_LEAF && "id" in entityNode) {
        return (entityNode as EntityNode).id as object;
      }
      if (key === STORE_REF) return kernel;

      if (typeof key === "symbol") return undefined;

      // id is always exposed directly as value (not as a leaf proxy)
      if (key === "id" && "id" in entityNode) {
        const idLeaf = (entityNode as EntityNode).id;
        return (
          (nodeState.get(idLeaf as object) as { value: unknown } | undefined)
            ?.value ?? idLeaf.value
        );
      }

      // ─── loading / submitting / submit ────────────────────────────────────
      // Only exposed on root entity proxy (the one that has an "id" field).
      if ("id" in entityNode) {
        if (key === "loading") {
          const eid = getEntityId();
          return kernel.resolveManager.entityStates.get(eid, templateNode as object)?.status === "pending";
        }
        if (key === "submitting") {
          const eid = getEntityId();
          return kernel.resolveManager.entityStates.get(eid, templateNode as object)?.submitting === true;
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
        if (key === "values") {
          return buildEntityValues(
            rootEntityNode,
            nodeState as WeakMap<object, { value: unknown }>,
          );
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
        if (isLeafNode(entityField as object)) {
          // ── Lazily register NodeView for entity-leaf → template-field binding ──
          // Provides entity values, parent proxy, and onReset to the pipelines.
          // Skips phantom leaves (not in nodeState) and already-registered pairs.
          if (nodeState.has(entityField as object)) {
            const existingSlot = kernel.nodes.nodeViews.get(entityField as object);
            if (!existingSlot?.has(templateField as object)) {
              const view: NodeView = {
                storage: entityField as unknown as AnyConfigNode,
                rules: templateField as AnyConfigNode,
                parent: {
                  proxy,     // entity projection proxy (stable closure reference)
                  getValues: () => buildEntityValues(
                    rootEntityNode,
                    nodeState as WeakMap<object, { value: unknown }>,
                  ),
                },
                onReset: () => {
                  const initialValue = kernel.dirty.initialValueMap.get(entityField as object);
                  const prev = (nodeState.get(entityField as object) as { value: unknown } | undefined)?.value;
                  const result = kernel.writePipeline.execute(
                    entityField as unknown as AnyConfigNode,
                    initialValue,
                    prev,
                    { via: templateField as AnyConfigNode },
                  );
                  if (result && !result.skipped) kernel.notifyChanged(result.changed);
                },
              };
              const slot = existingSlot ?? new Map<object, NodeView>();
              slot.set(templateField as object, view);
              kernel.nodes.nodeViews.set(entityField as object, slot);
            }
          }
          return kernel.proxyBuilder.build(
            entityField as unknown as AnyConfigNode,
            { via: templateField as AnyConfigNode },
          );
        }
        // Nested group — recurse
        return buildEntityProjectionProxy(
          entityField as EntityGroupNode,
          templateField as AnyConfigNode,
          kernel,
          undefined,
        );
      }

      // Phantom leaf: entity doesn't have this field yet, show template defaults.
      if (isLeafNode(templateField as AnyConfigNode)) {
        const phantom: EntityLeafNode = {
          value: (templateField as AnyConfigNode).value,
        };
        return kernel.proxyBuilder.build(
          phantom as unknown as AnyConfigNode,
          { via: templateField as AnyConfigNode, parentEntityProxy: proxy },
        );
      }

      return undefined;
    },

    ownKeys() {
      const hasId = "id" in entityNode;
      if (hasId) {
        const keysWithoutId = templateKeys.filter((k) => k !== "id");
        return ["id", ...keysWithoutId, "loading", "submitting", "submit", "values"];
      }
      return templateKeys;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      const hasId = "id" in entityNode;
      const extraKeys = hasId ? ["loading", "submitting", "submit", "values"] : [];
      const keysWithoutId = hasId ? templateKeys.filter((k) => k !== "id") : templateKeys;
      const keys = hasId ? ["id", ...keysWithoutId, ...extraKeys] : keysWithoutId;
      if (!keys.includes(key as string)) return undefined;
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  entityProxyCache?.set(cacheKey, proxy);
  return proxy;
}
