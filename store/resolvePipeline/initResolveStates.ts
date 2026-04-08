import { CONFIG_PROPS } from "../constants";
import { isListNode } from "../store/NodeRegistry/nodeUtils";
import { type AnyConfigNode, type ListConfig } from "../store/types";
import type { Resolve, ResolveState } from "./types";
import { resetResolveState } from "./resetResolveState";

// ─── Entry types ──────────────────────────────────────────────────────────────

export type GroupResolveEntry = { node: AnyConfigNode; resolve: Resolve; isListNode: false };
export type ListResolveEntry = { node: AnyConfigNode; resolve: ListConfig["resolve"]; isListNode: true };
export type AnyResolveEntry = GroupResolveEntry | ListResolveEntry;

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Recursively finds all nodes with `resolve` in the config tree.
 * Initializes ResolveState for each of them.
 * Returns the list of { node, resolve, isListNode } entries.
 *
 * Phase 2C: also walks ListNodes and extracts listConfig.resolve.
 */
export function initResolveStates(
  rootConfig: AnyConfigNode,
  resolveStates: Map<object, ResolveState>,
): AnyResolveEntry[] {
  const entries: AnyResolveEntry[] = [];

  function walk(node: AnyConfigNode) {
    // Check if this node has a resolve
    if (node.resolve && typeof node.resolve === "object" && typeof (node.resolve as any).resolver === "function") {
      const resolve = node.resolve as unknown as Resolve;
      entries.push({ node, resolve, isListNode: false });

      resetResolveState(node, resolveStates, new Set(resolve.deps ?? []));
    }

    // Recurse into children
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;

      if (Array.isArray(child)) {
        // Phase 2C: handle ListNode resolve from listConfig (array[1])
        if (isListNode(child) && child.length > 1) {
          const listConfig = child[1] as ListConfig | undefined;
          if (listConfig?.resolve && typeof listConfig.resolve.resolver === "function") {
            entries.push({
              node: child,
              resolve: listConfig.resolve,
              isListNode: true,
            });
            resetResolveState(
              child,
              resolveStates,
              new Set(listConfig.resolve.deps ?? []),
            );
          }
        }
        continue;
      }

      if (!("value" in child)) {
        walk(child);
      }
    }
  }

  walk(rootConfig);
  return entries;
}
