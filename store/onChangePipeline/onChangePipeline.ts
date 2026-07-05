import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import type { NodeView } from "../store/NodeRegistry/nodeView";
import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify } from "../compute/recompute";
import { findOnChangeNodes } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";
import { isLeafNode } from "../traversal";
import { storeValue } from "../writePipeline/storeValue";

export interface OnChangeOptions {
  /** templateField — in entity mode: onChange is looked up in the template tree, the patch is applied to entity siblings. */
  via?: AnyConfigNode;
}

/**
 * OnChangePipeline — fire-and-forget invocation of onChange handlers when a
 * field changes: first on the node itself (if it has onChange), then on all
 * ancestor groups with onChange.
 *
 * For every node with `onChange`:
 * - `fieldKey` is computed — the field name (for the node itself) or the path relative to the ancestor
 * - onChange runs asynchronously, without blocking the write pipeline
 * - a returned patch object is applied to the store
 *
 * With opts.via — entity mode: the onChange walk goes through the template
 * hierarchy (not the entity); allValues are the entity values from
 * view.parent.getValues().
 */
export class OnChangePipeline {
  constructor(private readonly kernel: Palistor<any, any>) {}

  fire(node: AnyConfigNode, newValue: unknown, previousValue: unknown, opts?: OnChangeOptions): void {
    const { nodePaths, nodeParents } = this.kernel.nodes;

    if (opts?.via !== undefined) {
      // ── Entity mode: onChange walk over the template tree ──
      const view = this.kernel.nodes.getView(node, opts.via);
      const onChangeNodes = findOnChangeNodes(view.rules as object, nodeParents);
      if (onChangeNodes.length === 0) return;

      const nodePath = nodePaths.get(view.rules as object) ?? "";
      const allValues = view.parent.getValues();

      for (const target of onChangeNodes) {
        const targetPath = nodePaths.get(target) ?? "";
        const fieldKey = computeFieldKey(nodePath, targetPath);
        Promise.resolve()
          .then(() => (target.onChange as Function)({ fieldKey, newValue, previousValue, allValues }))
          .then((patch) => this._applyEntityOnChangeResult(patch, view))
          .catch(() => {});
      }
      return;
    }

    // ── Config mode ──
    const valuesCache = this.kernel.values;
    const onChangeNodes = findOnChangeNodes(node, nodeParents);
    if (onChangeNodes.length === 0) return;

    const nodePath = nodePaths.get(node) ?? "";

    for (const target of onChangeNodes) {
      const targetPath = nodePaths.get(target) ?? "";
      const fieldKey = computeFieldKey(nodePath, targetPath);
      const allValues = valuesCache.values;

      Promise.resolve()
        .then(() => (target.onChange as Function)({ fieldKey, newValue, previousValue, allValues }))
        .then((patch) => this._applyOnChangeResult(patch, target))
        .catch(() => {});
    }
  }

  /** Apply an onChange patch to entity siblings (entity mode). */
  private _applyEntityOnChangeResult(patch: unknown, view: NodeView): void {
    if (!patch || typeof patch !== "object" || Object.keys(patch as object).length === 0) return;

    const entityParent = this.kernel.nodes.nodeParents.get(view.storage as object) as
      | Record<string, unknown>
      | undefined;
    if (!entityParent) return;

    const nodeState = this.kernel.nodes.nodeState;
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
          this.kernel.values,
        );
        if (stored) {
          (entityField as { value: unknown }).value = patchValue;
          patchedNodes.add(entityField as object);
        }
      }
    }

    if (patchedNodes.size > 0) {
      recomputeAndNotify(
        patchedNodes,
        () => this.kernel.recompute(patchedNodes),
        (c) => this.kernel.notifyChanged(c),
      );
    }
  }

  /** Apply an onChange patch to config nodes (config mode). */
  private _applyOnChangeResult(patch: unknown, sourceNode: AnyConfigNode): void {
    if (!patch || typeof patch !== "object" || Object.keys(patch as object).length === 0) return;

    const targetNode = isLeafNode(sourceNode)
      ? ((this.kernel.nodes.nodeParents.get(sourceNode) ?? this.kernel.rootConfig) as AnyConfigNode)
      : sourceNode;

    const patchChanged = applyPatch(
      targetNode,
      this.kernel.nodes.nodeState,
      patch as Record<string, unknown>,
      new Set(),
      this.kernel.values,
    );
    if (patchChanged.size > 0) {
      recomputeAndNotify(
        patchChanged,
        () => this.kernel.recompute(),
        (c) => this.kernel.notifyChanged(c),
      );
    }
  }
}
