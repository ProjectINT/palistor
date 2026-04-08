import { CONFIG_PROPS } from "../constants";
import { isListNode } from "../store/NodeRegistry/nodeUtils";
import { type AnyConfigNode, type ListConfig } from "../store/types";
import type { Resolve, ResolveState } from "./types";
import { resetResolveState } from "./resetResolveState";

// ─── Entry types ──────────────────────────────────────────────────────────────

export type GroupResolveEntry = { node: AnyConfigNode; resolve: Resolve; isListNode: false; isTemplateField?: false };
export type ListResolveEntry = { node: AnyConfigNode; resolve: ListConfig["resolve"]; isListNode: true; isTemplateField?: false };

/**
 * Entry for a template field inside a list that has a `resolve` config.
 * Resolve state is per-entity (created lazily), not global — so no ResolveState
 * is created in initResolveStates for these entries.
 */
export type TemplateFieldResolveEntry = {
  /** The template field node that has `resolve`. */
  node: AnyConfigNode;
  resolve: Resolve;
  isListNode: false;
  /** Marker: this is a per-entity field resolve — state is managed per (entityId, node). */
  isTemplateField: true;
  /** The ListNode array that owns this template (parent list). */
  listNode: AnyConfigNode;
  /** The key of this field within the template (e.g. "isActive"). Used for skipIfResolved check. */
  fieldKey: string;
};

export type AnyResolveEntry = GroupResolveEntry | ListResolveEntry | TemplateFieldResolveEntry;

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

  /** Walk a template (list[0]) and collect all fields with `resolve`. */
  function walkTemplateFields(template: AnyConfigNode, listNode: AnyConfigNode) {
    for (const key of Object.keys(template)) {
      if (CONFIG_PROPS.has(key)) continue;
      const field = template[key] as AnyConfigNode;
      if (!field || typeof field !== "object" || Array.isArray(field)) continue;

      if (field.resolve && typeof field.resolve === "object" && typeof (field.resolve as any).resolver === "function") {
        entries.push({
          node: field,
          resolve: field.resolve as unknown as Resolve,
          isListNode: false,
          isTemplateField: true,
          listNode,
          fieldKey: key,
        });
        // NOTE: No ResolveState created here — created per-entity in Phase 2.
      }

      // Recurse into nested groups within the template field
      if (!("value" in field)) {
        walkTemplateFields(field, listNode);
      }
    }
  }

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
        // Phase 1: walk template fields for per-entity field resolves
        if (isListNode(child)) {
          walkTemplateFields(child[0] as AnyConfigNode, child as unknown as AnyConfigNode);
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
