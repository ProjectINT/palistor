import { configKeys, isLeaf, isListNode } from "./nodeClassifier";
import type { AnyConfigNode } from "../store/types";

export interface TreeVisitor {
  /**
   * Вызывается для каждого leaf-узла ({ value: ... }).
   * @param node — config-узел (ref на объект, можно использовать как ключ WeakMap)
   * @param key — имя ключа в родителе (например "city")
   * @param path — полный dot-path (например "address.city")
   * @param parent — родительский config-узел
   */
  onLeaf(node: object, key: string, path: string, parent: AnyConfigNode): void;

  /**
   * Вызывается для group-узла ПЕРЕД входом в рекурсию.
   * Верни false чтобы пропустить поддерево (например reset boundary).
   * Если не определён — всегда входит.
   */
  onGroupEnter?(node: AnyConfigNode, key: string, path: string, parent: AnyConfigNode): boolean | void;

  /**
   * Вызывается для group-узла ПОСЛЕ обхода всех его потомков.
   * Опционально — для агрегации (например dirty = any child dirty).
   */
  onGroupExit?(node: AnyConfigNode, key: string, path: string, parent: AnyConfigNode): void;

  /**
   * Вызывается для list-узла (Array).
   * Если не определён — list пропускается.
   */
  onList?(node: unknown[], key: string, path: string, parent: AnyConfigNode): void;
}

/**
 * Обход полного дерева конфигурации с visitor-callback'ами.
 * Заменяет повторяющийся паттерн Object.keys + CONFIG_PROPS + leaf/group/list.
 */
export function walkFull(
  node: AnyConfigNode,
  visitor: TreeVisitor,
  parentPath = "",
): void {
  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key];
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if (isListNode(child)) {
      visitor.onList?.(child as unknown[], key, path, node);
      continue;
    }

    if (isLeaf(child as object)) {
      visitor.onLeaf(child as object, key, path, node);
    } else {
      const enter = visitor.onGroupEnter?.(child as AnyConfigNode, key, path, node);
      if (enter === false) continue;
      walkFull(child as AnyConfigNode, visitor, path);
      visitor.onGroupExit?.(child as AnyConfigNode, key, path, node);
    }
  }
}
