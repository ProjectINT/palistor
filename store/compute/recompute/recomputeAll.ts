import type { FieldState } from "../index";
import type { AnyConfigNode, TranslateFn } from "../../types";
import type { GroupLeafMap } from "../../registerNodes";
import type { ValuesCache } from "../../valuesCache";
import type { TrackingWrap } from "./types";
import { recomputeGroup } from "./recomputeGroup";

/**
 * Пересчитать вычисленное состояние всех листовых полей.
 * Делегирует в recomputeGroup(rootConfig) — полный пересчёт всего дерева.
 *
 * Вызывается при init и после каждого SET .value.
 */
export function recomputeAll(
  rootConfig: AnyConfigNode,
  groupLeafMap: GroupLeafMap,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  return recomputeGroup(
    rootConfig,
    groupLeafMap,
    nodeState,
    valuesCache,
    translate,
    trackingWrap,
  );
}
