import { type AnyConfigNode } from "../store/types";
import { setGroupRevalidate } from "../dirtyTracking";
import { getSubValues } from "./getSubValues";
import { collectLeafStates } from "./collectLeafStates";
import { applyLeafBeforeSubmit } from "./applyLeafBeforeSubmit";
import type { SubmitDeps, SubmitResult } from "./types";

export type { SubmitResult, SubmitDeps };

// ─── Submit pipeline ─────────────────────────────────────────────────────────

/**
 * Submit pipeline для группового узла.
 *
 * Lifecycle:
 *   1. submitting = true + revalidate = true → recompute → notify
 *      (revalidate forces error computation for all leaves)
 *   2. Собрать текущие значения поддерева
 *   3. Применить leaf-level beforeSubmit (на snapshot, без мутации store)
 *   4. Применить group-level beforeSubmit
 *   5. Валидация всех листьев — если есть ошибки → return { success: false }
 *      (revalidate stays true — errors will show on subsequent input)
 *   6. Вызвать onSubmit (пользовательский callback)
 *   7. Вызвать afterSubmit с результатом и reset-экшеном
 *   8. submitting = false → recompute → notify
 */
export async function executeSubmit(
  groupNode: AnyConfigNode,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const { nodeState, recomputeAll, notifyChanged, resetNode, valuesCache, nodePaths, rootConfig } = deps;

  // 1. submitting = true + revalidate = true → recompute → notify
  //    Setting revalidate=true BEFORE recompute ensures computeFieldState
  //    will run validation for all leaves.
  const prevState = nodeState.get(groupNode);
  nodeState.set(groupNode, { ...prevState!, submitting: true });

  // Propagate revalidate=true to all descendants so validation kicks in
  const revalidateChanged = setGroupRevalidate(groupNode, true, nodeState);

  const changed1 = recomputeAll();
  changed1.add(groupNode);
  for (const n of revalidateChanged) changed1.add(n);
  notifyChanged(changed1);

  try {
    // 2. Собрать значения поддерева
    let values = getSubValues(valuesCache, groupNode, rootConfig, nodePaths);

    // 3. Leaf-level beforeSubmit
    values = applyLeafBeforeSubmit(groupNode, values);

    // 4. Group-level beforeSubmit
    if (typeof groupNode.beforeSubmit === "function") {
      values = (
        groupNode.beforeSubmit as (v: Record<string, unknown>) => Record<string, unknown>
      )(values);
    }

    // 5. Валидация — recompute at step 1 with revalidate=true already
    //    computed errors for all leaves. Now collect them.
    const errors: Array<{ path: string; message: string }> = [];
    const leaves = collectLeafStates(groupNode, nodeState);
    for (const { path, state } of leaves) {
      if (state.isInvalid && state.errorMessage) {
        errors.push({ path, message: state.errorMessage });
      }
    }

    if (errors.length > 0) {
      // revalidate stays true — subsequent input will show/clear errors in real-time
      return { success: false, errors };
    }

    // 6. onSubmit
    let result: unknown;
    if (typeof groupNode.onSubmit === "function") {
      result = await (
        groupNode.onSubmit as (v: Record<string, unknown>) => Promise<unknown> | unknown
      )(values);
    }

    // 7. afterSubmit
    if (typeof groupNode.afterSubmit === "function") {
      const reset = () => resetNode(groupNode);
      await (
        groupNode.afterSubmit as (
          r: unknown,
          actions: { reset: () => void },
        ) => void | Promise<void>
      )(result, { reset });
    }

    // 8. Очистка persist после успешного submit
    if (deps.clearPersist) {
      await deps.clearPersist();
    }

    return { success: true, result };
  } finally {
    // 9. submitting = false → update nodeState → recompute → notify
    const finalState = nodeState.get(groupNode);
    nodeState.set(groupNode, { ...finalState!, submitting: false });
    const changed2 = recomputeAll();
    changed2.add(groupNode);
    notifyChanged(changed2);
  }
}
