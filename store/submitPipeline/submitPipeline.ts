import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { setGroupRevalidate } from "../dirtyTracking";
import { getSubValues } from "./getSubValues";
import { collectLeafStates } from "./collectLeafStates";
import { applyLeafBeforeSubmit } from "./applyLeafBeforeSubmit";
import type { SubmitResult } from "./types";

export type { SubmitResult };

// ─── Submit pipeline ─────────────────────────────────────────────────────────

/**
 * SubmitPipeline — submit flow для групповых и листовых узлов.
 *
 * Lifecycle:
 *   1. submitting = true + revalidate = true → recompute → notify
 *   2. Собрать значения (поддерево для group, одно значение для leaf)
 *   3. Применить beforeSubmit
 *   4. (group only) Применить group-level beforeSubmit
 *   5. Валидация — если ошибки → return { success: false }
 *   6. Вызвать onSubmit(value, store, parent)
 *   7. Вызвать afterSubmit с результатом и reset-экшеном
 *   8. (group only) Очистка persist
 *   9. submitting = false → recompute → notify
 */
export class SubmitPipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  async execute(node: AnyConfigNode): Promise<SubmitResult> {
    const isLeafNode = "value" in node;
    const nodeState = this.kernel.nodes.nodeState;

    // 1. submitting = true + revalidate = true → recompute → notify
    const prevState = nodeState.get(node);
    nodeState.set(node, { ...prevState!, submitting: true });

    const revalidateChanged = setGroupRevalidate(node, true, nodeState);

    const changed1 = this.kernel.recompute();

    changed1.add(node);
    for (const n of revalidateChanged) changed1.add(n);

    this.kernel.notifyChanged(changed1);

    try {
      let value: unknown;

      if (isLeafNode) {
        // 2. Leaf: get own current value
        value = nodeState.get(node)?.value;

        // 3. Leaf beforeSubmit(value, parentValues)
        if (typeof node.beforeSubmit === "function") {
          const parentNode = (this.kernel.nodes.nodeParents.get(node) ?? this.kernel.rootConfig) as AnyConfigNode;
          const parentValues = this.kernel.values.groupSlot.get(parentNode) ?? this.kernel.values.values;
          value = await (node.beforeSubmit as Function)(value, parentValues);
        }
      } else {
        // 2. Group: collect subtree values
        let values = getSubValues(this.kernel.values, node, this.kernel.rootConfig, this.kernel.nodes.nodePaths);

        // 3. Leaf-level beforeSubmit on group subtree
        values = applyLeafBeforeSubmit(node, values);

        // 4. Group-level beforeSubmit
        if (typeof node.beforeSubmit === "function") {
          values = await (
            node.beforeSubmit as (v: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>
          )(values);
        }

        value = values;
      }

      // 5. Валидация
      if (isLeafNode) {
        const leafState = nodeState.get(node);
        if (leafState?.isInvalid && leafState.errorMessage) {
          const nodePath = this.kernel.nodes.nodePaths.get(node) ?? "";
          return { success: false, errors: [{ path: nodePath, message: leafState.errorMessage }] };
        }
      } else {
        const errors: Array<{ path: string; message: string }> = [];
        const leaves = collectLeafStates(node, nodeState);
        for (const { path, state } of leaves) {
          if (state.isInvalid && state.errorMessage) {
            errors.push({ path, message: state.errorMessage });
          }
        }
        if (errors.length > 0) return { success: false, errors };
      }

      // 6. onSubmit(value, store, parent)
      let result: unknown;
      if (typeof node.onSubmit === "function") {
        const parentNode = this.kernel.nodes.nodeParents.get(node) as AnyConfigNode | undefined;
        const parentProxy = parentNode
          ? this.kernel.nodes.proxyCache.get(parentNode)
          : undefined;
        result = await (node.onSubmit as Function)(value, this.kernel, parentProxy);
      }

      // 7. afterSubmit
      if (typeof node.afterSubmit === "function") {
        const reset = isLeafNode
          ? () => this.kernel.resetPipeline.execute(
              (this.kernel.nodes.nodeParents.get(node) ?? this.kernel.rootConfig) as AnyConfigNode,
            )
          : () => this.kernel.resetPipeline.execute(node);
        await (
          node.afterSubmit as (
            r: unknown,
            actions: { reset: () => void },
          ) => void | Promise<void>
        )(result, { reset });
      }

      // 8. Очистка persist после успешного submit (group only)
      if (!isLeafNode) {
        await this.kernel.persist.clear();
      }

      return { success: true, result };
    } finally {
      // 9. submitting = false → recompute → notify
      const finalState = nodeState.get(node);
      nodeState.set(node, { ...finalState!, submitting: false });
      const changed2 = this.kernel.recompute();
      changed2.add(node);
      this.kernel.notifyChanged(changed2);
    }
  }
}
