import type { FieldState } from "../index";
import type { AnyConfigNode, TranslateFn } from "../../store/types";
import type { GroupLeafMap } from "../../store/registerNodes";
import type { ValuesCache } from "../../valuesCache";

// ─── Типы ────────────────────────────────────────────────────────────────────

/**
 * Обёртка для отслеживания кросс-групповых зависимостей.
 * Принимает узел (для определения группы-реципиента) и сырые значения,
 * возвращает те же значения, обёрнутые в tracking-proxy.
 */
export type TrackingWrap = (node: object, values: Record<string, unknown>) => Record<string, unknown>;

/**
 * Зависимости для таргетированного пересчёта.
 */
export interface RecomputeTargetedDeps {
  rootConfig: AnyConfigNode;
  groupLeafMap: GroupLeafMap;
  nodeState: WeakMap<object, FieldState>;
  nodeParents: WeakMap<object, object>;
  nodePaths: WeakMap<object, string>;
  groupDeps: Set<string>;
  valuesCache: ValuesCache;
  translate: TranslateFn;
}
