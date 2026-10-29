// ─────────────────────────────────────────────────────────────────────────────
// Config: the same language as Palistor's. A node with `value` is a leaf, a
// node without it is a group, an array `[template, opts?]` is a list.
// ─────────────────────────────────────────────────────────────────────────────

export type Values = Record<string, any>;
export type Translate = (key: string, ...args: any[]) => string;
export type NotifyFn = (...args: any[]) => void;

export interface ResolveConfig {
  /** Leaf → value, group → patch of values, list → array of rows. */
  resolver: (values: Values, store: any) => unknown;
  /** A synchronous placeholder applied when the run starts. Same result shape. */
  optimisticResolver?: (values: Values) => unknown;
  onError?: (error: unknown, ctx: { notify: NotifyFn }) => void;
  /** Value paths that restart the resolver even before its first run. */
  deps?: string[];
  options?: {
    /** false → start right on creation, true (default) → on first read. */
    lazy?: boolean;
    retry?: { attempts: number; delay?: number };
  };
}

export interface CubeConfig {
  value?: unknown;
  label?: unknown;
  placeholder?: unknown;
  description?: unknown;
  isVisible?: unknown;
  isRequired?: unknown;
  isDisabled?: unknown;
  isReadOnly?: unknown;
  validate?: (value: any, values: Values, t: Translate) => unknown;
  formatter?: (raw: any, values: Values) => unknown;
  setter?: (value: any, values: Values, prev: any) => unknown;
  beforeSubmit?: (payload: any, values: Values) => any;
  onSubmit?: (payload: any, store: any, parent: any) => unknown;
  afterSubmit?: (result: unknown, actions: { reset(): void }) => unknown;
  onChange?: (info: { fieldKey: string; newValue: unknown; previousValue: unknown; allValues: Values }) => unknown;
  reset?: (defaults: Values) => Values;
  componentProps?: Record<string, unknown>;
  resolve?: ResolveConfig;
  /** Everything else is a nested cube. */
  [child: string]: unknown;
}

export type ListConfig = [CubeConfig, { resolve?: ResolveConfig; filter?: unknown }?];

/** Service keys of a config node (store/constants.ts CONFIG_PROPS); never children. */
export const CONFIG_PROPS = new Set<string>([
  "value", "label", "placeholder", "description",
  "isRequired", "isReadOnly", "isDisabled", "isVisible", "isInvalid", "errorMessage", "dirty", "loading",
  "validate", "formatter", "setter", "componentProps", "types", "dependencies",
  "onSubmit", "beforeSubmit", "afterSubmit", "reset", "onChange", "onEnter", "onReady",
  "resolve", "deps", "__kind", "__flowSteps",
]);

export const isLeafConfig = (c: object) => "value" in c;

const childKeyCache = new WeakMap<CubeConfig, string[]>();

/** Child keys of a group config (a template is shared by thousands of items: cached). */
export function childKeys(c: CubeConfig): string[] {
  let keys = childKeyCache.get(c);
  if (!keys) {
    keys = Object.keys(c).filter((k) => !CONFIG_PROPS.has(k) && typeof c[k] === "object" && c[k] !== null);
    childKeyCache.set(c, keys);
  }
  return keys;
}

export type SubmitError = { path: string; message: string };
export type SubmitResult = { success: true; result?: unknown } | { success: false; errors: SubmitError[] };

/** Empty for isRequired: null/undefined, a blank string, NaN (store/compute/isEmpty.ts). */
export function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return typeof v === "number" && Number.isNaN(v);
}

/** store/dirtyTracking/isDirtyValue.ts: objects compare by JSON. */
export function isDirtyValue(current: unknown, initial: unknown): boolean {
  if (current === initial) return false;
  if (current == null && initial == null) return false;
  if (current == null || initial == null || typeof current !== typeof initial) return true;
  if (typeof current !== "object") return true;
  try { return JSON.stringify(current) !== JSON.stringify(initial); } catch { return true; }
}

export const isPlainObject = (v: unknown): v is Values =>
  v !== null && typeof v === "object" && !Array.isArray(v);
