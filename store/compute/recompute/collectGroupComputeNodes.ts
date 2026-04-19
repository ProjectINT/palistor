import type { AnyConfigNode } from "../../store/types";
import { configKeys, isLeafNode } from "../../traversal";
import type { ComputeEntry, GroupComputeMap } from "../../store/registerNodes";

/**
 * Рекурсивно собирает все compute-записи поддерева группового узла.
 *
 * Для каждого группового узла из groupComputeMap берутся его прямые записи
 * (листья + группы с computed-свойствами), затем рекурсия в дочерние группы.
 * Листовые узлы пропускаются — они уже учтены в compute-list своего родителя.
 */
export function collectGroupComputeNodes(
  groupNode: AnyConfigNode,
  groupComputeMap: GroupComputeMap,
): ComputeEntry[] {
  const result: ComputeEntry[] = [];

  // Прямые записи этой группы (листья + группы с computed-свойствами)
  const ownEntries = groupComputeMap.get(groupNode);
  if (ownEntries) result.push(...ownEntries);

  // Рекурсия в дочерние группы
  for (const key of configKeys(groupNode as Record<string, unknown>)) {
    const child = groupNode[key] as AnyConfigNode;

    if (!child || typeof child !== "object") continue;

    if (isLeafNode(child)) continue; // уже в ownEntries родителя
    result.push(...collectGroupComputeNodes(child, groupComputeMap));
  }

  return result;
}
