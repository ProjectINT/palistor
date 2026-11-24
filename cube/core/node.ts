// ─────────────────────────────────────────────────────────────────────────────
// The public node: what `store.proxy.a.b` returns. One plain object per cube:
//   • its own enumerable keys are exactly store's spread keys ({...form.email},
//     Object.keys), as getters closing over the cube — no Proxy for spread;
//   • everything else (the other state names store answers, the children) is
//     a non-enumerable getter on a prototype shared by all nodes of one
//     config, so a node costs one object literal. The cube's own members never
//     occupy child names. The names a group child cannot take are the ones
//     store's group proxy answers before child lookup: they were unreachable
//     there and throw a clear error here.
// ─────────────────────────────────────────────────────────────────────────────

import { childKeys, type CubeConfig } from "./config";
import type { Cube } from "./cube";
import type { FlowCube, StepCube } from "./flow";
import type { ListCube } from "./listCube";
import { track } from "./track";

export const CUBE = Symbol("palistor.cube");
export type PublicNode = Record<string | symbol, any>;

type Read = (c: Cube) => unknown;

const touched = (read: Read): Read => (c) => { c.touch(); return read(c); };

const onValueChange = (c: Cube) => c.fn("onValueChange", () => (v: unknown) => { c.write(v); });
const submit = (c: Cube) => c.fn("submit", () => () => c.submit());
const reset = (c: Cube) => c.fn("reset", () => (values?: Record<string, unknown>) => c.reset(values));
const setValues = (c: Cube) => c.fn("setValues", () => (patch: Record<string, unknown>) => c.setValues(patch));

// ── Own (spread) keys, one literal per kind ────────────────────────────────

/** store: SPREADABLE_FIELD_STATE_PROPS. */
function leafNode(c: Cube, proto: object): PublicNode {
  return {
    __proto__: proto,
    get value() { c.touch(); return c.value; },
    set value(v: unknown) { c.write(v); },
    get label() { c.touch(); return c.label; },
    get placeholder() { c.touch(); return c.placeholder; },
    get description() { c.touch(); return c.description; },
    get isRequired() { c.touch(); return c.isRequired; },
    get isReadOnly() { c.touch(); return c.isReadOnly; },
    get isDisabled() { c.touch(); return c.isDisabled; },
    get isVisible() { c.touch(); return c.isVisible; },
    get isInvalid() { c.touch(); return c.isInvalid; },
    get errorMessage() { c.touch(); return c.errorMessage; },
    get onValueChange() { return onValueChange(c); },
  } as PublicNode;
}

/** store's entity-leaf proxy spread: the leaf keys, then dirty, loading, submitting, submit, and onValueChange last. */
function entityLeafNode(c: Cube, proto: object): PublicNode {
  return {
    __proto__: proto,
    get value() { c.touch(); return c.value; },
    set value(v: unknown) { c.write(v); },
    get label() { c.touch(); return c.label; },
    get placeholder() { c.touch(); return c.placeholder; },
    get description() { c.touch(); return c.description; },
    get isRequired() { c.touch(); return c.isRequired; },
    get isReadOnly() { c.touch(); return c.isReadOnly; },
    get isDisabled() { c.touch(); return c.isDisabled; },
    get isVisible() { c.touch(); return c.isVisible; },
    get isInvalid() { c.touch(); return c.isInvalid; },
    get errorMessage() { c.touch(); return c.errorMessage; },
    get dirty() { return c.dirty; },
    get loading() { c.touch(); return c.loading; },
    get submitting() { return c.submitting; },
    get submit() { return submit(c); },
    get onValueChange() { return onValueChange(c); },
  } as PublicNode;
}

/** store: GROUP_SPREAD_KEYS. */
function groupNode(c: Cube, proto: object): PublicNode {
  return {
    __proto__: proto,
    get value() { c.touch(); return c.value; },
    set value(v: unknown) { c.write(v); },
    get submitting() { return c.submitting; },
    get dirty() { return c.dirty; },
    get revalidate() { return c.revalidate; },
    // Wakes a lazy resolve, as a read of the data does. A flow step's is started by the flow, on entry.
    get loading() { if (c.flowRole !== "step") c.wake(); return c.loading; },
    get values() { return c.values; },
    get submit() { return submit(c); },
    get reset() { return reset(c); },
  } as PublicNode;
}

/** store: GROUP_SPREAD_KEYS, then FLOW_SPREAD_KEYS. The steps are children, off the spread. */
function flowNode(f: FlowCube, proto: object): PublicNode {
  return {
    __proto__: proto,
    get value() { f.touch(); return f.value; },
    set value(v: unknown) { f.write(v); },
    get submitting() { return f.submitting; },
    get dirty() { return f.dirty; },
    get revalidate() { return f.revalidate; },
    get loading() { f.wake(); return f.loading; },
    get values() { return f.values; },
    get submit() { return submit(f); },
    get reset() { return reset(f); },
    get currentStepKey() { return f.currentStepKey; },
    get currentStepIndex() { return f.currentStepIndex; },
    get canGoBack() { return f.canGoBack; },
    get history() { return f.history; },
    get errors() { return f.errors; },
    get steps() { return f.stepsNode; },
    get nextStep() { return f.fn("nextStep", () => () => f.nextStep()); },
    get back() { return f.fn("back", () => () => f.back()); },
    get goTo() { return f.fn("goTo", () => (keyOrIndex: string | number) => f.goTo(keyOrIndex)); },
    get validate() { return f.fn("validate", () => () => f.validate()); },
  } as PublicNode;
}

/**
 * flow.steps (store's steps proxy): own enumerable keys are the step keys,
 * `current` and `length`, as its ownKeys were; indices and iteration sit on a
 * per-flow prototype with the flow's cube link (useForm tracks navigation on
 * the flow through it). Not extensible, getters only: writes throw, as the
 * proxy's set trap made them.
 */
export function stepsNode(f: FlowCube): PublicNode {
  const steps = f.steps;
  const protoDesc: PropertyDescriptorMap = { [CUBE]: { value: f } };
  steps.forEach((s, i) => { protoDesc[i] = { configurable: true, get: () => s.node }; });
  const node = Object.create(Object.create(STEPS_PROTO, protoDesc)) as PublicNode;
  for (const s of steps) Object.defineProperty(node, s.key, { enumerable: true, configurable: true, get: () => s.node });
  Object.defineProperty(node, "current", { enumerable: true, configurable: true, get: () => f.current.node });
  Object.defineProperty(node, "length", { enumerable: true, configurable: true, get: () => steps.length });
  return Object.preventExtensions(node);
}

/** Through `this`, so iterating a useForm view yields tracked steps. */
const STEPS_PROTO = Object.create(Object.prototype, {
  [Symbol.iterator]: {
    configurable: true,
    value: function* (this: PublicNode) { for (let i = 0; i < this.length; i++) yield this[i]; },
  },
});

/** Navigation reads: useForm tracks them on a flow (and flow.steps) or a step only. */
export const FLOW_STATE_KEYS: ReadonlySet<string> = new Set([
  "currentStepKey", "currentStepIndex", "canGoBack", "history", "errors", "current", "status",
]);

/**
 * store: LIST_SPREAD_KEYS, plus FILTER_SPREAD_KEYS (`filter`, `values` — the
 * visible items, `fullLength`) on a list with a filter block, plus `sort`
 * (Cube only) on a list with a sort block, plus the
 * pagination surface on a list with `resolve.pagination` (PAGINATION_SPREAD_KEYS,
 * then INFINITE_SPREAD_KEYS for an infinite list, CHAIN_SPREAD_KEYS for
 * cursor / infinite). `length` is own but not enumerable, second in key
 * order, as on store's array-target proxy.
 */
function listNode(l: ListCube, proto: object): PublicNode {
  const fn = <F extends (...args: any[]) => any>(name: string, make: () => F) => ({ get: () => l.fn(name, make) });
  const desc: Array<[string, PropertyDescriptor]> = [
    ["items", { get() { l.touch(); return l.itemNodes(); } }],
    ["length", { enumerable: false, get() { l.touch(); return l.length; } }],
    ["loading", { get() { l.wake(); return l.loading; } }],
    ["dirty", { get: () => l.dirty }],
    ["error", { get: () => l.error }],
    ["resolveStatus", { get: () => l.resolveStatus }],
    ["add", fn("add", () => (row: any) => l.add(row))],
    ["remove", fn("remove", () => (id: string) => l.remove(id))],
    ["getById", fn("getById", () => (id: string) => l.getById(id)?.node)],
    ["setItems", fn("setItems", () => (rows: any[]) => l.setItems(rows))],
    ["map", {
      get() {
        l.touch();
        return l.fn("map", () => <T>(f: (item: PublicNode, i: number, id: string) => T) =>
          l.visibleItems().map((item, i) => f(item.node, i, item.entityId!)));
      },
    }],
    ["getValues", fn("getValues", () => () => structuredClone(l.plain()))],
    ["reload", fn("reload", () => () => l.rs?.reload())],
  ];
  const filter = l.filter;
  if (filter) {
    desc.push(
      ["filter", { get: () => filter.node }],
      ["values", { get() { l.touch(); return l.itemNodes(); } }],
      ["fullLength", { get() { l.touch(); return l.fullLength; } }],
    );
  }
  const sort = l.sort;
  if (sort) desc.push(["sort", { get: () => sort.node }]);
  const pg = l.pager;
  if (pg) {
    desc.push(
      ["page", { get: () => pg.page }],
      ["pageSize", { get: () => { track(l); return pg.pageSize; } }],
      ["pageCount", { get: () => pg.pageCount }],
      ["total", { get: () => pg.total }],
      ["serverTotal", { get: () => pg.serverTotal }],
      ["hasNextPage", { get: () => pg.hasNextPage }],
      ["hasPrevPage", { get: () => pg.hasPrevPage }],
      ["isFetching", { get: () => pg.isFetching }],
      ["isInitialLoading", { get: () => { l.wake(); return pg.isInitialLoading; } }],
      ["isPreviousData", { get: () => { track(l); return pg.isPreviousData; } }],
      ["isStaleFromStorage", { get: () => { track(l); return pg.isStaleFromStorage; } }],
      ["pendingAdds", { get: () => pg.pendingAdds }],
      ["scrollAnchor", { get: () => { track(l); return pg.scrollAnchor; } }],
      ["setPage", fn("setPage", () => (n: number) => pg.setPage(n))],
      ["nextPage", fn("nextPage", () => () => pg.nextPage())],
      ["prevPage", fn("prevPage", () => () => pg.prevPage())],
      ["refetch", fn("refetch", () => () => pg.refetch())],
      ["invalidate", fn("invalidate", () => (page?: number) => pg.invalidatePage(page))],
      ["prefetch", fn("prefetch", () => (n: number) => pg.prefetch(n))],
      ["setPageSize", fn("setPageSize", () => (n: number) => pg.setPageSize(n))],
      ["discardPendingAdds", fn("discardPendingAdds", () => () => pg.discardPendingAdds())],
      ["setScrollAnchor", fn("setScrollAnchor", () => (id: string | null) => pg.setScrollAnchor(id))],
    );
    if (pg.mode === "infinite") {
      desc.push(
        ["isFetchingNextPage", { get: () => pg.isFetchingNextPage }],
        ["loadedPages", { get: () => pg.loadedPages }],
        ["loadMore", fn("loadMore", () => () => pg.loadMore())],
      );
    }
    if (pg.mode !== "paged") desc.push(["continuationLost", { get: () => pg.continuationLost }]);
  }
  const node = Object.create(proto) as PublicNode;
  for (const [k, d] of desc) Object.defineProperty(node, k, { enumerable: true, configurable: true, ...d });
  return node;
}

/** Pagination getters: list state for useForm (only on a list node, so a group child named `page` or `total` is not mistaken for state). */
export const LIST_STATE_KEYS: ReadonlySet<string> = new Set([
  "page", "pageSize", "pageCount", "total", "serverTotal", "hasNextPage", "hasPrevPage", "isFetching",
  "isInitialLoading", "isPreviousData", "isStaleFromStorage", "pendingAdds", "scrollAnchor",
  "isFetchingNextPage", "loadedPages", "continuationLost",
]);

/**
 * Every member of `list.sort`: a read of any of them through useForm tracks
 * the sort (its state moves on toggle / set / clear / reset). A set of its
 * own, not STATE_KEYS: a group may have children named `key`, `by` or `dir`.
 * The actions are in it too, so a component that only calls `toggle` follows
 * the sort, not every change of the store.
 */
export const SORT_STATE_KEYS: ReadonlySet<string> = new Set([
  "by", "key", "dir", "keys", "dirOf", "sortDescriptor",
  "toggle", "set", "clear", "reset", "refresh", "onSortChange",
]);

// ── Prototypes: the off-spread names, children by config ───────────────────

function accessors(reads: Record<string, Read>, enumerable = false): PropertyDescriptorMap {
  const out: PropertyDescriptorMap = {};
  for (const k in reads) {
    const read = reads[k];
    out[k] = { configurable: true, enumerable, get(this: PublicNode) { return read(this[CUBE]); } };
  }
  return out;
}

/** What store's leaf proxy answers off the spread. */
const LEAF_HIDDEN = accessors({
  dirty: (c) => c.dirty,
  loading: touched((c) => c.loading),
  submitting: (c) => c.submitting,
  submit,
});

/** The rest of what store's group proxy answers before child lookup. */
const GROUP_HIDDEN = accessors({
  setValues,
  onValueChange,
  label: touched((c) => c.label),
  placeholder: touched((c) => c.placeholder),
  description: touched((c) => c.description),
  isRequired: touched((c) => c.isRequired),
  isReadOnly: touched((c) => c.isReadOnly),
  isDisabled: touched((c) => c.isDisabled),
  isVisible: touched((c) => c.isVisible),
  isInvalid: touched((c) => c.isInvalid),
  errorMessage: touched((c) => c.errorMessage),
});

/**
 * An entity node (a list item, or the view useForm(entity, template) opens):
 * store's entity projection spread — `id`, the template's keys, then loading,
 * submitting, submit, values, dirty — as own enumerable getters. `id` is the
 * entity id string (store.rekey moves it) and shadows a template child named
 * `id`, the row's id leaf. The group surface off the spread (value, reset,
 * revalidate, …) sits on a prototype shared by every node of one template.
 */
const ITEM_OWN_TAIL = accessors({
  loading: (c) => c.loading,
  submitting: (c) => c.submitting,
  submit,
  values: (c) => c.values,
  dirty: (c) => c.dirty,
}, true);
ITEM_OWN_TAIL.id = { enumerable: true, configurable: true, get(this: PublicNode) { return (this[CUBE] as Cube).idValue(); } };

const ITEM_HIDDEN = accessors({ revalidate: (c) => c.revalidate, reset });
ITEM_HIDDEN.value = {
  configurable: true,
  get(this: PublicNode) { const c: Cube = this[CUBE]; c.touch(); return c.value; },
  set(this: PublicNode, v: unknown) { this[CUBE].write(v); },
};

type ItemCtor = new (c: Cube) => PublicNode;
const itemCtors = new WeakMap<CubeConfig, ItemCtor>();

function itemCtor(template: CubeConfig): ItemCtor {
  let ctor = itemCtors.get(template);
  if (ctor) return ctor;
  const proto = Object.create(groupProto(template, true), ITEM_HIDDEN);
  const own: PropertyDescriptorMap = { id: ITEM_OWN_TAIL.id };
  for (const k of childKeys(template, true)) {
    if (k === "id") continue;
    own[k] = { ...childAccessor(k), enumerable: true };
  }
  for (const k of ["loading", "submitting", "submit", "values", "dirty"]) own[k] = ITEM_OWN_TAIL[k];
  const Item = function (this: PublicNode, c: Cube) {
    Object.defineProperty(this, CUBE, { value: c });
    Object.defineProperties(this, own);
  };
  Item.prototype = proto;
  itemCtors.set(template, (ctor = Item as unknown as ItemCtor));
  return ctor;
}

/** Names a group child cannot take. */
export const RESERVED_CHILD_NAMES: ReadonlySet<string> = new Set([
  "value", "submitting", "dirty", "revalidate", "loading", "values", "submit", "reset",
  ...Object.keys(GROUP_HIDDEN),
]);

/**
 * Names a template child cannot take: the entity node answers these before
 * the template (store's entity projection did the same). The other group
 * names (label, value, reset, …) are shadowed by the template's own keys.
 */
export const RESERVED_TEMPLATE_CHILD_NAMES: ReadonlySet<string> = new Set([
  "loading", "submitting", "submit", "values", "dirty",
]);

/** Keys whose read is node state (useForm tracks the node on them). */
export const STATE_KEYS: ReadonlySet<string> = new Set([
  "value", "label", "placeholder", "description", "isRequired", "isReadOnly", "isDisabled", "isVisible",
  "isInvalid", "errorMessage", "dirty", "loading", "submitting", "revalidate", "values",
  "items", "length", "map", "error", "resolveStatus",
  "fullLength", "isActive", "activeCount", "isPending", "isDraft", "applied", // list / list.filter
]);

/**
 * A step answers its status off the spread, and its own isInvalid. Neither
 * wakes the step's lazy resolve: store's group proxy answered both before its
 * lazy-resolve trigger (the flow starts it on entry).
 */
const STEP_HIDDEN = accessors({
  status: (c) => (c as StepCube).status,
  isInvalid: (c) => c.isInvalid,
});

const LIST_PROTO = Object.create(Object.prototype, {
  [Symbol.iterator]: {
    configurable: true,
    value: function* (this: PublicNode) { yield* (this[CUBE] as ListCube).itemNodes(); },
  },
});
const LEAF_PROTO = Object.create(Object.prototype, LEAF_HIDDEN);
const ENTITY_LEAF_PROTO = Object.create(LEAF_PROTO);
const groupProtos = new WeakMap<CubeConfig, object>();
const templateGroupProtos = new WeakMap<CubeConfig, object>();
const stepProtos = new WeakMap<CubeConfig, object>();

function childAccessor(k: string): PropertyDescriptor {
  return {
    configurable: true,
    get(this: PublicNode) {
      const c: Cube = this[CUBE];
      c.touch();
      return c.children.get(k)!.node;
    },
  };
}

/** One prototype per group config (and role): the hidden names plus a getter per child. */
function groupProto(config: CubeConfig, template: boolean): object {
  const cache = template ? templateGroupProtos : groupProtos;
  const hit = cache.get(config);
  if (hit) return hit;
  const desc: PropertyDescriptorMap = { ...GROUP_HIDDEN };
  for (const k of childKeys(config, template)) desc[k] = childAccessor(k);
  const proto = Object.create(Object.prototype, desc);
  cache.set(config, proto);
  return proto;
}

/** A step's prototype: its group prototype plus `status` (a config used as a plain group elsewhere keeps its own). */
function stepProto(config: CubeConfig): object {
  const hit = stepProtos.get(config);
  if (hit) return hit;
  const proto = Object.create(groupProto(config, false), STEP_HIDDEN) as object;
  stepProtos.set(config, proto);
  return proto;
}

/**
 * fieldMapping lays one prototype layer per node prototype (mapping.ts), so
 * every node on one prototype has the same own keys: an entity leaf (own
 * dirty, loading, submitting, submit) gets a prototype of its own.
 */
export function makeNode(cube: Cube): PublicNode {
  const map = cube.hub.map;
  if (cube.entityId !== undefined) {
    const item = new (itemCtor(cube.config))(cube);
    return map ? map.project(item) : item;
  }
  if (cube.kind === "list") {
    // A list's own keys are exactly store's (Reflect.ownKeys included): its cube link sits on a per-list prototype.
    const list = listNode(cube as ListCube, Object.create(LIST_PROTO, { [CUBE]: { value: cube } }));
    return map ? map.project(list) : list;
  }
  const role = cube.flowRole;
  const node =
    cube.kind === "leaf" ? (cube.item ? entityLeafNode(cube, ENTITY_LEAF_PROTO) : leafNode(cube, LEAF_PROTO))
    : role === "flow" ? flowNode(cube as FlowCube, groupProto(cube.config, false))
    : groupNode(cube, role === "step" ? stepProto(cube.config) : groupProto(cube.config, cube.item !== null));
  Object.defineProperty(node, CUBE, { value: cube });
  if (map) map.project(node);

  const props = cube.kind === "leaf" ? cube.config.componentProps : undefined;
  if (props) {
    for (const k of Object.keys(props)) {
      if (k in node) continue;
      Object.defineProperty(node, k, { enumerable: true, configurable: true, get: () => props[k] });
    }
  }
  return node;
}

/** Construction-time check: a child must not take a name its node answers itself. */
export function assertChildName(key: string, path: string, template: boolean) {
  const reserved = template ? RESERVED_TEMPLATE_CHILD_NAMES : RESERVED_CHILD_NAMES;
  if (!reserved.has(key)) return;
  throw new Error(
    `[palistor/cube] "${path}": a child cannot be named "${key}", the ${template ? "entity" : "group"} node uses that name ` +
    `(reserved: ${[...reserved].join(", ")}).`,
  );
}

export const cubeOf = (node: unknown): Cube | undefined =>
  node !== null && typeof node === "object" ? (node as PublicNode)[CUBE] : undefined;
