import { type AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { setGroupRevalidate } from "../dirtyTracking";
import { collectLeafStates } from "./collectLeafStates";
import { applyLeafBeforeSubmit } from "./applyLeafBeforeSubmit";
import type { SubmitResult } from "./types";
import { isLeafNode } from "../traversal";
import { computeFieldState } from "../compute";
import { filterHiddenFlowStepErrors } from "../flow/flowNavigation";

export type { SubmitResult };

/**
 * Context passed when submitting an entity leaf through a template field.
 * The view (parentProxy, parentValues, onReset) is resolved via NodeRegistry.getView(node, via).
 */
export interface EntityLeafSubmitOptions {
  /** templateField — source of callbacks: beforeSubmit, validate, onSubmit, afterSubmit */
  via: AnyConfigNode;
}

// ─── Submit pipeline ─────────────────────────────────────────────────────────

/**
 * SubmitPipeline — the submit flow for group and leaf nodes.
 *
 * Lifecycle:
 *   1. submitting = true + revalidate = true → recompute → notify
 *   2. Collect values (subtree for a group, a single value for a leaf)
 *   3. Apply beforeSubmit
 *   4. (group only) Apply group-level beforeSubmit
 *   5. Validate — on errors → return { success: false }
 *   6. Call onSubmit(value, store, parent)
 *   7. Call afterSubmit with the result and a reset action
 *   8. (group only) Clear persist
 *   9. submitting = false → recompute → notify
 */
export class SubmitPipeline {
  constructor(private readonly kernel: Palistor<any, any>) {}

  async execute(node: AnyConfigNode, entityOpts?: EntityLeafSubmitOptions): Promise<SubmitResult> {
    const view = this.kernel.nodes.getView(node, entityOpts?.via);
    const isLeaf = isLeafNode(node);
    const nodeState = this.kernel.nodes.nodeState;

    // 1. submitting = true + revalidate = true → recompute → notify
    const prevState = nodeState.get(view.storage);
    nodeState.set(view.storage, { ...prevState!, submitting: true });

    const revalidateChanged = setGroupRevalidate(view.storage, true, nodeState);

    const changed1 = this.kernel.recompute();

    changed1.add(view.storage);
    for (const n of revalidateChanged) changed1.add(n);

    this.kernel.notifyChanged(changed1);

    try {
      let value: unknown;

      if (isLeaf) {
        // 2. Leaf: get own current value
        value = nodeState.get(view.storage)?.value;

        // 3. Leaf beforeSubmit(value, parentValues)
        if (typeof view.rules.beforeSubmit === "function") {
          value = await (view.rules.beforeSubmit as Function)(value, view.parent.getValues());
        }
      } else {
        // 2. Group: unified entry — nodeState.value is the groupSlot reference for non-root groups;
        // root config may not be in nodeState, so fall back to groupSlot directly.
        const groupValue = (nodeState.get(view.storage)?.value ?? this.kernel.values.groupSlot.get(view.storage) ?? {}) as Record<string, unknown>;
        let values = structuredClone(groupValue) as Record<string, unknown>;

        // 3. Leaf-level beforeSubmit on group subtree
        values = applyLeafBeforeSubmit(view.storage, values);

        // 4. Group-level beforeSubmit
        if (typeof view.rules.beforeSubmit === "function") {
          values = await (
            view.rules.beforeSubmit as (v: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>
          )(values);
        }

        value = values;
      }

      // 5. Validation
      if (isLeaf) {
        if (entityOpts?.via) {
          // Entity leaf: validate directly via template rules — not covered by the recompute system
          // (computeFieldState runs on the node itself, but entity leaves carry no rules; those live on templateField).
          const { isInvalid, errorMessage } = computeFieldState(
            view.rules as Record<string, any>,
            value,
            view.parent.getValues(),
            true,
            this.kernel.services.translate,
          );
          if (isInvalid && errorMessage) {
            const nodePath = this.kernel.nodes.nodePaths.get(view.storage as object) ?? "";
            return { success: false, errors: [{ path: nodePath, message: errorMessage }] };
          }
        } else {
          const leafState = nodeState.get(view.storage);
          if (leafState?.isInvalid && leafState.errorMessage) {
            const nodePath = this.kernel.nodes.nodePaths.get(view.storage as object) ?? "";
            return { success: false, errors: [{ path: nodePath, message: leafState.errorMessage }] };
          }
        }
      } else {
        let errors: Array<{ path: string; message: string }> = [];
        const leaves = collectLeafStates(view.storage, nodeState);
        for (const { path, state } of leaves) {
          if (state.isInvalid && state.errorMessage) {
            errors.push({ path, message: state.errorMessage });
          }
        }
        // Flow: leaves under HIDDEN steps don't block submit — otherwise an
        // untaken branch with isRequired fields would make finalization impossible.
        errors = filterHiddenFlowStepErrors(this.kernel, errors, view.storage);
        if (errors.length > 0) return { success: false, errors };
      }

      // 6. onSubmit(value, store, parent)
      let result: unknown;
      if (typeof view.rules.onSubmit === "function") {
        result = await (view.rules.onSubmit as Function)(value, this.kernel, view.parent.proxy);
      }

      // 7. afterSubmit
      if (typeof view.rules.afterSubmit === "function") {
        const reset = isLeaf
          ? view.onReset
          : () => this.kernel.resetPipeline.execute(view.storage);
        await (
          view.rules.afterSubmit as (
            r: unknown,
            actions: { reset: () => void },
          ) => void | Promise<void>
        )(result, { reset });
      }

      // 8. Clear persist after a successful submit (group only)
      if (!isLeaf) {
        await this.kernel.persist.clear();
      }

      return { success: true, result };
    } finally {
      // 9. submitting = false → recompute → notify
      const finalState = nodeState.get(view.storage);
      nodeState.set(view.storage, { ...finalState!, submitting: false });
      const changed2 = this.kernel.recompute();
      changed2.add(view.storage);
      this.kernel.notifyChanged(changed2);
    }
  }
}
