import { type FieldState, resolveFlag } from "../compute/index";
import { TranslateFn, type AnyConfigNode, type ListState, type ListConfig } from "./types";
import { configKeys, hasChildren } from "../traversal";
import { hasComputedProps } from "./hasComputedProps";
import { isListNode } from "./NodeRegistry/nodeUtils";
import { normalizeFilterBlock } from "../filtering/normalizeFilterBlock";
import { registerFilterNodes } from "../filtering/registerFilterNodes";
import { createPaginationState } from "../pagination/paginationController";

/**
 * Service keys of a config node that tree walks skip.
 * Mirrors the runtime CONFIG_PROPS set at the type level.
 */
type ConfigPropKeys =
  | "value"
  | "label"
  | "placeholder"
  | "description"
  | "isRequired"
  | "isReadOnly"
  | "isDisabled"
  | "isVisible"
  | "isInvalid"
  | "errorMessage"
  | "validate"
  | "formatter"
  | "setter"
  | "componentProps"
  | "types"
  | "dependencies";

/**
 * Recursive initial-values type mirroring the config structure:
 * - Service keys are skipped.
 * - Leaf nodes (with `value`) → the value type (or `unknown` for a computed function).
 * - Group nodes → nested `InitialSlice`.
 * - All fields are optional.
 */
export type InitialSlice<TNode> = {
  [K in keyof TNode as K extends ConfigPropKeys ? never : K]?:
    TNode[K] extends { value: infer V }
      ? V extends (values: any) => infer R ? R : V
      : TNode[K] extends Record<string, any>
        ? InitialSlice<TNode[K]>
        : unknown;
};

/**
 * Phase 1: collect all compute nodes and set initial values.
 * Computed props are not evaluated yet — that requires all values.
 */
type MaybeFlag = boolean | ((values: any) => boolean) | undefined;

export type ComputeEntry = { node: AnyConfigNode; path: string };

/**
 * Group node → array of its direct child entries (leaves + groups with
 * computed props). All entries are stored under the parent group, uniformly.
 *
 * Used by recomputeTargeted to recompute a subtree.
 */
export type GroupComputeMap = WeakMap<object, ComputeEntry[]>;

/** Get or create the entry list for a group. */
function getOrCreateComputeList(map: GroupComputeMap, group: object): ComputeEntry[] {
  let list = map.get(group);
  if (!list) {
    list = [];
    map.set(group, list);
  }
  return list;
}

/**
 * resolveFlag guarded against exceptions during init: computed flags
 * (isVisible etc.) may read values of sibling groups that don't exist in
 * initialSlice yet (`values.goalSelection.goal`). Init falls back to the
 * default — the first full recompute() in the constructor re-evaluates the
 * flag against the complete valuesCache.
 */
function safeResolveFlag(
  configValue: MaybeFlag,
  sliceValues: Record<string, unknown>,
  defaultValue: boolean,
  translate: TranslateFn,
): boolean {
  try {
    return resolveFlag(configValue, sliceValues, defaultValue, translate);
  } catch {
    return defaultValue;
  }
}

/**
 * Reject a computed `value` inside a list template.
 *
 * Per-item computed values are not implemented in the entity path: an item's
 * value comes from its entity leaf, and `rules.value` is never invoked as a
 * function (buildProxy, entity-leaf `case "value"`) — unlike label/isVisible/
 * validate, which do run per item at read time. Nor can the template node be
 * recomputed globally: it is a single shared node with no per-item identity,
 * and evaluating it against the root values is what used to crash construction.
 *
 * Fail loudly at construction with the field's path rather than leaking the raw
 * function onto `item.field.value`.
 */
function assertNoComputedValues(
  template: AnyConfigNode,
  listPath: string,
  innerPath = "",
): void {
  for (const key of configKeys(template as Record<string, unknown>)) {
    const child = (template as Record<string, unknown>)[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;

    const childPath = innerPath ? `${innerPath}.${key}` : key;

    if ("value" in child) {
      if (typeof (child as { value: unknown }).value === "function") {
        throw new Error(
          `[palistor] a computed "value" is not supported inside a list template yet ` +
            `("${listPath}[].${childPath}"). An item's value comes from its entity, and ` +
            `nothing recomputes it per item, so the rule would never run. For now derive ` +
            `the value in the component, or use a computed "label" on the template field ` +
            `— those do run per item.`,
        );
      }
      continue;
    }

    assertNoComputedValues(child as AnyConfigNode, listPath, childPath);
  }
}

export function registerNodes<TNode extends AnyConfigNode>(
  node: TNode,
  initialSlice: InitialSlice<TNode> | undefined,
  computeNodes: ComputeEntry[],
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
  groupComputeMap: GroupComputeMap,
  translate: TranslateFn,
  listStates?: WeakMap<object, ListState>,
  allListStates?: ListState[],
  /** true while walking a list template — per-entity lists get no FilterState in Phase 1. */
  inTemplate = false,
) {
  for (const key of configKeys(node as Record<string, unknown>)) {

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    // Stamp the __kind marker on every config node
    (child as any).__kind = hasChildren(child) ? "group" : "leaf";

    if (Array.isArray(child)) {
      // ListNode: create a ListState + register the template as a regular group
      if (isListNode(child) && listStates) {
        const template = child[0] as AnyConfigNode;
        assertNoComputedValues(template, path);
        const listConfig = child.length > 1 ? (child[1] as ListConfig) : undefined;
        const listState: ListState = {
          listConfigNode: child,
          template,
          listConfig,
          ownerEntity: null,
          itemIds: [],
          initialItemIds: [],
        };
        listStates.set(child, listState);
        if (allListStates) allListStates.push(listState);

        // Declared filter block: register its fields as ordinary leaf nodes in
        // the reserved `$filters.<listPath>` namespace and attach the sidecar.
        // Per-entity (nested) lists are Phase 3 — dev warning, no FilterState.
        const filterBlock = (listConfig as { filter?: Record<string, unknown> } | undefined)?.filter;
        if (filterBlock) {
          if (inTemplate) {
            console.warn(
              `[palistor] filter on nested list "${path}" is not supported yet — ignored ` +
                `(per-entity list filters are a later phase).`,
            );
          } else {
            const normalized = normalizeFilterBlock(filterBlock, path);
            listState.filter = registerFilterNodes(
              normalized,
              listState,
              path,
              computeNodes,
              nodeState,
              groupComputeMap,
              translate,
            );
          }
        }

        // Pagination sidecar on the ROOT ListState. The template-level
        // ListState of a nested list is a placeholder and never paginated:
        // every per-entity instance gets its own sidecar when EntityRegistry
        // instantiates it (`getOrCreateEntityListState`).
        const paginationBlock = listConfig?.resolve?.pagination;
        if (paginationBlock && !inTemplate) {
          listState.pagination = createPaginationState(paginationBlock, path);
        }

        // Register template fields as a regular group (path = the list key)
        registerNodes(template, undefined, computeNodes, nodeState, path, groupComputeMap, translate, listStates, allListStates, true);
      }
      continue;
    }

    if ("value" in child) {
      // Leaf node: record it and set the initial value (computed props come later)
      const entry: ComputeEntry = { node: child, path };
      computeNodes.push(entry);
      // Add to the current group's compute list (node is the parent)
      getOrCreateComputeList(groupComputeMap, node).push(entry);

      const rawSlice = initialSlice as Record<string, unknown> | undefined;
      const sliceValues = (rawSlice ?? {}) as Record<string, unknown>;
      const rawValue = child.value;
      // A computed value is NOT evaluated here. At registration the only scope
      // available is the initialValues slice (often `{}`) — a different shape
      // than the group-scoped values the function is written against, so
      // `v.first.trim()` would throw and `v.price * v.qty` would silently yield
      // NaN. The value is transient anyway: the constructor's first full
      // recompute evaluates every computed leaf against the complete
      // valuesCache in topological order, before the dirty baseline is captured.
      const configValue = typeof rawValue === "function" ? undefined : rawValue;
      const initialValue = rawSlice?.[key] ?? configValue ?? "";
      nodeState.set(child, {
        value: initialValue,
        isVisible:  safeResolveFlag(child.isVisible  as MaybeFlag, sliceValues, true, translate),
        isRequired: safeResolveFlag(child.isRequired as MaybeFlag, sliceValues, false, translate),
        isDisabled: safeResolveFlag(child.isDisabled as MaybeFlag, sliceValues, false, translate),
        isReadOnly: safeResolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false, translate),
        dirty: false,
        revalidate: false,
      });
    }

    // Group node: always add to nodeState (value is filled in buildValuesCache).
    // If it has computed props (isVisible etc.) — add to computeNodes under the PARENT.
    if (!("value" in child)) {
      const sliceValues = (initialSlice as Record<string, unknown> | undefined ?? {}) as Record<string, unknown>;
      nodeState.set(child, {
        value: undefined,
        isVisible:  safeResolveFlag(child.isVisible  as MaybeFlag, sliceValues, true, translate),
        isRequired: safeResolveFlag(child.isRequired as MaybeFlag, sliceValues, false, translate),
        isDisabled: safeResolveFlag(child.isDisabled as MaybeFlag, sliceValues, false, translate),
        isReadOnly: safeResolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false, translate),
        dirty: false,
        revalidate: false,
      });
      if (hasComputedProps(child)) {
        const entry: ComputeEntry = { node: child, path };
        computeNodes.push(entry);
        // A group with computed props is stored under its PARENT (uniform with leaves)
        getOrCreateComputeList(groupComputeMap, node).push(entry);
      }
    }

    // Recurse into children
    registerNodes(child, (initialSlice as Record<string, unknown> | undefined)?.[key] as InitialSlice<AnyConfigNode> | undefined, computeNodes, nodeState, path, groupComputeMap, translate, listStates, allListStates, inTemplate);
  }
}
