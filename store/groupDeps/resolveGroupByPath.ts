import { type AnyConfigNode } from "../store/types";

/**
 * Найти узел конфига группы по dot-пути.
 * "" → rootConfig, "passport" → rootConfig.passport, и т.д.
 */
export function resolveGroupByPath(
  rootConfig: AnyConfigNode,
  path: string,
): AnyConfigNode {
  if (!path) return rootConfig;
  const parts = path.split(".");
  let node: AnyConfigNode = rootConfig;
  for (const part of parts) {
    node = node[part] as AnyConfigNode;
  }
  return node;
}
