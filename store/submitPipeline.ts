import { collectValues, type AnyConfigNode } from "./collectValues";
import { CONFIG_PROPS } from "./constants";
import type { FieldState } from "./compute";

// ─── Типы ────────────────────────────────────────────────────────────────────

/** Результат выполнения submit pipeline. */
export type SubmitResult =
  | { success: true; result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };

export interface SubmitDeps {
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  resetNode: (groupNode: AnyConfigNode, values?: Record<string, unknown>) => void;
}

// ─── Внутренние утилиты ──────────────────────────────────────────────────────

/**
 * Собирает все листовые узлы поддерева с их путями и текущим состоянием.
 * Используется для валидации при submit.
 */
function collectLeafStates(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
): Array<{ path: string; state: FieldState }> {
  const result: Array<{ path: string; state: FieldState }> = [];

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if ("value" in child) {
      const state = nodeState.get(child);
      if (state) result.push({ path, state });
    } else {
      result.push(...collectLeafStates(child, nodeState, path));
    }
  }

  return result;
}

/**
 * Применяет leaf-level `beforeSubmit` трансформации к snapshot'у значений.
 * Не мутирует store — работает с копией.
 */
function applyLeafBeforeSubmit(
  node: AnyConfigNode,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...values };

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      if (typeof child.beforeSubmit === "function") {
        result[key] = (
          child.beforeSubmit as (v: unknown, vals: Record<string, unknown>) => unknown
        )(result[key], values);
      }
    } else {
      const childValues = result[key];
      if (childValues && typeof childValues === "object" && !Array.isArray(childValues)) {
        result[key] = applyLeafBeforeSubmit(child, childValues as Record<string, unknown>);
      }
    }
  }

  return result;
}

// ─── Submit pipeline ─────────────────────────────────────────────────────────

/**
 * Submit pipeline для группового узла.
 *
 * Lifecycle:
 *   1. submitting = true → recompute → notify
 *   2. Собрать текущие значения поддерева
 *   3. Применить leaf-level beforeSubmit (на snapshot, без мутации store)
 *   4. Применить group-level beforeSubmit
 *   5. Валидация всех листьев — если есть ошибки → return { success: false }
 *   6. Вызвать onSubmit (пользовательский callback)
 *   7. Вызвать afterSubmit с результатом и reset-экшеном
 *   8. submitting = false → recompute → notify
 */
export async function executeSubmit(
  groupNode: AnyConfigNode,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const { nodeState, recomputeAll, notifyChanged, resetNode } = deps;

  // 1. submitting = true → update nodeState → recompute → notify
  const prevState = nodeState.get(groupNode);
  nodeState.set(groupNode, { ...prevState!, submitting: true });
  const changed1 = recomputeAll();
  changed1.add(groupNode);
  notifyChanged(changed1);

  try {
    // 2. Собрать значения (без $submitting — это внутреннее свойство)
    let values = collectValues(groupNode, nodeState, true);

    // 3. Leaf-level beforeSubmit
    values = applyLeafBeforeSubmit(groupNode, values);

    // 4. Group-level beforeSubmit
    if (typeof groupNode.beforeSubmit === "function") {
      values = (
        groupNode.beforeSubmit as (v: Record<string, unknown>) => Record<string, unknown>
      )(values);
    }

    // 5. Валидация
    const errors: Array<{ path: string; message: string }> = [];
    const leaves = collectLeafStates(groupNode, nodeState);
    for (const { path, state } of leaves) {
      if (state.error && state.errorMessage) {
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

    return { success: true, result };
  } finally {
    // 8. submitting = false → update nodeState → recompute → notify
    const finalState = nodeState.get(groupNode);
    nodeState.set(groupNode, { ...finalState!, submitting: false });
    const changed2 = recomputeAll();
    changed2.add(groupNode);
    notifyChanged(changed2);
  }
}
