import type { FieldState } from "../index";
import type { AnyConfigNode, TranslateFn } from "../../types";
import type { GroupLeafMap } from "../../registerNodes";
import type { ValuesCache } from "../../valuesCache";
import type { TrackingWrap } from "./types";
import { collectGroupLeafNodes } from "./collectGroupLeafNodes";
import { recomputeLeaves } from "./recomputeLeaves";

/**
 * Пересчитать вычисленное состояние поддерева одного группового узла.
 *
 * Собирает ВСЕ листья поддерева (рекурсивно) и делегирует в recomputeLeaves.
 *
 * Возвращает Set узлов, чьё состояние изменилось (для notify).
 */
export function recomputeGroup(
  groupNode: AnyConfigNode,
  rootConfig: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  const leafNodes = collectGroupLeafNodes(groupNode, groupLeafMap);

  return recomputeLeaves(
    leafNodes,
    rootConfig,
    nodeState,
    valuesCache,
    translate,
    trackingWrap
  );
}
