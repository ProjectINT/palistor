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
 * SubmitPipeline — submit flow для группового узла.
 *
 * Lifecycle:
 *   1. submitting = true + revalidate = true → recompute → notify
 *   2. Собрать текущие значения поддерева
 *   3. Применить leaf-level beforeSubmit
 *   4. Применить group-level beforeSubmit
 *   5. Валидация листьев — если ошибки → return { success: false }
 *   6. Вызвать onSubmit
 *   7. Вызвать afterSubmit с результатом и reset-экшеном
 *   8. Очистка persist
 *   9. submitting = false → recompute → notify
 */
export class SubmitPipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  async execute(groupNode: AnyConfigNode): Promise<SubmitResult> {
    const nodeState = this.kernel.nodes.nodeState;

    // 1. submitting = true + revalidate = true → recompute → notify
    const prevState = nodeState.get(groupNode);
    nodeState.set(groupNode, { ...prevState!, submitting: true });

    const revalidateChanged = setGroupRevalidate(groupNode, true, nodeState);

    const changed1 = this.kernel.recompute();
    changed1.add(groupNode);
    for (const n of revalidateChanged) changed1.add(n);
    this.kernel.notifyChanged(changed1);

    try {
      // 2. Собрать значения поддерева
      let values = getSubValues(this.kernel.values, groupNode, this.kernel.rootConfig, this.kernel.nodes.nodePaths);

      // 3. Leaf-level beforeSubmit
      values = applyLeafBeforeSubmit(groupNode, values);

      // 4. Group-level beforeSubmit
      if (typeof groupNode.beforeSubmit === "function") {
        values = await (
          groupNode.beforeSubmit as (v: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>
        )(values);
      }

      // 5. Валидация
      const errors: Array<{ path: string; message: string }> = [];

      const leaves = collectLeafStates(groupNode, nodeState);

      for (const { path, state } of leaves) {
        if (state.isInvalid && state.errorMessage) {
          errors.push({ path, message: state.errorMessage });
        }
      }

      if (errors.length > 0) {
        return { success: false, errors };
      }

      // 6. onSubmit
      let result: unknown;
      if (typeof groupNode.onSubmit === "function") {
        result = await (
          groupNode.onSubmit as (v: Record<string, unknown>, store: unknown) => Promise<unknown> | unknown
        )(values, this.kernel);
      }

      // 7. afterSubmit
      if (typeof groupNode.afterSubmit === "function") {
        const reset = () => this.kernel.resetPipeline.execute(groupNode);
        await (
          groupNode.afterSubmit as (
            r: unknown,
            actions: { reset: () => void },
          ) => void | Promise<void>
        )(result, { reset });
      }

      // 8. Очистка persist после успешного submit
      await this.kernel.persist.clear();

      return { success: true, result };
    } finally {
      // 9. submitting = false → recompute → notify
      const finalState = nodeState.get(groupNode);
      nodeState.set(groupNode, { ...finalState!, submitting: false });
      const changed2 = this.kernel.recompute();
      changed2.add(groupNode);
      this.kernel.notifyChanged(changed2);
    }
  }
}
