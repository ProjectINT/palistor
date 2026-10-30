// The one place where a Proxy pays off: the component render boundary. The
// tracking proxy records which nodes this component read state from (node
// level, like store's createTrackingProxy); getSnapshot compares those nodes'
// state versions. The rest of the system is getters and memos.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { CUBE, STATE_KEYS, cubeOf, type Cube, type Hub, type PublicNode } from "../core";
import { Palistor } from "../palistor";

const SOURCE = Symbol("palistor.trackingSource");
const HUB = Symbol("palistor.trackingHub");

interface Refs {
  /** Nodes this component read state from during the current render. */
  accessed: Set<Cube>;
  /**
   * The previous render's reads. getSnapshot runs before a render's own reads
   * exist, so the last render's set still answers; a node read two renders ago
   * drops out. (store's set only grew: a list rendering 100 new rows per
   * update kept every row it had ever shown.)
   */
  prev: Set<Cube>;
  /** Each node's state version when it was added or last seen changed. */
  seen: Map<Cube, number>;
  /** Drilled into children without reading state (passes subtrees down as props). */
  navigated: boolean;
}

/** A render begins: the current reads become the previous generation. */
function beginRender(refs: Refs) {
  if (refs.accessed.size === 0) return; // nothing read since the last swap: keep the older generation
  for (const c of refs.prev) if (!refs.accessed.has(c)) refs.seen.delete(c);
  refs.prev = refs.accessed;
  refs.accessed = new Set();
}

/** The public node behind a tracking proxy, or the object itself. */
const unwrap = (v: unknown): PublicNode | null =>
  v !== null && typeof v === "object" ? ((v as Record<symbol, unknown>)[SOURCE] as PublicNode | undefined) ?? (v as PublicNode) : null;

function resolveInput(input: unknown): { hub: Hub; source: PublicNode } {
  if (input instanceof Palistor) return { hub: input.hub, source: input.proxy };
  const tracked = input as Record<symbol, unknown> | null;
  if (tracked && typeof tracked === "object" && tracked[SOURCE]) {
    return { hub: tracked[HUB] as Hub, source: tracked[SOURCE] as PublicNode };
  }
  if (tracked && typeof tracked === "object" && tracked[CUBE]) {
    throw new Error(
      "useForm: received a raw store proxy node (store.proxy.someGroup). This is not allowed.\n\n" +
      "The correct way:\n" +
      "  1. Get a tracking proxy via useForm(store):\n" +
      "       const form = useForm(store);\n" +
      "  2. Pass the subtree as a prop to the child component:\n" +
      "       <Child section={form.someGroup} />\n" +
      "  3. In the child component call useForm(props.section).\n\n" +
      "Never pass store.proxy or its child nodes directly into useForm.",
    );
  }
  throw new Error("useForm: expected a Palistor store or a subtree from another useForm.");
}

/**
 * useForm(entity, templateSelector): the entity (an item from list.items /
 * getById, raw or tracked) shown through a template group of the config. One
 * view cube per (entity, template), so remounts reuse it.
 */
function resolveEntity(input: unknown, selector: (proxy: unknown) => unknown): { hub: Hub; source: PublicNode } {
  const entity = cubeOf(unwrap(input));
  if (!entity || entity.entityId === undefined) {
    throw new Error(
      "useForm: first argument must be an entity proxy (from list.items or list.getById) " +
      "when templateSelector is provided.",
    );
  }
  const hub = entity.hub;
  const template = cubeOf(unwrap(selector((hub.store as Palistor).proxy)));
  if (!template || template.kind !== "group") throw new Error("useForm: templateSelector must return a group proxy node.");
  if (!hub.registry.has(entity.entityId)) throw new Error(`useForm: entity "${entity.entityId}" not found in registry.`);
  return { hub, source: hub.entityView(entity.entityId, template.config).node };
}

function track(refs: Refs, cube: Cube) {
  if (refs.accessed.has(cube)) return;
  refs.accessed.add(cube);
  if (!refs.prev.has(cube)) refs.seen.set(cube, cube.stateVersion());
}

function wrap(source: PublicNode, refs: Refs, hub: Hub, cache: WeakMap<object, object>): any {
  const hit = cache.get(source);
  if (hit) return hit;
  const cube = source[CUBE] as Cube;
  const proxy = new Proxy(source, {
    get(target, key) {
      if (key === SOURCE) return target;
      if (key === HUB) return hub;
      if (typeof key === "symbol") return Reflect.get(target, key);
      if (STATE_KEYS.has(key)) track(refs, cube);
      // An entity's id moves on store.rekey: follow the row's id leaf when the template has one
      // (a leaf's state is cheap to compare), the entity cube itself otherwise.
      else if (key === "id" && cube.entityId !== undefined) track(refs, cube.children.get("id") ?? cube);
      const result = Reflect.get(target, key);
      if (key === "items" && Array.isArray(result)) return wrapItems(result, refs, hub, cache);
      if (key === "map" && typeof result === "function") {
        return (fn: (item: unknown, i: number, id: string) => unknown) =>
          result((item: PublicNode, i: number, id: string) => fn(wrap(item, refs, hub, cache), i, id));
      }
      if (result !== null && typeof result === "object" && (result as PublicNode)[CUBE]) {
        refs.navigated = true;
        return wrap(result as PublicNode, refs, hub, cache);
      }
      return result;
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  });
  cache.set(source, proxy);
  return proxy;
}

/**
 * `list.items` through the boundary: the same array, each item wrapped when it
 * is reached. A component that renders a window (`items.slice(0, 100)`) pays
 * for its window, not for the thousand rows behind it.
 */
function wrapItems(items: PublicNode[], refs: Refs, hub: Hub, cache: WeakMap<object, object>): PublicNode[] {
  const hit = cache.get(items);
  if (hit) return hit as PublicNode[];
  const proxy = new Proxy(items, {
    get(target, key) {
      const v = Reflect.get(target, key);
      return typeof key === "string" && v !== null && typeof v === "object" && (v as PublicNode)[CUBE]
        ? wrap(v as PublicNode, refs, hub, cache)
        : v;
    },
  });
  cache.set(items, proxy);
  return proxy;
}

/**
 * Connects a component to a store: useForm(store), useForm(subtree) with a
 * subtree from another useForm (an independent tracking scope), or
 * useForm(entity, templateSelector) to edit a list item through a template
 * (bound on mount, unbound on unmount; the template resolve runs once per
 * entity and template). Re-renders only when the state of a node it read changes.
 */
export function useForm(input: unknown, templateSelector?: unknown): any {
  const entityMode = typeof templateSelector === "function";

  // Entity mode resolves once per component, as store did: the selector is usually an inline arrow.
  const entityRef = useRef<{ hub: Hub; source: PublicNode } | null>(null);
  if (entityMode && !entityRef.current) entityRef.current = resolveEntity(input, templateSelector as (p: unknown) => unknown);

  const std = useMemo(() => (entityMode ? null : resolveInput(input)), [input, entityMode]);
  const { hub, source } = entityMode ? entityRef.current! : std!;

  const refs = useRef<Refs | null>(null);
  if (!refs.current) refs.current = { accessed: new Set(), prev: new Set(), seen: new Map(), navigated: false };
  beginRender(refs.current);
  const cache = useRef<WeakMap<object, object> | null>(null);
  if (!cache.current) cache.current = new WeakMap();
  const snapshot = useRef(hub.cycle);

  const proxy = useMemo(() => wrap(source, refs.current!, hub, cache.current!), [source, hub]);

  // Entity mode lifecycle: bind the template on mount, run its resolve once, unbind on unmount.
  useEffect(() => {
    if (!entityMode) return;
    const view = source[CUBE] as Cube;
    const template = view.config;
    hub.registry.bind(view.entityId!, template);
    if (!hub.registry.isResolved(view.entityId!, template)) view.resolveTemplate();
    return () => { if (view.entityId !== undefined) hub.registry.unbind(view.entityId, template); };
  }, [entityMode, hub, source]);

  const subscribe = useCallback((cb: () => void) => hub.subscribe(cb), [hub]);
  const getSnapshot = useCallback(() => {
    const { accessed, prev, seen, navigated } = refs.current!;
    // Read nothing yet: a component that only drills into subtrees is stable,
    // one that touched nothing at all (renderHook) follows every change.
    if (accessed.size === 0 && prev.size === 0) return navigated ? snapshot.current : hub.cycle;
    let changed = false;
    const check = (c: Cube) => {
      const v = c.stateVersion();
      if (v !== seen.get(c)) { seen.set(c, v); changed = true; }
    };
    for (const c of accessed) check(c);
    for (const c of prev) if (!accessed.has(c)) check(c);
    if (changed) snapshot.current = hub.cycle;
    return snapshot.current;
  }, [hub]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return proxy;
}
