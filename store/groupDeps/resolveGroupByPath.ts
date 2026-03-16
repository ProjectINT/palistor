import { type AnyConfigNode } from "../store/types";

/**
 * Найти узел конфига группы по dot-пути.
 * "" → rootConfig, "passport" → rootConfig.passport, и т.д.
 * Возвращает undefined если путь не существует в дереве (например, entity-пути "_entity_.*").
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
