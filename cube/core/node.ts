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

function accessors(reads: Record<string, Read>): PropertyDescriptorMap {
  const out: PropertyDescriptorMap = {};
  for (const k in reads) {
    const read = reads[k];
    out[k] = { configurable: true, get(this: PublicNode) { return read(this[CUBE]); } };
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
 * A list item's node. There can be thousands per read of `items`, and each own
 * accessor costs ~100 ns to create, so the group surface sits on a prototype
 * (one per template) and the instance owns only `id`: `item.id` is the entity
 * id string, as in store. {...item} therefore spreads `{ id }` only.
 * TODO(Phase 2.1): store's entity projection spread keys.
 */
const ITEM_SURFACE = accessors({
  submitting: (c) => c.submitting,
  dirty: (c) => c.dirty,
  revalidate: (c) => c.revalidate,
  loading: (c) => c.loading,
  values: (c) => c.values,
  submit,
  reset,
});
ITEM_SURFACE.value = {
  configurable: true,
  get(this: PublicNode) { const c: Cube = this[CUBE]; c.touch(); return c.value; },
  set(this: PublicNode, v: unknown) { this[CUBE].write(v); },
};

type ItemCtor = new (c: Cube) => PublicNode;
const itemCtors = new WeakMap<CubeConfig, ItemCtor>();

function itemCtor(template: CubeConfig): ItemCtor {
  let ctor = itemCtors.get(template);
  if (ctor) return ctor;
  const proto = Object.create(groupProto(template), ITEM_SURFACE);
  const Item = function (this: PublicNode, c: Cube) {
    Object.defineProperty(this, CUBE, { value: c });
    // Own data property: shadows a template child named `id` (the row's id leaf) on the prototype.
    Object.defineProperty(this, "id", { enumerable: true, configurable: true, value: c.entityId });
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

/** Keys whose read is node state (useForm tracks the node on them). */
export const STATE_KEYS: ReadonlySet<string> = new Set([
  "value", "label", "placeholder", "description", "isRequired", "isReadOnly", "isDisabled", "isVisible",
  "isInvalid", "errorMessage", "dirty", "loading", "submitting", "revalidate",
  "items", "length", "map", "error", "resolveStatus",
]);

const LIST_PROTO = Object.prototype;
const LEAF_PROTO = Object.create(Object.prototype, LEAF_HIDDEN);
const groupProtos = new WeakMap<CubeConfig, object>();

/** One prototype per group config: the hidden names plus a getter per child. */
function groupProto(config: CubeConfig): object {
  const hit = groupProtos.get(config);
  if (hit) return hit;
  const desc: PropertyDescriptorMap = { ...GROUP_HIDDEN };
  for (const k of childKeys(config)) {
    desc[k] = {
      configurable: true,
      get(this: PublicNode) {
        const c: Cube = this[CUBE];
        c.touch();
        return c.children.get(k)!.node;
      },
    };
  }
  const proto = Object.create(Object.prototype, desc);
  groupProtos.set(config, proto);
  return proto;
}

export function makeNode(cube: Cube): PublicNode {
  if (cube.entityId !== undefined) return new (itemCtor(cube.config))(cube);
  const node =
    cube.kind === "list" ? listNode(cube as ListCube, LIST_PROTO)
    : cube.kind === "leaf" ? leafNode(cube, LEAF_PROTO)
    : groupNode(cube, groupProto(cube.config));
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

/** Construction-time check: a group child must not take a name of the group node. */
export function assertChildName(key: string, path: string) {
  if (!RESERVED_CHILD_NAMES.has(key)) return;
  throw new Error(
    `[palistor/cube] "${path}": a child cannot be named "${key}", the group node uses that name ` +
    `(reserved: ${[...RESERVED_CHILD_NAMES].join(", ")}).`,
  );
}

export const cubeOf = (node: unknown): Cube | undefined =>
  node !== null && typeof node === "object" ? (node as PublicNode)[CUBE] : undefined;
