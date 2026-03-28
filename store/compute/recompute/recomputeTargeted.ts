import {
  getNodeGroupPath,
  getRecipientGroups,
  resolveGroupByPath,
} from "../../groupDeps/groupDeps";
import type { RecomputeTargetedDeps } from "./types";
import { recomputeLeaves } from "./recomputeLeaves";

// ─── Таргетированный пересчёт ────────────────────────────────────────────────

/**
 * Таргетированный пересчёт: вместо пересчёта ВСЕХ групп,
 * пересчитывает только затронутые группы + их реципиентов.
 *
 * Алгоритм:
 * 1. Определить группы изменённых узлов (source groups).
 * 2. BFS по карте зависимостей: собрать все группы-реципиенты в топологическом порядке.
 * 3. Для каждой затронутой группы пересчитать только её OWN листья (не рекурсивно).
 *
 * @param changedNodes — узлы, чьи значения изменились (написанный узел + setter targets)
 */
export function recomputeTargeted(
  changedNodes: Set<object>,
  deps: RecomputeTargetedDeps,
): Set<object> {

  const {
    rootConfig, groupLeafMap,
    nodeState, nodeParents, nodePaths,
    groupDeps, valuesCache, translate,
  } = deps;

  // 1. Находим группы-источники изменений
  const sourceGroups = new Set<string>();
  for (const node of changedNodes) {
    sourceGroups.add(getNodeGroupPath(node, nodeParents, nodePaths));
  }

  // 2. BFS — собираем все затронутые группы в порядке "сначала доноры, потом реципиенты"
  const orderedGroups: string[] = [...sourceGroups];
  const visited = new Set(sourceGroups);

  let i = 0;
  while (i < orderedGroups.length) {
    const current = orderedGroups[i++];
    const recipients = getRecipientGroups(groupDeps, current);
    
    for (const r of recipients) {
      if (!visited.has(r)) {
        visited.add(r);
        orderedGroups.push(r);
      }
    }
  }

  // 3. Пересчитываем каждую группу (только OWN листья, не рекурсивно)
  const allChanged = new Set<object>();

  for (const groupPath of orderedGroups) {
    const groupNode = resolveGroupByPath(rootConfig, groupPath);
    // Entity-группы (пути "_entity_.*") не существуют в rootConfig — пропускаем
    if (!groupNode) continue;
    const ownLeaves = groupLeafMap.get(groupNode) ?? [];
    const changed = recomputeLeaves(ownLeaves, nodeState, valuesCache, translate);
    for (const n of changed) allChanged.add(n);
  }

  return allChanged;
}
