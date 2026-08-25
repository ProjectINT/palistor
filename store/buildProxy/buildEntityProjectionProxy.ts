import { CONFIG_NODE, CONFIG_PROPS, ENTITY_ID, ENTITY_ID_LEAF, STORE_REF } from "../constants";
import type { MappableKey } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { EntityNode, EntityLeafNode, EntityGroupNode } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import type { NodeView } from "../store/NodeRegistry/nodeView";
import { isLeafNode, isGroupNode } from "../traversal";
import { buildListProxy } from "./buildListProxy";

/** Element-wise comparison of two string arrays (for list-membership dirty). */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a flat values object from an entity node for use in computed
 * template rules (formatter, validate, isRequired, etc.).
 *
 * Exported for per-entity list resolve (variant C): the child-list resolver
 * receives the owner's flat snapshot built here (see triggerEntityListResolve).
 * NB: `lists`/`owner` on EntityNode are non-enumerable → excluded automatically.
 */
export function buildEntityValues(
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

/**
 * Build a flat values object for an entity INCLUDING its per-entity nested lists
 * (variant C, phase C3). Scalars/groups come from {@link buildEntityValues};
 * for every list field in the template, the child entities' deep values are
 * appended under the list's field key. Recurses into nested-of-nested lists.
 *
 * Used by the entity projection proxy's `values` getter and the per-entity list
 * proxy's `getValues()`. NB: plain {@link buildEntityValues} stays list-free —
 * it feeds resolvers/validators that must see scalar values only.
 */
export function buildEntityValuesWithLists(
  entityNode: EntityNode | EntityGroupNode,
  templateNode: AnyConfigNode,
  kernel: Palistor<any, any>,
): Record<string, unknown> {
  const nodeState = kernel.nodes.nodeState as WeakMap<object, { value: unknown }>;
  const values = buildEntityValues(entityNode, nodeState);

  const lists = (entityNode as EntityNode).lists;
  if (!lists) return values;

  // Walk the template (incl. nested groups) and materialize every per-entity
  // list into its matching value subtree. `lists` is keyed by listConfigNode
  // and stored flat on the entity, so a list nested inside a group is looked up
  // the same way — only the value subtree we write into differs (C4).
  materializeListsInto(values, templateNode, lists, kernel);

  return values;
}

/**
 * Recursively materialize per-entity lists from `lists` into `valuesSubtree`,
 * walking `templateSubtree` in parallel. List fields become arrays of child
 * deep-values; nested groups recurse into the corresponding value subtree.
 */
function materializeListsInto(
  valuesSubtree: Record<string, unknown>,
  templateSubtree: AnyConfigNode,
  lists: NonNullable<EntityNode["lists"]>,
  kernel: Palistor<any, any>,
): void {
  for (const key of Object.keys(templateSubtree)) {
    if (CONFIG_PROPS.has(key)) continue;
    const templateField = (templateSubtree as Record<string, unknown>)[key];

    if (Array.isArray(templateField)) {
      // Include the list field only when the entity has state for it (the list
      // was loaded/mutated). An untouched list adds no key — symmetric with
      // the projectionObj materialization (store.getValues()).
      const els = lists.get(templateField as unknown as object);
      if (!els) continue;

      const childTemplate = (templateField as unknown[])[0] as AnyConfigNode;
      valuesSubtree[key] = els.itemIds
        .map((id) => {
          const child = kernel.entityRegistry.get(id);
          return child ? buildEntityValuesWithLists(child, childTemplate, kernel) : undefined;
        })
        .filter((v): v is Record<string, unknown> => v !== undefined);
      continue;
    }

    if (templateField && typeof templateField === "object" && isGroupNode(templateField as object)) {
      const sub = valuesSubtree[key];
      if (sub && typeof sub === "object" && !Array.isArray(sub)) {
        materializeListsInto(sub as Record<string, unknown>, templateField as AnyConfigNode, lists, kernel);
      }
    }
  }
}

/**
 * Whether an entity is dirty (variant C, phase C3): any of its leaf fields
 * differs from its captured initial value, OR any per-entity list's composition
 * differs from its initial snapshot.
 */
export function isEntityDirty(
  entityNode: EntityNode | EntityGroupNode,
  kernel: Palistor<any, any>,
): boolean {
  const nodeState = kernel.nodes.nodeState;

  const anyLeafDirty = (node: Record<string, unknown>): boolean => {
    for (const key of Object.keys(node)) {
      const field = node[key];
      if (!field || typeof field !== "object") continue;
      if (isLeafNode(field as object)) {
        if ((nodeState.get(field as object) as { dirty?: boolean } | undefined)?.dirty) return true;
      } else if (anyLeafDirty(field as Record<string, unknown>)) {
        return true;
      }
    }
    return false;
  };
  if (anyLeafDirty(entityNode as Record<string, unknown>)) return true;

  const lists = (entityNode as EntityNode).lists;
  if (lists) {
    for (const els of lists.values()) {
      if (!arraysEqual(els.itemIds, els.initialItemIds)) return true;
    }
  }
  return false;
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
 * @param ownerEntityNode  Real owner entity for per-entity lists (C4). Threaded
 *   through nested-group recursion so a list declared inside a structural group
 *   is owned by the nearest ancestor entity (the one with an `id`), not by the
 *   group node — which `entityNode`/`rootEntityNode` reset to on recursion.
 *   Omitted on the top-level call → defaults to `entityNode` itself.
 */
export function buildEntityProjectionProxy(
  entityNode: EntityNode | EntityGroupNode,
  templateNode: AnyConfigNode,
  kernel: Palistor<any, any>,
  entityProxyCache?: WeakMap<object, object>,
  ownerEntityNode?: EntityNode,
): object {
  const cacheKey = entityNode as object;
  const cached = entityProxyCache?.get(cacheKey);
  if (cached) return cached;

  const templateKeys = Object.keys(templateNode).filter((k) => !CONFIG_PROPS.has(k));

  // The top-level entityNode for building entity values in leaf proxies.
  // For nested groups, we still need the root entity node context.
  const rootEntityNode = entityNode as EntityNode;

  // Owner entity for per-entity nested lists. On the top-level call it's the
  // entity itself; preserved across nested-group recursion so list ownership
  // stays anchored to the real entity (C4 blocker fix).
  const listOwnerEntity = ownerEntityNode ?? (entityNode as EntityNode);

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

      // Reverse mapping on input: external → internal. Affects `loading`/`dirty`
      // (mappable keys). Navigation to template fields keeps the original `key`.
      const ikey = kernel.externalToInternal[key] ?? key;

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
        if (ikey === "loading") {
          const eid = getEntityId();
          return kernel.resolveManager.entityStates.get(eid, templateNode as object)?.status === "pending";
        }
        if (ikey === "submitting") {
          const eid = getEntityId();
          return kernel.resolveManager.entityStates.get(eid, templateNode as object)?.submitting === true;
        }
        if (ikey === "submit") {
          if (!submitFnRef) {
            submitFnRef = () => {
              const eid = getEntityId();
              return kernel.executeEntityTemplateSubmit(eid, templateNode, proxy);
            };
          }
          return submitFnRef;
        }
        if (ikey === "values") {
          return buildEntityValuesWithLists(rootEntityNode, templateNode, kernel);
        }
        if (ikey === "dirty") {
          return isEntityDirty(rootEntityNode, kernel);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const templateField = templateNode[key as string];

      // Per-entity nested list (variant C): a list declared inside an entity
      // template. Build an isolated per-(owner,list) proxy. `listOwnerEntity` is
      // the owning EntityNode — for a list directly under the root template it's
      // the entity itself; for a list inside a nested group it's the threaded
      // ancestor entity (C4), not the structural group node.
      if (Array.isArray(templateField)) {
        if (!("id" in listOwnerEntity)) return undefined;
        const listState = kernel.entityRegistry.getOrCreateEntityListState(
          listOwnerEntity,
          templateField as unknown as object,
          kernel.nodes.listFieldKeys.get(templateField as unknown as object)?.join(".") ?? String(key),
        );
        return buildListProxy(listState, kernel);
      }

      if (!templateField || typeof templateField !== "object") {
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
        // Nested group — recurse. Thread the real owner entity so a list
        // declared inside this group is owned by the entity, not the group (C4).
        return buildEntityProjectionProxy(
          entityField as EntityGroupNode,
          templateField as AnyConfigNode,
          kernel,
          undefined,
          listOwnerEntity,
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
      const fwd = kernel.fieldMapping;
      const map = (keys: string[]) => keys.map((k) => fwd[k as MappableKey] ?? k);
      const hasId = "id" in entityNode;
      if (hasId) {
        const keysWithoutId = templateKeys.filter((k) => k !== "id");
        return map(["id", ...keysWithoutId, "loading", "submitting", "submit", "values", "dirty"]);
      }
      return map(templateKeys);
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      const fwd = kernel.fieldMapping;
      const hasId = "id" in entityNode;
      const extraKeys = hasId ? ["loading", "submitting", "submit", "values", "dirty"] : [];
      const keysWithoutId = hasId ? templateKeys.filter((k) => k !== "id") : templateKeys;
      const keys = (hasId ? ["id", ...keysWithoutId, ...extraKeys] : keysWithoutId).map(
        (k) => fwd[k as MappableKey] ?? k,
      );
      if (!keys.includes(key as string)) return undefined;
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  entityProxyCache?.set(cacheKey, proxy);
  return proxy;
}
