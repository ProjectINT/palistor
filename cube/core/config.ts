// ─────────────────────────────────────────────────────────────────────────────
// Config: the same language as Palistor's. A node with `value` is a leaf, a
// node without it is a group, an array `[template, opts?]` is a list.
// ─────────────────────────────────────────────────────────────────────────────

export type Values = Record<string, any>;
export type Translate = (key: string, ...args: any[]) => string;
export type NotifyFn = (...args: any[]) => void;

/** What `resolve.onError` gets next to the error (hub.errorContext): one object per store. */
export interface ResolveErrorContext {
  notify: NotifyFn;
  t: Translate;
}

export interface ResolveConfig {
  /** Leaf → value, group → patch of values, list → array of rows (a list resolver also gets a context). */
  resolver: (values: Values, store: any, ctx?: any) => unknown;
  /** A synchronous placeholder applied when the run starts. Same result shape. Not for lists, as in store. */
  optimisticResolver?: (values: Values) => unknown;
  /** After the last retry. `notify` is the store's notifier, `t` its current translator (it follows setTranslator). */
  onError?: (error: unknown, ctx: ResolveErrorContext) => void;
  /** Value paths that restart the resolver even before its first run. */
  deps?: string[];
  /** Context keys that must be non-null before a run starts; until then the resolve waits (idle) for setContext. Not for entity cubes, as in store. */
  contextDeps?: string[];
  /** List only: a page cache (pagination.ts). The resolver gets `ctx.page` and may return `{ items, total, nextCursor, hasMore }`. */
  pagination?: unknown;
  options?: {
    /** false → start right on creation, true (default) → on first read. */
    lazy?: boolean;
    /** Not for lists, as in store (list.reload() is the retry there). */
    retry?: { attempts: number; delay?: number };
    /** Entity field: skip when the row already holds a value other than the template default (default true). */
    skipIfResolved?: boolean;
    /**
     * A form group: reading its children, value, label or flags throws the run's promise while it is pending.
     * A list: `items` / `length` / `map` / `values` do (a paginated list: only with nothing on screen).
     */
    suspense?: boolean;
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
  onSubmit?: (payload: any, store: any, parent?: any) => unknown;
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

/** Service keys whose value is an object by nature; under a template every other object-valued key is a child node. */
const STRUCTURAL_PROPS = new Set<string>(["componentProps", "resolve", "types", "dependencies", "deps", "__flowSteps"]);

const groupChildKeys = new WeakMap<CubeConfig, string[]>();
const templateChildKeys = new WeakMap<CubeConfig, string[]>();

/**
 * Child keys of a config (a template is shared by thousands of items: cached).
 * A form group's service keys (label, isVisible, …) are never children, as in
 * store, where its proxy answered them before child lookup. Under an entity
 * template an object there (`label: { value: "" }`) is a child: store's entity
 * projection reached such template fields.
 */
export function childKeys(c: CubeConfig, template = false): string[] {
  const cache = template ? templateChildKeys : groupChildKeys;
  let keys = cache.get(c);
  if (!keys) {
    const skip = template ? STRUCTURAL_PROPS : CONFIG_PROPS;
    keys = Object.keys(c).filter((k) => !skip.has(k) && typeof c[k] === "object" && c[k] !== null);
    cache.set(c, keys);
  }
  return keys;
}

const withLists = new WeakMap<CubeConfig, boolean>();

/** A template with a list somewhere below (its rows own lists): cached, a template is shared by every item. */
export function hasLists(template: CubeConfig): boolean {
  let hit = withLists.get(template);
  if (hit === undefined) {
    hit = childKeys(template, true).some((k) => {
      const sub = template[k];
      return Array.isArray(sub) || (isPlainObject(sub) && !isLeafConfig(sub) && hasLists(sub as CubeConfig));
    });
    withLists.set(template, hit);
  }
  return hit;
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
