import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";

/** Результат выполнения submit pipeline. */
export type SubmitResult =
  | { success: true; result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };

export interface SubmitDeps {
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  resetNode: (groupNode: AnyConfigNode, values?: Record<string, unknown>) => void;
  /** Очистить persist-хранилище после успешного submit. */
  clearPersist?: () => Promise<void>;
  /** Постоянно-актуальный кеш значений. */
  valuesCache: ValuesCache;
  /** Маппинг узла → dot-путь (для извлечения поддерева значений). */
  nodePaths: WeakMap<object, string>;
  /** Корневой конфиг (для определения root vs sub-group). */
  rootConfig: AnyConfigNode;
}
