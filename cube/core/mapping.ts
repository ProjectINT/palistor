// ─────────────────────────────────────────────────────────────────────────────
// fieldMapping: one public vocabulary for field-state names (`isRequired` →
// `required`, `dirty` → `isDirty`, …). Same rules as store's normalizeConfig
// and the `externalToInternal` translation in each of its proxy traps.
//
//   In:  the config is authored in external names. normalize() turns it into
//        internal names once, in the constructor, so nothing below the
//        constructor knows the map exists.
//   Out: every public node answers the external names. project() renames a
//        fresh node's own (spread) keys in place, keeping their order, and puts
//        one prototype layer under it: the internal names of the renamed keys
//        (readable, off the spread) and the external names of what the node
//        answers off the spread (a group's `isInvalid` → `error`).
//
// Child identity is never remapped: values, payloads and paths keep the
// config's child keys.
// ─────────────────────────────────────────────────────────────────────────────

import { CONFIG_PROPS } from "./config";
import type { PublicNode } from "./node";

/** Names a map may rename (store: MAPPABLE_KEYS — the field-state names plus onValueChange). */
const MAPPABLE_KEYS = new Set<string>([
  "value", "label", "placeholder", "description", "isRequired", "isReadOnly", "isDisabled", "isVisible",
  "isInvalid", "errorMessage", "dirty", "loading", "onValueChange",
]);

/** The mappable names an author writes in a config (store: MAPPABLE_CONFIG_KEYS); the rest are computed. */
const MAPPABLE_CONFIG_KEYS = new Set<string>([
  "value", "label", "placeholder", "description", "isRequired", "isReadOnly", "isDisabled", "isVisible",
]);

/**
 * List keys a map must not rename anything to (store: FILTER_SPREAD_KEYS,
 * SORT_SPREAD_KEYS, PAGINATION_SPREAD_KEYS): a list answers them itself, and
 * one string must not carry two meanings.
 */
const RESERVED_LIST_KEYS: readonly string[] = [
  "filter", "values", "fullLength",
  "sort",
  "page", "pageSize", "pageCount", "total", "serverTotal", "hasNextPage", "hasPrevPage", "isFetching",
  "isInitialLoading", "isPreviousData", "isStaleFromStorage", "pendingAdds", "scrollAnchor",
  "setPage", "nextPage", "prevPage", "refetch", "invalidate", "prefetch", "setPageSize",
  "discardPendingAdds", "setScrollAnchor",
];

/** Only plain objects and arrays are config structure; a Date or a class instance passes through as it is. */
const isStructure = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null || Array.isArray(v);
};

export class FieldMap {
  /** external → internal. */
  readonly e2i: Record<string, string> = {};
  /** A node prototype → the layer laid under every node of that shape. */
  private readonly layers = new WeakMap<object, object>();

  /** `fwd`: internal → external, as passed in `fieldMapping`. */
  constructor(readonly fwd: Readonly<Record<string, string | undefined>>) {
    for (const internal in fwd) {
      const external = fwd[internal];
      if (external !== undefined) this.e2i[external] = internal;
    }
    for (const external in this.e2i) {
      if (!RESERVED_LIST_KEYS.includes(external)) continue;
      throw new Error(
        `[palistor] fieldMapping renames "${this.e2i[external]}" to "${external}", ` +
        `which is a reserved list key (${RESERVED_LIST_KEYS.join(", ")}).`,
      );
    }
  }

  get empty(): boolean {
    for (const _ in this.e2i) return false;
    return true;
  }

  /** The internal name behind an external one (a name the map doesn't rename is itself). */
  internal(key: string): string { return this.e2i[key] ?? key; }

  /**
   * The config in internal names: a new tree, the original is not touched; an
   * empty map returns the config itself. Strict: the internal name of a
   * renamed config key, or a computed key in the config, throws.
   */
  normalize<T>(config: T): T {
    return this.empty ? config : (this.node(config) as T);
  }

  private node(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((el) => this.node(el)); // a list: [template, options?]
    if (!isStructure(node)) return node;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (MAPPABLE_CONFIG_KEYS.has(key) && this.fwd[key] !== undefined) {
        throw new Error(`[palistor] fieldMapping is active: write "${this.fwd[key]}" instead of internal "${key}" in config.`);
      }
      const internal = this.e2i[key];
      if (internal !== undefined) {
        if (MAPPABLE_CONFIG_KEYS.has(internal)) { out[internal] = value; continue; }
        if (MAPPABLE_KEYS.has(internal)) {
          throw new Error(`[palistor] "${internal}" (mapped as "${key}") is computed and cannot be set in config — remove it.`);
        }
      }
      // A service key as it is; anything else is a child (or list options, a filter block): its config is normalized too.
      out[key] = CONFIG_PROPS.has(key) ? value : this.node(value);
    }
    return out;
  }

  /**
   * A fresh node in the external vocabulary. Every node with one prototype has
   * the same own keys (node.ts keeps it so), so the layer is built once per
   * prototype.
   */
  project(node: PublicNode): PublicNode {
    const fwd = this.fwd;
    const own = Object.getOwnPropertyNames(node);
    const descs = Object.getOwnPropertyDescriptors(node);
    if (own.some((k) => fwd[k] !== undefined)) {
      for (const k of own) delete node[k];
      for (const k of own) Object.defineProperty(node, fwd[k] ?? k, descs[k]);
    }
    const proto = Object.getPrototypeOf(node) as object;
    let layer = this.layers.get(proto);
    if (!layer) this.layers.set(proto, (layer = this.layer(proto, own, descs)));
    return Object.setPrototypeOf(node, layer);
  }

  private layer(proto: object, own: string[], descs: PropertyDescriptorMap): object {
    const out: PropertyDescriptorMap = {};
    for (const k of own) {
      const ext = this.fwd[k];
      if (ext === undefined) continue;
      out[k] = {
        configurable: true,
        get(this: PublicNode) { return this[ext]; },
        set: descs[k].set && function (this: PublicNode, v: unknown) { this[ext] = v; },
      };
    }
    for (let p: object | null = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) {
        const ext = this.fwd[k];
        if (ext === undefined || ext in out || own.includes(k)) continue;
        out[ext] = { ...Object.getOwnPropertyDescriptor(p, k)!, enumerable: false };
      }
    }
    return Object.create(proto, out);
  }
}
