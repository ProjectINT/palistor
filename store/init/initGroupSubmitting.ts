import type { FieldState } from "../compute/index";
import type { AnyConfigNode } from "../store/types";
import { walkFull } from "../traversal";

/**
 * Initializes submitting: false, dirty: false, revalidate: false
 * in nodeState for the root and all nested group nodes.
 */
export function initGroupSubmitting(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
) {
  // Initialize the root node itself (walkFull doesn't visit it)
  initGroupNode(node, nodeState);

  walkFull(node, {
    onLeaf() {}, // leaves are skipped
    onGroupEnter(groupNode) {
      initGroupNode(groupNode as AnyConfigNode, nodeState);
    },
  });
}

function initGroupNode(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>) {
  const existing = nodeState.get(node);
  if (existing) {
    nodeState.set(node, {
      ...existing,
      submitting: existing.submitting ?? false,
      dirty: existing.dirty ?? false,
      revalidate: existing.revalidate ?? false,
    });
  } else {
    nodeState.set(node, {
      value: undefined,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      submitting: false,
      dirty: false,
      revalidate: false,
    });
  }
}
