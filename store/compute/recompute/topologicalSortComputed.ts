import type { AnyConfigNode } from "../../store/types";

/**
 * Топологическая сортировка computed-узлов по dependencies.
 *
 * Если computed A зависит от computed B (B.path ∈ A.dependencies),
 * B будет вычислен раньше A. Это гарантирует корректный порядок
 * при цепочках вычислений (subtotal → tax → total).
 */
export function topologicalSortComputed(
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
  // Инвертируем: нам нужно «кто зависит от кого», а не «от кого зависит».
  // inDeg считает входящие рёбра: если A зависит от B, то A имеет inDeg += кол-во зависимостей.
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
