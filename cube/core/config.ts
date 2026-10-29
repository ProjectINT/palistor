// ─────────────────────────────────────────────────────────────────────────────
// Config: the same language as Palistor's. A node with `value` is a leaf, a
// node without it is a group, an array `[template, opts?]` is a list.
// ─────────────────────────────────────────────────────────────────────────────

import type { Cube } from "./cube";

export type Values = Record<string, any>;
export type Translate = (key: string) => string;
export type MaybeFn<T> = T | ((values: Values, t: Translate) => T);

export interface Resolve {
  /** The real resolver. Leaf → value, group → patch of values, list → array of rows. */
  resolver: (values: Values, store: Cube) => unknown;
  /** Optimistic: a synchronous placeholder while loading. Same result shape. */
  optimisticResolver?: (values: Values) => unknown;
  /** false → start right on creation, true (default) → on first read. */
  lazy?: boolean;
}

export interface CubeConfig {
  /** Has `value` → leaf. No `value` → group. Array `[template, opts?]` → list. */
  value?: unknown;
  label?: MaybeFn<string>;
  placeholder?: MaybeFn<string>;
  description?: MaybeFn<string>;
  isVisible?: MaybeFn<boolean>;
  isRequired?: MaybeFn<boolean>;
  isDisabled?: MaybeFn<boolean>;
  isReadOnly?: MaybeFn<boolean>;
  validate?: (value: any, values: Values, t: Translate) => string | false | undefined;
  formatter?: (raw: any, values: Values) => unknown;
  setter?: (value: any, values: Values, prev: any) => Values;
  beforeSubmit?: (payload: any, values: Values) => any;
  onSubmit?: (payload: any, store: Cube) => unknown;
  afterSubmit?: (result: unknown, actions: { reset(): void }) => unknown;
  onChange?: (info: {
    fieldKey: string;
    newValue: unknown;
    previousValue: unknown;
    allValues: Values;
  }) => Values | void | Promise<Values | void>;
  reset?: (defaults: Values) => Values;
  resolve?: Resolve;
  /** Everything else is a nested cube. */
  [child: string]: unknown;
}

export const RESERVED = new Set<string>([
  "value", "label", "placeholder", "description",
  "isVisible", "isRequired", "isDisabled", "isReadOnly",
  "validate", "formatter", "setter", "beforeSubmit", "onSubmit", "afterSubmit",
  "onChange", "reset", "resolve", "componentProps", "types", "dependencies",
]);

export const childKeys = (c: CubeConfig) =>
  Object.keys(c).filter((k) => !RESERVED.has(k) && typeof c[k] === "object" && c[k] !== null);

export type SubmitResult =
  | { success: true; result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };
