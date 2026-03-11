import { CONFIG_PROPS } from "../constants";
import { type AnyConfigNode } from "../types";
import type { Resolve, ResolveState } from "./types";
import { resetResolveState } from "./resetResolveState";

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Recursively finds all nodes with `resolve` in the config tree.
 * Initializes ResolveState for each of them.
 * Returns the list of { node, resolve } entries.
 */
export function initResolveStates(
  rootConfig: AnyConfigNode,
  resolveStates: Map<object, ResolveState>,
): Array<{ node: AnyConfigNode; resolve: Resolve }> {
  const entries: Array<{ node: AnyConfigNode; resolve: Resolve }> = [];

  function walk(node: AnyConfigNode) {
    // Check if this node has a resolve
    if (node.resolve && typeof node.resolve === "object" && typeof (node.resolve as any).resolver === "function") {
      const resolve = node.resolve as unknown as Resolve;
      entries.push({ node, resolve });

      resetResolveState(node, resolveStates, new Set(resolve.deps ?? []));
    }

    // Recurse into children
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = node[key] as AnyConfigNode;
      if (child && typeof child === "object" && !("value" in child)) {
        walk(child);
      }
    }
  }

  walk(rootConfig);
  return entries;
}
