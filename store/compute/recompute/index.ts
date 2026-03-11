import { type FieldState, computeFieldState, fieldStateChanged } from "../index";
import { type AnyConfigNode } from "../../types";
import { CONFIG_PROPS } from "../../constants";
import type { TranslateFn } from "../../types";
import type { LeafEntry, GroupLeafMap } from "../../registerNodes";
import {
  getNodeGroupPath,
  getRecipientGroups,
  resolveGroupByPath,
} from "../../groupDeps";
import { updateValuesCacheEntry, type ValuesCache } from "../../valuesCache";

// ─── Типы ────────────────────────────────────────────────────────────────────

/**
 * Обёртка для отслеживания кросс-групповых зависимостей.
 * Принимает узел (для определения группы-реципиента) и сырые значения,
 * возвращает те же значения, обёрнутые в tracking-proxy.
 */
export type TrackingWrap = (node: object, values: Record<string, unknown>) => Record<string, unknown>;

/**
 * Зависимости для таргетированного пересчёта.
 */
interface RecomputeTargetedDeps {
  rootConfig: AnyConfigNode;
  groupLeafMap: GroupLeafMap;
  nodeState: WeakMap<object, FieldState>;
  nodeParents: WeakMap<object, object>;
  nodePaths: WeakMap<object, string>;
  groupDeps: Set<string>;
  valuesCache: ValuesCache;
  translate: TranslateFn;
}

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
 * Пересчитать вычисленное состояние для заданного списка листовых узлов.
 *
 * Фаза 1: Пересчитать computed-значения (value — функция) в топологическом порядке.
 * Фаза 2: Пересчитать FieldState (isVisible, isRequired, error…) для всех полей.
 *
 * valuesCache всегда содержит globalRoot снапшот — computed и validate могут зависеть
 * от значений вне текущей группы (глобальный snapshot).
 *
 * @param trackingWrap — опциональная обёртка для отслеживания кросс-групповых зависимостей.
 *                       Если передана, значения из valuesCache оборачиваются через неё.
 *
 * Возвращает Set узлов, чьё состояние изменилось (для notify).
 */
function recomputeLeaves(
  leafNodes: LeafEntry[],
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  // ── Фаза 1: Пересчёт computed-значений ──────────────────────────────────
  const computedEntries = leafNodes.filter(({ node }) => typeof node.value === "function");
  const changed = new Set<object>();

  if (computedEntries.length > 0) {
    const sorted = topologicalSortComputed(computedEntries);

    for (const { node } of sorted) {
      // valuesCache.values — O(1) чтение глобального состояния
      const currentValues = trackingWrap ? trackingWrap(node, valuesCache.values) : valuesCache.values;
      const computedValue = (node.value as (values: Record<string, unknown>) => unknown)(currentValues);
      const state = nodeState.get(node);

      if (state && state.value !== computedValue) {
        nodeState.set(node, { ...state, value: computedValue });
        updateValuesCacheEntry(valuesCache, node, computedValue);
        changed.add(node);
      }
    }
  }

  // ── Фаза 2: Пересчёт FieldState (флаги, валидация, строки) ──────────────
  const rawAllValues = valuesCache.values;

  for (const { node } of leafNodes) {
    const prev = nodeState.get(node);
    const currentValue = prev?.value ?? "";
    // Preserve revalidate flag: skip validation when revalidate is false
    const revalidate = prev?.revalidate ?? false;
    const allValues = trackingWrap ? trackingWrap(node, rawAllValues) : rawAllValues;
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
 * Пересчитать вычисленное состояние поддерева одного группового узла.
 *
 * Собирает ВСЕ листья поддерева (рекурсивно) и делегирует в recomputeLeaves.
 *
 * Возвращает Set узлов, чьё состояние изменилось (для notify).
 */
function recomputeGroup(
  groupNode: AnyConfigNode,
  rootConfig: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  const leafNodes = collectGroupLeafNodes(groupNode, groupLeafMap);
  return recomputeLeaves(leafNodes, rootConfig, nodeState, valuesCache, translate, trackingWrap);
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
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  return recomputeGroup(rootConfig, rootConfig, groupLeafMap, nodeState, valuesCache, translate, trackingWrap);
}

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
  const { rootConfig, groupLeafMap, nodeState, nodeParents, nodePaths, groupDeps, valuesCache, translate } = deps;

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
    const ownLeaves = groupLeafMap.get(groupNode) ?? [];
    const changed = recomputeLeaves(ownLeaves, rootConfig, nodeState, valuesCache, translate);
    for (const n of changed) allChanged.add(n);
  }

  return allChanged;
}

/**
 * Пересчитать все computed-свойства, объединить с ранее изменёнными узлами
 * и уведомить подписчиков.
 *
 * Инкапсулирует паттерн: recomputeAll → merge changed → notifyChanged.
 */
export function recomputeAndNotify(
  changed: Set<object>,
  recomputeAll: () => Set<object>,
  notifyChanged: (changed: Set<object>) => void,
): void {
  const recomputed = recomputeAll();
  for (const n of changed) recomputed.add(n);
  notifyChanged(recomputed);
}
