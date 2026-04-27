import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify } from "../compute/recompute";
import { findOnChangeNodes } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";
import { isLeafNode } from "../traversal";

/**
 * OnChangePipeline — fire-and-forget вызов onChange хендлеров
 * при изменении поля: сначала на самом узле (если есть onChange),
 * затем на всех группах-предках с onChange.
 *
 * Для каждого узла с `onChange`:
 * - вычисляется `fieldKey` — имя поля (для самого узла) или путь относительно предка
 * - onChange вызывается асинхронно, не блокируя pipeline записи
 * - если onChange вернул объект-патч — он применяется к store
 */
export class OnChangePipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  fire(node: AnyConfigNode, newValue: unknown, previousValue: unknown): void {
    const { nodePaths, nodeParents } = this.kernel.nodes;
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
        .then((patch) => this.applyOnChangeResult(patch, target))
        .catch(() => {
          // onChange ошибки не блокируют работу — fire-and-forget
        });
    }
  }

  /** @internal */
  private applyOnChangeResult(patch: unknown, sourceNode: AnyConfigNode): void {
    if (!patch || typeof patch !== "object" || Object.keys(patch as object).length === 0) return;

    // For leaf onChange: apply patch to parent group (leaf cannot patch itself)
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
