import { type FieldState, resolveFlag } from "../compute/index";
import { CONFIG_PROPS } from "../constants";
import { TranslateFn, type AnyConfigNode } from "./types";
import { hasComputedProps } from "./hasComputedProps";

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
 * Фаза 1: Собираем все листовые узлы и устанавливаем начальные value.
 * Ещё не вычисляем computed — для этого нужны все values.
 */
type MaybeFlag = boolean | ((values: any) => boolean) | undefined;

export type LeafEntry = { node: AnyConfigNode; path: string };

/**
 * Маппинг группового узла → массив его прямых листовых записей.
 * Для групп с computed-свойствами (isVisible на группе) виртуальный лист
 * хранится в массиве самой группы. Дочерние группы хранят свои листья отдельно.
 *
 * Используется recomputeGroup для скопированного пересчёта поддерева.
 */
export type GroupLeafMap = WeakMap<object, LeafEntry[]>;

/** Получить или создать массив листьев для группы. */
function getOrCreateLeafList(map: GroupLeafMap, group: object): LeafEntry[] {
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
  leafNodes: LeafEntry[],
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
  groupLeafMap: GroupLeafMap,
  translate: TranslateFn,
) {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if ("value" in child) {
      // Листовой узел: запоминаем, ставим начальный value (computed позже)
      const entry: LeafEntry = { node: child, path };
      leafNodes.push(entry);
      // Добавляем в leaf-list текущей группы (node — родитель)
      if (groupLeafMap) getOrCreateLeafList(groupLeafMap, node).push(entry);

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

    // Если промежуточный узел имеет computed-свойства (isVisible на группе),
    // регистрируем его тоже как "виртуальный" лист
    if (!("value" in child) && hasComputedProps(child)) {
      const entry: LeafEntry = { node: child, path };
      leafNodes.push(entry);
      // Виртуальный лист группы хранится в её собственном leaf-list
      if (groupLeafMap) getOrCreateLeafList(groupLeafMap, child).push(entry);

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
    }

    // Рекурсия в дочерние
    registerNodes(child, (initialSlice as Record<string, unknown> | undefined)?.[key] as InitialSlice<AnyConfigNode> | undefined, leafNodes, nodeState, path, groupLeafMap, translate);
  }
}
