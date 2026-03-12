import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify } from "../compute/recompute";
import { findOnChangeAncestors } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";

/**
 * OnChangePipeline — fire-and-forget вызов onChange хендлеров
 * всех групп-предков при изменении поля.
 *
 * Для каждого предка с `onChange`:
 * - вычисляется `fieldKey` — путь изменённого поля относительно этого предка
 * - onChange вызывается асинхронно, не блокируя pipeline записи
 * - если onChange вернул объект-патч — он применяется к store
 */
export class OnChangePipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  fire(node: AnyConfigNode, newValue: unknown, previousValue: unknown): void {
    const { nodeState, nodePaths, nodeParents } = this.kernel.nodes;
    const valuesCache = this.kernel.values;

    const ancestors = findOnChangeAncestors(node, nodeParents);
    if (ancestors.length === 0) return;

    const nodePath = nodePaths.get(node) ?? "";

    for (const ancestor of ancestors) {
      const ancestorPath = nodePaths.get(ancestor) ?? "";
      const fieldKey = computeFieldKey(nodePath, ancestorPath);
      const allValues = valuesCache.values;

      Promise.resolve(
        (ancestor.onChange as Function)({ fieldKey, newValue, previousValue, allValues }),
      )
        .then((patch) => this.applyOnChangeResult(patch, ancestor))
        .catch(() => {
          // onChange ошибки не блокируют работу — fire-and-forget
        });
    }
  }

  /** @internal */
  private applyOnChangeResult(patch: unknown, ancestor: AnyConfigNode): void {
    if (!patch || typeof patch !== "object" || Object.keys(patch as object).length === 0) return;

    const patchChanged = applyPatch(
      ancestor,
      this.kernel.nodes.nodeState,
      patch as Record<string, unknown>,
      new Set(),
      this.kernel.values,
    );
    if (patchChanged.size > 0) {
      recomputeAndNotify(
        patchChanged,
        () => this.kernel.recomputeAll(),
        (c) => this.kernel.notifyChanged(c),
      );
    }
  }
}
