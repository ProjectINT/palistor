// The one place where a Proxy pays off: the component render boundary. The
// tracking proxy records which nodes this component read state from (node
// level, like store's createTrackingProxy); getSnapshot compares those nodes'
// state versions. The rest of the system is getters and memos.

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { CUBE, STATE_KEYS, type Cube, type Hub, type PublicNode } from "../core";
import { notImplemented } from "../notImplemented";
import { Palistor } from "../palistor";

const SOURCE = Symbol("palistor.trackingSource");
const HUB = Symbol("palistor.trackingHub");

interface Refs {
  /** Nodes this component read state from. Only grows. */
  accessed: Set<Cube>;
  /** Each node's state version when it was added or last seen changed. */
  seen: Map<Cube, number>;
  /** Drilled into children without reading state (passes subtrees down as props). */
  navigated: boolean;
}

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

function track(refs: Refs, cube: Cube) {
  if (refs.accessed.has(cube)) return;
  refs.accessed.add(cube);
  refs.seen.set(cube, cube.stateVersion());
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
 * Connects a component to a store: useForm(store), or useForm(subtree) with a
 * subtree from another useForm (an independent tracking scope). Re-renders
 * only when the state of a node it read changes.
 */
export function useForm(input: unknown, templateSelector?: unknown): any {
  if (templateSelector !== undefined) notImplemented("useForm(entity, templateSelector)");
  const { hub, source } = useMemo(() => resolveInput(input), [input]);

  const refs = useRef<Refs | null>(null);
  if (!refs.current) refs.current = { accessed: new Set(), seen: new Map(), navigated: false };
  const cache = useRef<WeakMap<object, object> | null>(null);
  if (!cache.current) cache.current = new WeakMap();
  const snapshot = useRef(hub.cycle);

  const proxy = useMemo(() => wrap(source, refs.current!, hub, cache.current!), [source, hub]);

  const subscribe = useCallback((cb: () => void) => hub.subscribe(cb), [hub]);
  const getSnapshot = useCallback(() => {
    const { accessed, seen, navigated } = refs.current!;
    // Read nothing yet: a component that only drills into subtrees is stable,
    // one that touched nothing at all (renderHook) follows every change.
    if (accessed.size === 0) return navigated ? snapshot.current : hub.cycle;
    let changed = false;
    for (const c of accessed) {
      const v = c.stateVersion();
      if (v !== seen.get(c)) { seen.set(c, v); changed = true; }
    }
    if (changed) snapshot.current = hub.cycle;
    return snapshot.current;
  }, [hub]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return proxy;
}
