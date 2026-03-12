import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "./types";

/**
 * Рекурсивно строит маппинги путей и родителей для всех узлов дерева конфига.
 *
 * - `nodePaths`   — WeakMap<node, "user.email"> — абсолютный путь каждого узла.
 * - `nodeParents` — WeakMap<node, parentNode>  — непосредственный родитель.
 *
 * Используются onChange pipeline (поиск предков с `onChange`),
 * submit/reset (определение fieldKey) и другими хендлерами.
 */
export function buildNodeMaps(
  node: AnyConfigNode,
  nodePaths: WeakMap<object, string>,
  nodeParents: WeakMap<object, object>,
  parentPath = "",
): void {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;
    nodePaths.set(child, path);
    nodeParents.set(child, node);

    // Рекурсия в групповые узлы (листья не имеют дочерних)
    if (!("value" in child)) {
      buildNodeMaps(child, nodePaths, nodeParents, path);
    }
  }
}
