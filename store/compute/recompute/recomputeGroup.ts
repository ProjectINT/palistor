import type { FieldState } from "../index";
import type { AnyConfigNode, TranslateFn } from "../../store/types";
import type { GroupLeafMap } from "../../store/registerNodes";

import type { ValuesCache } from "../../valuesCache/valuesCache";
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
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  const leafNodes = collectGroupLeafNodes(groupNode, groupLeafMap);

  return recomputeLeaves(
    leafNodes,
    nodeState,
    valuesCache,
    translate,
    trackingWrap
  );
}
