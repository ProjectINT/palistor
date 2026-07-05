import type { AnyConfigNode } from "../../store/types";

/**
 * Topological sort of computed nodes by dependencies.
 *
 * If computed A depends on computed B (B.path ∈ A.dependencies),
 * B is evaluated before A. This guarantees the correct order for
 * computation chains (subtotal → tax → total).
 */
export function topologicalSortComputed(
  computedEntries: Array<{ node: AnyConfigNode; path: string }>,
): Array<{ node: AnyConfigNode; path: string }> {
  if (computedEntries.length <= 1) return computedEntries;

  // Set of computed node paths for fast lookup
  const computedPaths = new Set(computedEntries.map((e) => e.path));

  // Build the graph: path → dependencies (only those that are computed themselves)
  const deps = new Map<string, string[]>();
  const entryByPath = new Map<string, { node: AnyConfigNode; path: string }>();

  for (const entry of computedEntries) {
    entryByPath.set(entry.path, entry);
    const nodeDeps = (entry.node.dependencies as string[] | undefined) ?? [];
    // Keep only dependencies on other computed nodes
    deps.set(entry.path, nodeDeps.filter((d) => computedPaths.has(d)));
  }

  // Kahn's algorithm (BFS topological sort).
  // inDeg counts incoming edges: if A depends on B, A's inDeg equals its dependency count.
  const inDeg = new Map<string, number>();

  for (const path of computedPaths) inDeg.set(path, 0);


  for (const [path, d] of deps) {
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

    // Decrease inDeg for everything that depends on current
    for (const [path, d] of deps) {
      if (d.includes(current)) {
        const newDeg = (inDeg.get(path) ?? 0) - 1;
        inDeg.set(path, newDeg);
        if (newDeg === 0) queue.push(path);
      }
    }
  }

  // Leftover nodes (cyclic dependency) — appended as-is
  if (sorted.length < computedEntries.length) {
    for (const entry of computedEntries) {
      if (!sorted.includes(entry)) sorted.push(entry);
    }
  }

  return sorted;
}
