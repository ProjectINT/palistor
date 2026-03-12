import type { AnyConfigNode } from "../store/types";
import type { WriteResult } from "./types";
import type { Palistor } from "../store/palistor";
import { formatValue } from "./formatValue";
import { storeValue } from "./storeValue";
import { runSetter } from "./runSetter";
import { mergeChanged } from "./mergeChanged";

export type { WriteResult } from "./types";
export type { Setter } from "./types";
export { formatValue } from "./formatValue";
export { formatPatch } from "./formatPatch";
export { storeValue } from "./storeValue";
export { runSetter } from "./runSetter";
export { mergeChanged } from "./mergeChanged";

/**
 * WritePipeline — полный write pipeline: format → store → (setter?) → recompute → merge changed.
 *
 * Всегда записывает значение в текущий узел через storeValue.
 * Если у узла есть setter — дополнительно патчит зависимые поля.
 */
export class WritePipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  execute(
    node: AnyConfigNode,
    rawValue: unknown,
    previousValue?: unknown,
  ): WriteResult | null {
    const nodeState = this.kernel.nodes.nodeState;
    const valuesCache = this.kernel.values;

    // Фаза 1: Форматирование
    const processedValue = formatValue(rawValue, node, valuesCache.values);

    // Фаза 1.5: Быстрый выход — значение не изменилось
    const currentState = nodeState.get(node);
    if (currentState && Object.is(processedValue, currentState.value)) {
      return { changed: new Set<object>(), skipped: true };
    }

    // Фаза 2: Прямая запись значения
    const stored = storeValue(node, processedValue, nodeState, valuesCache);
    if (!stored) return null;

    // Фаза 2.5: Setter-ветка — патч зависимых полей
    const patchedNodes = typeof node.setter === "function"
      ? runSetter(node, processedValue, this.kernel.rootConfig as AnyConfigNode, nodeState, valuesCache, previousValue)
      : new Set<object>();

    // Фаза 3: Таргетированный пересчёт затронутых групп
    const changedSoFar = new Set<object>([node]);
    for (const n of patchedNodes) changedSoFar.add(n);
    const recomputedNodes = this.kernel.recomputeAll(changedSoFar);

    // Фаза 4: Объединение всех изменённых узлов
    return { changed: mergeChanged(node, patchedNodes, recomputedNodes) };
  }
}
