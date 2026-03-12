import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";

/** Зависимости pipeline — всё, что нужно для выполнения записи. */
export interface WriteDeps {
  rootConfig: object;
  nodeState: WeakMap<object, FieldState>;
  /**
   * Пересчёт состояния.
   * - Без аргументов → полный recomputeAll
   * - С changedNodes → таргетированный пересчёт затронутых групп
   */
  recomputeAll: (changedNodes?: Set<object>) => Set<object>;
  /** Постоянно-актуальный кеш значений. */
  valuesCache: ValuesCache;
}

/** Результат выполнения write pipeline. */
export interface WriteResult {
  /** Все узлы, чьё состояние изменилось (для уведомления подписчиков). */
  changed: Set<object>;
  /** True если запись пропущена — значение после форматирования совпадает с текущим. */
  skipped?: boolean;
}

/** Сигнатура setter-функции узла. */
export type Setter = (
  v: unknown,
  vals: Record<string, unknown>,
  prev: unknown,
) => Record<string, unknown>;
