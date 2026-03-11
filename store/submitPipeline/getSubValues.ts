import type { AnyConfigNode } from "../types";
import type { ValuesCache } from "../valuesCache";

/**
 * Извлечь поддерево значений для группового узла из кеша.
 * Для корня → весь кеш, для вложенной группы → вложенный объект по пути.
 * Возвращает snapshot (копию), чтобы beforeSubmit-трансформации не мутировали кеш.
 */
export function getSubValues(
  cache: ValuesCache,
  groupNode: AnyConfigNode,
  rootConfig: AnyConfigNode,
  nodePaths: WeakMap<object, string>,
): Record<string, unknown> {
  let source: Record<string, unknown>;

  if (groupNode === rootConfig) {
    source = cache.values;
  } else {
    const path = nodePaths.get(groupNode);
    if (!path) {
      source = cache.values;
    } else {
      let current: unknown = cache.values;
      for (const segment of path.split(".")) {
        current = (current as Record<string, unknown>)?.[segment];
      }
      source = (current as Record<string, unknown>) ?? {};
    }
  }

  return structuredClone(source);
}
