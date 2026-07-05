import { CONFIG_PROPS, FLOW_STEPS_PROP } from "../constants";
import { isGroupNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FlowError } from "./defineFlow";

/**
 * Navigation state of a single flow — the SINGLE "flow" building block.
 *
 * Node identity for tracking is the `FlowState` object itself (hub key, like
 * `ListState` for lists): navigation bumps its version via notifyChanged.
 * Step statuses are NOT stored — derived from (currentIndex + visitedKeys).
 */
export interface FlowState {
  /** The flow's config node — key in flowStates. */
  flowNode: AnyConfigNode;
  /** Absolute dot-path of the flow node (for the persist snapshot and reset scope). */
  path: string;
  /** Ordered step keys (copy of FLOW_STEPS_PROP). */
  stepKeys: string[];
  /** Step config nodes in the same order. */
  stepNodes: AnyConfigNode[];
  /** Index of the active step. */
  currentIndex: number;
  /** Visit stack — popped by back(). */
  visitStack: string[];
  /** All steps ever visited (the stack is lossy — back() removes entries). */
  visitedKeys: Set<string>;
  /** Errors of the last validate()/finalize — reactive (flow.errors). */
  errors: FlowError[];
}

/** Minimal registry interface for flow registration (NodeRegistry). */
export interface FlowRegistrySlice {
  readonly flowStates: WeakMap<object, FlowState>;
  readonly allFlowStates: FlowState[];
  readonly stepToFlow: WeakMap<object, FlowState>;
  readonly nodePaths: WeakMap<object, string>;
}

/**
 * Walk the config tree and create a FlowState for every node carrying the
 * {@link FLOW_STEPS_PROP} marker (stamped by defineFlow). Called from the
 * NodeRegistry constructor AFTER buildNodeMaps — paths are already known.
 */
export function collectFlowStates(root: AnyConfigNode, registry: FlowRegistrySlice): void {
  walk(root);

  function walk(node: AnyConfigNode): void {
    const marker = (node as Record<string, unknown>)[FLOW_STEPS_PROP];
    if (Array.isArray(marker)) {
      const stepKeys = marker as string[];
      const stepNodes: AnyConfigNode[] = [];
      for (const key of stepKeys) {
        const child = (node as Record<string, unknown>)[key];
        if (!child || typeof child !== "object" || Array.isArray(child) || "value" in child) {
          throw new Error(`[palistor] defineFlow: step "${key}" is not a group node in the flow config.`);
        }
        // An empty step ({} — read-only summary) would be marked "leaf" by the
        // hasChildren heuristic in registerNodes; a step is by definition a group.
        (child as Record<string, unknown>).__kind = "group";
        stepNodes.push(child as AnyConfigNode);
      }
      const flowState: FlowState = {
        flowNode: node,
        path: registry.nodePaths.get(node as object) ?? "",
        stepKeys: [...stepKeys],
        stepNodes,
        currentIndex: 0,
        visitStack: [],
        visitedKeys: new Set([stepKeys[0]]),
        errors: [],
      };
      registry.flowStates.set(node as object, flowState);
      registry.allFlowStates.push(flowState);
      for (const stepNode of stepNodes) registry.stepToFlow.set(stepNode as object, flowState);
    }

    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = (node as Record<string, unknown>)[key];
      if (!child || typeof child !== "object" || Array.isArray(child)) continue;
      if (isGroupNode(child as object)) walk(child as AnyConfigNode);
    }
  }
}
