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
import type { ListCube } from "./listCube";

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

/** store's entity-leaf proxy spread: the leaf keys plus dirty, loading, submitting, submit. */
function entityLeafNode(c: Cube, proto: object): PublicNode {
  const node = leafNode(c, proto);
  Object.defineProperties(node, {
    dirty: { enumerable: true, configurable: true, get: () => c.dirty },
    loading: { enumerable: true, configurable: true, get: () => { c.touch(); return c.loading; } },
    submitting: { enumerable: true, configurable: true, get: () => c.submitting },
    submit: { enumerable: true, configurable: true, get: () => submit(c) },
  });
  return node;
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
    get loading() { return c.loading; },
    get values() { return c.values; },
    get submit() { return submit(c); },
    get reset() { return reset(c); },
  } as PublicNode;
}

/** store: LIST_SPREAD_KEYS. */
function listNode(l: ListCube, proto: object): PublicNode {
  return {
    __proto__: proto,
    get items() { l.touch(); return l.itemNodes(); },
    get length() { l.touch(); return l.length; },
    get loading() { return l.loading; },
    get dirty() { return l.dirty; },
    get error() { return l.error; },
    get resolveStatus() { return l.resolveStatus; },
    get add() { return l.fn("add", () => (row: any) => l.add(row)); },
    get remove() { return l.fn("remove", () => (id: string) => l.remove(id)); },
    get getById() { return l.fn("getById", () => (id: string) => l.getById(id)?.node); },
    get setItems() { return l.fn("setItems", () => (rows: any[]) => l.setItems(rows)); },
    get map() {
      l.touch();
      return l.fn("map", () => <T>(fn: (item: PublicNode, i: number, id: string) => T) =>
        l.items.map((item, i) => fn(item.node, i, item.entityId!)));
    },
    get getValues() { return l.fn("getValues", () => () => structuredClone(l.plain())); },
    get reload() { return l.fn("reload", () => () => l.rs?.reload()); },
  } as PublicNode;
}

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
]);

const LIST_PROTO = Object.create(Object.prototype, {
  [Symbol.iterator]: {
    configurable: true,
    value: function* (this: PublicNode) { yield* (this[CUBE] as ListCube).itemNodes(); },
  },
});
const LEAF_PROTO = Object.create(Object.prototype, LEAF_HIDDEN);
const groupProtos = new WeakMap<CubeConfig, object>();
const templateGroupProtos = new WeakMap<CubeConfig, object>();

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

export function makeNode(cube: Cube): PublicNode {
  if (cube.entityId !== undefined) return new (itemCtor(cube.config))(cube);
  const node =
    cube.kind === "list" ? listNode(cube as ListCube, LIST_PROTO)
    : cube.kind === "leaf" ? (cube.item ? entityLeafNode(cube, LEAF_PROTO) : leafNode(cube, LEAF_PROTO))
    : groupNode(cube, groupProto(cube.config, cube.item !== null));
  Object.defineProperty(node, CUBE, { value: cube });

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
