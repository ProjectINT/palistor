import type { AnyConfigNode } from "../../store/types";
import { CONFIG_PROPS } from "../../constants";
import type { LeafEntry, GroupLeafMap } from "../../store/registerNodes";

/**
 * Рекурсивно собирает все leaf-записи поддерева группового узла.
 *
 * Для каждого группового узла из groupLeafMap берутся его прямые листья,
 * затем рекурсия в дочерние группы. Листовые узлы (с "value") пропускаются —
 * они уже учтены в leaf-list своего родителя.
 */
export function collectGroupLeafNodes(
  groupNode: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
): LeafEntry[] {
  const result: LeafEntry[] = [];

  // Прямые листья этой группы (включая виртуальный лист самой группы, если есть)
  const ownLeaves = groupLeafMap.get(groupNode);
  if (ownLeaves) result.push(...ownLeaves);

  // Рекурсия в дочерние группы
  for (const key of Object.keys(groupNode)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = groupNode[key] as AnyConfigNode;

    if (!child || typeof child !== "object") continue;

    if ("value" in child) continue; // уже в ownLeaves родителя
    result.push(...collectGroupLeafNodes(child, groupLeafMap));
  }

  return result;
}
