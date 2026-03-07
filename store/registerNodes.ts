import { type FieldState, resolveFlag } from "./compute";
import { CONFIG_PROPS } from "./constants";
import { type AnyConfigNode } from "./collectValues";
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

export function registerNodes<TNode extends AnyConfigNode>(
  node: TNode,
  initialSlice: InitialSlice<TNode> | undefined,
  leafNodes: Array<{ node: AnyConfigNode; path: string }>,
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
) {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if ("value" in child) {
      // Листовой узел: запоминаем, ставим начальный value (computed позже)
      leafNodes.push({ node: child, path });

      const rawSlice = initialSlice as Record<string, unknown> | undefined;
      const sliceValues = (rawSlice ?? {}) as Record<string, unknown>;
      const rawValue = child.value;
      const configValue = typeof rawValue === "function" ? rawValue(sliceValues) : rawValue;
      const initialValue = rawSlice?.[key] ?? configValue ?? "";
      nodeState.set(child, {
        value: initialValue,
        isVisible:  resolveFlag(child.isVisible  as MaybeFlag, sliceValues, true),
        isRequired: resolveFlag(child.isRequired as MaybeFlag, sliceValues, false),
        isDisabled: resolveFlag(child.isDisabled as MaybeFlag, sliceValues, false),
        isReadOnly: resolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false),
        dirty: false,
        revalidate: false,
      });
    }

    // Если промежуточный узел имеет computed-свойства (isVisible на группе),
    // регистрируем его тоже как "виртуальный" лист
    if (!("value" in child) && hasComputedProps(child)) {
      leafNodes.push({ node: child, path });
      const sliceValues = (initialSlice as Record<string, unknown> | undefined ?? {}) as Record<string, unknown>;
      nodeState.set(child, {
        value: undefined,
        isVisible:  resolveFlag(child.isVisible  as MaybeFlag, sliceValues, true),
        isRequired: resolveFlag(child.isRequired as MaybeFlag, sliceValues, false),
        isDisabled: resolveFlag(child.isDisabled as MaybeFlag, sliceValues, false),
        isReadOnly: resolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false),
        dirty: false,
        revalidate: false,
      });
    }

    // Рекурсия в дочерние
    registerNodes(child, (initialSlice as Record<string, unknown> | undefined)?.[key] as InitialSlice<AnyConfigNode> | undefined, leafNodes, nodeState, path);
  }
}
