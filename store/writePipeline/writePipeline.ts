import type { AnyConfigNode } from "../store/types";
import type { WriteResult } from "./types";
import type { Palistor } from "../store/palistor";
import { formatValue } from "./formatValue";
import { storeValue } from "./storeValue";
import { runSetter } from "./runSetter";
import { mergeChanged } from "./mergeChanged";
import { isLeafNode } from "../traversal";
import type { FieldState } from "../compute/index";

export type { WriteResult } from "./types";
export type { Setter } from "./types";
export { formatValue } from "./formatValue";
export { formatPatch } from "./formatPatch";
export { storeValue } from "./storeValue";
export { runSetter } from "./runSetter";
export { mergeChanged } from "./mergeChanged";

export interface WriteOptions {
  /** templateField — used for entity leaves: rules come from the template, storage from the entityLeaf. */
  via?: AnyConfigNode;
}

/**
 * WritePipeline — the full write pipeline: format → store → (setter?) → recompute → merge changed.
 *
 * Always writes the value to the current node via storeValue.
 * If the node has a setter — additionally patches dependent fields.
 *
 * With opts.via — entity mode: rules (formatter, setter) come from the
 * templateField; storage and recompute operate on the entityLeaf (view.storage).
 */
export class WritePipeline {
  constructor(private readonly kernel: Palistor<any, any>) {}

  execute(
    node: AnyConfigNode,
    rawValue: unknown,
    previousValue?: unknown,
    opts?: WriteOptions,
  ): WriteResult | null {
    const view = this.kernel.nodes.getView(node, opts?.via);
    const isEntityMode = opts?.via !== undefined;
    const nodeState = this.kernel.nodes.nodeState;
    const valuesCache = this.kernel.values;

    // Format (entity: parentValues from the view; config: from valuesCache)
    const allValues = isEntityMode ? view.parent.getValues() : valuesCache.values;
    const processedValue = formatValue(rawValue, view.rules, allValues);

    // Fast exit — value unchanged
    const currentState = nodeState.get(view.storage);
    if (currentState && Object.is(processedValue, currentState.value)) {
      return { changed: new Set<object>(), skipped: true };
    }

    // Direct value write
    const stored = storeValue(view.storage, processedValue, nodeState, valuesCache);
    if (!stored) return null;

    // Entity sync: keep the entityLeaf's raw value current
    // (needed by walkAndSyncEntityNode on the next upsert)
    if (isEntityMode) {
      (view.storage as unknown as { value: unknown }).value = processedValue;
    }

    // Setter branch — patch dependent fields
    let patchedNodes: Set<object>;
    if (typeof view.rules.setter === "function") {
      if (isEntityMode) {
        // Entity mode: siblings live in the entity tree (not the config)
        const entityParent = this.kernel.nodes.nodeParents.get(view.storage as object) as
          | Record<string, unknown>
          | undefined;
        patchedNodes = entityParent
          ? this._applyEntitySetterPatch(
              view.rules.setter as Function,
              processedValue,
              allValues,
              previousValue,
              entityParent,
              nodeState,
              valuesCache,
            )
          : new Set<object>();
      } else {
        const parentNode = (this.kernel.nodes.nodeParents.get(node) ?? this.kernel.rootConfig) as AnyConfigNode;
        const parentPath = this.kernel.nodes.nodePaths.get(parentNode);
        patchedNodes = runSetter(node, processedValue, parentNode, nodeState, valuesCache, parentPath, previousValue);
      }
    } else {
      patchedNodes = new Set<object>();
    }

    // Targeted recompute of the affected groups
    const changedSoFar = new Set<object>([view.storage]);
    for (const n of patchedNodes) changedSoFar.add(n);
    const recomputedNodes = this.kernel.recompute(changedSoFar);

    // Merge all changed nodes
    return { changed: mergeChanged(view.storage, patchedNodes, recomputedNodes) };
  }

  /** Apply a setter patch to the entity leaf's siblings (storage tree, not the template). */
  private _applyEntitySetterPatch(
    setter: Function,
    processedValue: unknown,
    parentValues: Record<string, unknown>,
    previousValue: unknown,
    entityParent: Record<string, unknown>,
    nodeState: WeakMap<object, FieldState>,
    valuesCache: import("../valuesCache/valuesCache").ValuesCache,
  ): Set<object> {
    const patch = setter(processedValue, parentValues, previousValue) as unknown;
    if (!patch || typeof patch !== "object") {
      console.error("[Palistor] entity setter must return an object, got:", typeof patch);
      return new Set();
    }
    const patchedNodes = new Set<object>();
    for (const k of Object.keys(patch as object)) {
      if (k === "id") continue;
      const entityField = entityParent[k];
      if (entityField && typeof entityField === "object" && isLeafNode(entityField as object)) {
        const patchValue = (patch as Record<string, unknown>)[k];
        const stored = storeValue(
          entityField as unknown as AnyConfigNode,
          patchValue,
          nodeState,
          valuesCache,
        );
        if (stored) {
          (entityField as { value: unknown }).value = patchValue;
          patchedNodes.add(entityField as object);
        }
      }
    }
    return patchedNodes;
  }
}
