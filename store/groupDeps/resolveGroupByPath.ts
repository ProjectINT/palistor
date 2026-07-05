import { type AnyConfigNode } from "../store/types";

/**
 * Find a group config node by dot-path.
 * "" → rootConfig, "passport" → rootConfig.passport, etc.
 * Returns undefined when the path doesn't exist in the tree (e.g. "_entity_.*" paths).
 */
export function resolveGroupByPath(
  rootConfig: AnyConfigNode,
  path: string,
): AnyConfigNode | undefined {
  if (!path) return rootConfig;
  const parts = path.split(".");
  let node: AnyConfigNode = rootConfig;
  for (const part of parts) {
    const next = node[part] as AnyConfigNode | undefined;
    if (!next) return undefined;
    node = next;
  }
  return node;
}
