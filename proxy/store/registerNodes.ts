import { type FieldState, resolveFlag } from "./compute";
import { CONFIG_PROPS } from "./constants";
import { type AnyConfigNode } from "./collectValues";
import { hasComputedProps } from "./hasComputedProps";

/**
 * Фаза 1: Собираем все листовые узлы и устанавливаем начальные value.
 * Ещё не вычисляем computed — для этого нужны все values.
 */
type MaybeFlag = boolean | ((values: any) => boolean) | undefined;

export function registerNodes(
  node: AnyConfigNode,
  initialSlice: Record<string, unknown> | undefined,
  leafNodes: Array<{ node: AnyConfigNode }>,
  nodeState: WeakMap<object, FieldState>,
) {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Листовой узел: запоминаем, ставим начальный value (computed позже)
      leafNodes.push({ node: child });

      const sliceValues = (initialSlice ?? {}) as Record<string, unknown>;
      const rawValue = child.value;
      const configValue = typeof rawValue === "function" ? rawValue(sliceValues) : rawValue;
      const initialValue = initialSlice?.[key] ?? configValue ?? "";
      nodeState.set(child, {
        value: initialValue,
        isVisible:  resolveFlag(child.isVisible  as MaybeFlag, sliceValues, true),
        isRequired: resolveFlag(child.isRequired as MaybeFlag, sliceValues, false),
        isDisabled: resolveFlag(child.isDisabled as MaybeFlag, sliceValues, false),
        isReadOnly: resolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false),
      });
    }

    // Если промежуточный узел имеет computed-свойства (isVisible на группе),
    // регистрируем его тоже как "виртуальный" лист
    if (!("value" in child) && hasComputedProps(child)) {
      leafNodes.push({ node: child });
      const sliceValues = (initialSlice ?? {}) as Record<string, unknown>;
      nodeState.set(child, {
        value: undefined,
        isVisible:  resolveFlag(child.isVisible  as MaybeFlag, sliceValues, true),
        isRequired: resolveFlag(child.isRequired as MaybeFlag, sliceValues, false),
        isDisabled: resolveFlag(child.isDisabled as MaybeFlag, sliceValues, false),
        isReadOnly: resolveFlag(child.isReadOnly as MaybeFlag, sliceValues, false),
      });
    }

    // Рекурсия в дочерние
    registerNodes(child, initialSlice?.[key] as Record<string, unknown> | undefined, leafNodes, nodeState);
  }
}
