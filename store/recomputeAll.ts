import { type FieldState, computeFieldState, fieldStateChanged } from "./compute";
import { collectValues, type AnyConfigNode } from "./collectValues";
import { CONFIG_PROPS } from "./constants";
import type { TranslateFn } from "./types";
import type { LeafEntry, GroupLeafMap } from "./registerNodes";

/**
 * Топологическая сортировка computed-узлов по dependencies.
 *
 * Если computed A зависит от computed B (B.path ∈ A.dependencies),
 * B будет вычислен раньше A. Это гарантирует корректный порядок
 * при цепочках вычислений (subtotal → tax → total).
 */
function topologicalSortComputed(
  computedEntries: Array<{ node: AnyConfigNode; path: string }>,
): Array<{ node: AnyConfigNode; path: string }> {
  if (computedEntries.length <= 1) return computedEntries;

  // Множество путей computed-узлов для быстрой проверки
  const computedPaths = new Set(computedEntries.map((e) => e.path));

  // Строим граф: path → зависимости (только те, которые сами computed)
  const deps = new Map<string, string[]>();
  const entryByPath = new Map<string, { node: AnyConfigNode; path: string }>();
  for (const entry of computedEntries) {
    entryByPath.set(entry.path, entry);
    const nodeDeps = (entry.node.dependencies as string[] | undefined) ?? [];
    // Оставляем только зависимости на другие computed-узлы
    deps.set(entry.path, nodeDeps.filter((d) => computedPaths.has(d)));
  }

  // Алгоритм Кана (BFS topological sort)
  const inDegree = new Map<string, number>();
  for (const path of computedPaths) inDegree.set(path, 0);
  for (const [, d] of deps) {
    for (const dep of d) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Инвертируем: нам нужно «кто зависит от кого», а не «от кого зависит».
  // inDegree должен считать входящие рёбра: если A зависит от B, то A имеет ребро от B.
  // Пересчитаем корректно:
  const inDeg = new Map<string, number>();
  for (const path of computedPaths) inDeg.set(path, 0);
  for (const [path, d] of deps) {
    // path зависит от каждого d[i] → path имеет inDeg += кол-во зависимостей
    inDeg.set(path, d.length);
  }

  const queue: string[] = [];
  for (const [path, deg] of inDeg) {
    if (deg === 0) queue.push(path);
  }

  const sorted: Array<{ node: AnyConfigNode; path: string }> = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(entryByPath.get(current)!);

    // Уменьшаем inDeg для всех, кто зависит от current
    for (const [path, d] of deps) {
      if (d.includes(current)) {
        const newDeg = (inDeg.get(path) ?? 0) - 1;
        inDeg.set(path, newDeg);
        if (newDeg === 0) queue.push(path);
      }
    }
  }

  // Если остались узлы (циклическая зависимость) — добавляем как есть
  if (sorted.length < computedEntries.length) {
    for (const entry of computedEntries) {
      if (!sorted.includes(entry)) sorted.push(entry);
    }
  }

  return sorted;
}

/**
 * Рекурсивно собирает все leaf-записи поддерева группового узла.
 *
 * Для каждого группового узла из groupLeafMap берутся его прямые листья,
 * затем рекурсия в дочерние группы. Листовые узлы (с "value") пропускаются —
 * они уже учтены в leaf-list своего родителя.
 */
function collectGroupLeafNodes(
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

/**
 * Пересчитать вычисленное состояние поддерева одного группового узла.
 *
 * Фаза 1: Пересчитать computed-значения (value — функция) в топологическом порядке.
 * Фаза 2: Пересчитать FieldState (isVisible, isRequired, error…) для всех полей поддерева.
 *
 * collectValues всегда использует rootConfig — computed и validate могут зависеть
 * от значений вне этой группы (глобальный snapshot).
 *
 * Возвращает Set узлов, чьё состояние изменилось (для notify).
 */
export function recomputeGroup(
  groupNode: AnyConfigNode,
  rootConfig: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  translate?: TranslateFn,
): Set<object> {
  const leafNodes = collectGroupLeafNodes(groupNode, groupLeafMap);

  // ── Фаза 1: Пересчёт computed-значений ──────────────────────────────────
  const computedEntries = leafNodes.filter(({ node }) => typeof node.value === "function");
  const changed = new Set<object>();

  if (computedEntries.length > 0) {
    const sorted = topologicalSortComputed(computedEntries);

    for (const { node } of sorted) {
      // Собираем актуальные значения (с учётом уже пересчитанных computed)
      const currentValues = collectValues(rootConfig, nodeState);
      const computedValue = (node.value as (values: Record<string, unknown>) => unknown)(currentValues);
      const state = nodeState.get(node);
      if (state && state.value !== computedValue) {
        nodeState.set(node, { ...state, value: computedValue });
        changed.add(node);
      }
    }
  }

  // ── Фаза 2: Пересчёт FieldState (флаги, валидация, строки) ──────────────
  const allValues = collectValues(rootConfig, nodeState);

  for (const { node } of leafNodes) {
    const prev = nodeState.get(node);
    const currentValue = prev?.value ?? "";
    // Preserve revalidate flag: skip validation when revalidate is false
    const revalidate = prev?.revalidate ?? false;
    const next = computeFieldState(node, currentValue, allValues, revalidate, translate);

    // Preserve management flags that computeFieldState doesn't produce
    if (prev?.submitting !== undefined) next.submitting = prev.submitting;
    if (prev?.dirty !== undefined) next.dirty = prev.dirty;
    if (prev?.revalidate !== undefined) next.revalidate = prev.revalidate;

    // Проверяем, изменилось ли что-то
    if (prev && !fieldStateChanged(prev, next)) continue;

    nodeState.set(node, next);
    changed.add(node);
  }

  return changed;
}

/**
 * Пересчитать вычисленное состояние всех листовых полей.
 * Делегирует в recomputeGroup(rootConfig) — полный пересчёт всего дерева.
 *
 * Вызывается при init и после каждого SET .value.
 */
export function recomputeAll(
  rootConfig: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  translate?: TranslateFn,
): Set<object> {
  return recomputeGroup(rootConfig, rootConfig, groupLeafMap, nodeState, translate);
}
