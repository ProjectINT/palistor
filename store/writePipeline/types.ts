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
