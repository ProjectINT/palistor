import { CONFIG_PROPS } from "../constants";

/**
 * Check whether the node has child config keys (objects, including ListNode arrays).
 * Called ONLY during initialization (in registerNodes) to stamp __kind.
 */
export function hasChildren(node: object): boolean {
  const keys = configKeys(node as Record<string, unknown>);
  return keys.some(k => {
    const v = (node as Record<string, unknown>)[k];
    return v !== null && typeof v === "object";
  });
}

/** Leaf node — a node with __kind === "leaf" (stamped by registerNodes / entity factories).
 * Fallback: without __kind, `"value" in node` is used (backward compatibility). */
export function isLeafNode(node: object): boolean {
  const kind = (node as any).__kind;
  if (kind !== undefined) return kind === "leaf";
  // Fallback for nodes without __kind (tests, inline configs before registerNodes)
  return "value" in node;
}

/** Group node — a node with __kind === "group" (stamped by registerNodes / entity factories).
 * Fallback: without __kind, `!("value" in node)` is used. */
export function isGroupNode(node: object): boolean {
  const kind = (node as any).__kind;
  if (kind !== undefined) return kind === "group";
  // Fallback for nodes without __kind (tests, inline configs before registerNodes)
  return !("value" in node);
}

/** List node — an array (entity lists are stored as Array) */
export function isListNode(node: unknown): node is unknown[] {
  return Array.isArray(node);
}

/**
 * Return the node's keys, filtering out service CONFIG_PROPS.
 * Replaces the repeating pattern:
 *   for (const key of Object.keys(node)) {
 *     if (CONFIG_PROPS.has(key)) continue;
 *     ...
 *   }
 */
export function configKeys(node: Record<string, unknown>): string[] {
  return Object.keys(node).filter(k => !CONFIG_PROPS.has(k));
}
