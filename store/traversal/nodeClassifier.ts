import { CONFIG_PROPS } from "../constants";

/**
 * Проверить, есть ли у узла дочерние config-ключи (объекты, включая ListNode-массивы).
 * Вызывается ТОЛЬКО при инициализации (в registerNodes) для простановки __kind.
 */
export function hasChildren(node: object): boolean {
  const keys = configKeys(node as Record<string, unknown>);
  return keys.some(k => {
    const v = (node as Record<string, unknown>)[k];
    return v !== null && typeof v === "object";
  });
}

/** Leaf node — узел с __kind === "leaf" (проставляется registerNodes / entity-фабриками).
 * Fallback: если __kind не проставлен — используется "value" in node (обратная совместимость). */
export function isLeafNode(node: object): boolean {
  const kind = (node as any).__kind;
  if (kind !== undefined) return kind === "leaf";
  // Fallback для узлов без __kind (тесты, инлайн-конфиги до registerNodes)
  return "value" in node;
}

/** Group node — узел с __kind === "group" (проставляется registerNodes / entity-фабриками).
 * Fallback: если __kind не проставлен — используется !("value" in node). */
export function isGroupNode(node: object): boolean {
  const kind = (node as any).__kind;
  if (kind !== undefined) return kind === "group";
  // Fallback для узлов без __kind (тесты, инлайн-конфиги до registerNodes)
  return !("value" in node);
}

/** List node — массив (entity-списки хранятся как Array) */
export function isListNode(node: unknown): node is unknown[] {
  return Array.isArray(node);
}

/**
 * Вернуть ключи узла, отфильтровав служебные CONFIG_PROPS.
 * Это заменяет повторяющийся паттерн:
 *   for (const key of Object.keys(node)) {
 *     if (CONFIG_PROPS.has(key)) continue;
 *     ...
 *   }
 */
export function configKeys(node: Record<string, unknown>): string[] {
  return Object.keys(node).filter(k => !CONFIG_PROPS.has(k));
}
