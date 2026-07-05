/** Result of a write pipeline run. */
export interface WriteResult {
  /** All nodes whose state changed (for subscriber notification). */
  changed: Set<object>;
  /** True when the write was skipped — the formatted value equals the current one. */
  skipped?: boolean;
}

/** Signature of a node's setter function. */
export type Setter = (
  v: unknown,
  vals: Record<string, unknown>,
  prev: unknown,
) => Record<string, unknown>;
