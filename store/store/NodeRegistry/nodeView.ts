import type { AnyConfigNode } from "../types";

export interface NodeView {
  storage: AnyConfigNode;
  rules: AnyConfigNode;
  parent: {
    proxy: object | undefined;
    getValues: () => Record<string, unknown>;
  };
  onReset: () => void;
}

/** Minimal kernel interface needed to build identity views — avoids circular imports. */
export interface NodeViewKernel {
  readonly rootConfig: AnyConfigNode;
  readonly nodes: {
    readonly proxyCache: WeakMap<object, unknown>;
    readonly nodeParents: WeakMap<object, object>;
  };
  readonly values: {
    readonly groupSlot: WeakMap<object, Record<string, unknown>>;
    readonly values: Record<string, unknown>;
  };
  readonly resetPipeline: {
    execute(node: AnyConfigNode, vals?: Record<string, unknown>): void;
  };
}

/** Build an identity NodeView for a config-mode node (storage === rules === node). */
export function makeIdentityView(node: AnyConfigNode, kernel: NodeViewKernel): NodeView {
  const parentNode = kernel.nodes.nodeParents.get(node as object) as AnyConfigNode | undefined;
  const effectiveParent = (parentNode ?? kernel.rootConfig) as AnyConfigNode;
  return {
    storage: node,
    rules: node,
    parent: {
      // undefined when node is root — matches existing onSubmit(value, store, parent) contract
      proxy: parentNode ? (kernel.nodes.proxyCache.get(parentNode as object) as object | undefined) : undefined,
      getValues: () =>
        kernel.values.groupSlot.get(effectiveParent as object) ?? kernel.values.values,
    },
    onReset: () => kernel.resetPipeline.execute(effectiveParent),
  };
}
