import { type FieldState, resolveFlag } from "../compute/index";
import { TranslateFn, type AnyConfigNode, type ListState, type ListConfig } from "./types";
import { configKeys, hasChildren } from "../traversal";
import { hasComputedProps } from "./hasComputedProps";
import { isListNode } from "./NodeRegistry/nodeUtils";

/**
 * Служебные ключи узла конфига, которые пропускаются при обходе дерева.
 * Зеркалит runtime-набор CONFIG_PROPS на уровне типов.
 */
type ConfigPropKeys =
  | "value"
  | "label"
  | "placeholder"
  | "description"
  | "isRequired"
  | "isReadOnly"
  | "isDisabled"
  | "isVisible"
  | "isInvalid"
  | "errorMessage"
  | "validate"
  | "formatter"
  | "setter"
  | "componentProps"
  | "types"
  | "dependencies";

/**
 * Рекурсивный тип начальных значений, повторяющий структуру конфига:
 * - Служебные ключи пропускаются.
 * - Листовые узлы (есть `value`) → тип значения (или `unknown` для функции-вычислителя).
 * - Групповые узлы → вложенный `InitialSlice`.
 * - Все поля опциональны.
 */
export type InitialSlice<TNode> = {
  [K in keyof TNode as K extends ConfigPropKeys ? never : K]?:
    TNode[K] extends { value: infer V }
      ? V extends (values: any) => infer R ? R : V
      : TNode[K] extends Record<string, any>
        ? InitialSlice<TNode[K]>
        : unknown;
};

/**
 * Фаза 1: Собираем все вычисляемые узлы и устанавливаем начальные value.
 * Ещё не вычисляем computed — для этого нужны все values.
 */
type MaybeFlag = boolean | ((values: any) => boolean) | undefined;

export type ComputeEntry = { node: AnyConfigNode; path: string };

/**
 * Маппинг группового узла → массив его прямых дочерних записей (листья + группы с computed-свойствами).
 * Все записи хранятся под родительской группой — единообразно.
 *
 * Используется recomputeTargeted для пересчёта поддерева.
 */
export type GroupComputeMap = WeakMap<object, ComputeEntry[]>;

/** Получить или создать массив записей для группы. */
function getOrCreateComputeList(map: GroupComputeMap, group: object): ComputeEntry[] {
  let list = map.get(group);
  if (!list) {
    list = [];
    map.set(group, list);
  }
  return list;
}

export function registerNodes<TNode extends AnyConfigNode>(
  node: TNode,
  initialSlice: InitialSlice<TNode> | undefined,
  computeNodes: ComputeEntry[],
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
  groupComputeMap: GroupComputeMap,
  translate: TranslateFn,
  listStates?: WeakMap<object, ListState>,
  allListStates?: ListState[],
) {
  for (const key of configKeys(node as Record<string, unknown>)) {

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    // Проставить маркер __kind на каждый узел конфига
    (child as any).__kind = hasChildren(child) ? "group" : "leaf";

    if (Array.isArray(child)) {
      // ListNode: создать ListState + зарегистрировать template как обычную группу
      if (isListNode(child) && listStates) {
        const template = child[0] as AnyConfigNode;
        const listConfig = child.length > 1 ? (child[1] as ListConfig) : undefined;
        const listState: ListState = {
          listConfigNode: child,
          template,
          listConfig,
          ownerEntity: null,
          itemIds: [],
          initialItemIds: [],
        };
        listStates.set(child, listState);
        if (allListStates) allListStates.push(listState);
        // Регистрируем поля template как обычную группу (path = ключ списка)
        registerNodes(template, undefined, computeNodes, nodeState, path, groupComputeMap, translate, listStates, allListStates);
      }
      continue;
    }

    if ("value" in child) {
      // Листовой узел: запоминаем, ставим начальный value (computed позже)
      const entry: ComputeEntry = { node: child, path };
      computeNodes.push(entry);
      // Добавляем в compute-list текущей группы (node — родитель)
      getOrCreateComputeList(groupComputeMap, node).push(entry);

      const rawSlice = initialSlice as Record<string, unknown> | undefined;
      const sliceValues = (rawSlice ?? {}) as Record<string, unknown>;
      const rawValue = child.value;
      const configValue = typeof rawValue === "function" ? rawValue(sliceValues) : rawValue;
      const initialValue = rawSlice?.[key] ?? configValue ?? "";
      nodeState.set(child, {
        value: initialValue,
        isVisible:  resolveFlag(child.isVisible  as MaybeFlag, sliceValues, true, translate),
        isRequired: resolveFlag(child.isRequired as MaybeFlag, sliceValues, false, translate),
        isDisabled: resolveFlag(child.isDisabled as MaybeFlag, sliceValues, false, translate),
        isReadOnly: resolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false, translate),
        dirty: false,
        revalidate: false,
      });
    }

    // Групповой узел: всегда добавляем в nodeState (value заполнится в buildValuesCache).
    // Если есть computed-свойства (isVisible и т.п.) — добавляем в computeNodes под РОДИТЕЛЕМ.
    if (!("value" in child)) {
      const sliceValues = (initialSlice as Record<string, unknown> | undefined ?? {}) as Record<string, unknown>;
      nodeState.set(child, {
        value: undefined,
        isVisible:  resolveFlag(child.isVisible  as MaybeFlag, sliceValues, true, translate),
        isRequired: resolveFlag(child.isRequired as MaybeFlag, sliceValues, false, translate),
        isDisabled: resolveFlag(child.isDisabled as MaybeFlag, sliceValues, false, translate),
        isReadOnly: resolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false, translate),
        dirty: false,
        revalidate: false,
      });
      if (hasComputedProps(child)) {
        const entry: ComputeEntry = { node: child, path };
        computeNodes.push(entry);
        // Группа с computed-свойствами хранится под РОДИТЕЛЕМ (единообразно с листьями)
        getOrCreateComputeList(groupComputeMap, node).push(entry);
      }
    }

    // Рекурсия в дочерние
    registerNodes(child, (initialSlice as Record<string, unknown> | undefined)?.[key] as InitialSlice<AnyConfigNode> | undefined, computeNodes, nodeState, path, groupComputeMap, translate, listStates, allListStates);
  }
}
