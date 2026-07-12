import { type FieldState, resolveFlag } from "../compute/index";
import { TranslateFn, type AnyConfigNode, type ListState, type ListConfig } from "./types";
import { configKeys, hasChildren } from "../traversal";
import { hasComputedProps } from "./hasComputedProps";
import { isListNode } from "./NodeRegistry/nodeUtils";

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
        // Register template fields as a regular group (path = the list key)
        registerNodes(template, undefined, computeNodes, nodeState, path, groupComputeMap, translate, listStates, allListStates);
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
      // Guarded like safeResolveFlag: at registration a computed value runs
      // against the initialValues slice (often {}), not its group scope, so a
      // method call on a sibling value (v.first.trim()) would throw. The
      // registration value is transient — the constructor's first full
      // recompute re-evaluates it against the complete valuesCache.
      let configValue: unknown;
      if (typeof rawValue === "function") {
        try {
          configValue = rawValue(sliceValues);
        } catch {
          configValue = undefined;
        }
      } else {
        configValue = rawValue;
      }
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
    registerNodes(child, (initialSlice as Record<string, unknown> | undefined)?.[key] as InitialSlice<AnyConfigNode> | undefined, computeNodes, nodeState, path, groupComputeMap, translate, listStates, allListStates);
  }
}
