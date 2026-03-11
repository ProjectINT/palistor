import { type AnyConfigNode } from "../types";
import { CONFIG_PROPS } from "../constants";
import { pairKey } from "./pairKey";

/**
 * Создать карту зависимостей с self-зависимостью для каждой группы.
 *
 * Группа — любой узел конфига без "value".
 * Root-группа обозначается пустой строкой "".
 */
export function createGroupDeps(
  rootConfig: AnyConfigNode,
  nodePaths: WeakMap<object, string>,
): Set<string> {
  const deps = new Set<string>();

  // Self-зависимость корня
  deps.add(pairKey("", ""));

  // Self-зависимости вложенных групп
  function walk(node: AnyConfigNode): void {
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;
      if ("value" in child) continue; // лист — не группа
      const path = nodePaths.get(child) ?? "";
      deps.add(pairKey(path, path));
      walk(child);
    }
  }

  walk(rootConfig);
  return deps;
}
