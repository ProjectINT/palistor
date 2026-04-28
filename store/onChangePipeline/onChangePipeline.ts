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
  /** templateField — при entity-mode: onChange ищется в template-дереве, патч применяется к entity-сиблингам. */
  via?: AnyConfigNode;
}

/**
 * OnChangePipeline — fire-and-forget вызов onChange хендлеров
 * при изменении поля: сначала на самом узле (если есть onChange),
 * затем на всех группах-предках с onChange.
 *
 * Для каждого узла с `onChange`:
 * - вычисляется `fieldKey` — имя поля (для самого узла) или путь относительно предка
 * - onChange вызывается асинхронно, не блокируя pipeline записи
 * - если onChange вернул объект-патч — он применяется к store
 *
 * При opts.via — entity-mode: обход onChange через template-иерархию (не entity),
 * allValues — entity-значения из view.parent.getValues().
 */
export class OnChangePipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  fire(node: AnyConfigNode, newValue: unknown, previousValue: unknown, opts?: OnChangeOptions): void {
    const { nodePaths, nodeParents } = this.kernel.nodes;

    if (opts?.via !== undefined) {
      // ── Entity mode: onChange-обход по template-дереву ──
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

    // ── Config mode (существующая логика) ──
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

  /** Применить патч onChange к entity-сиблингам (entity-mode). */
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

  /** Применить патч onChange к config-узлам (config-mode). */
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
