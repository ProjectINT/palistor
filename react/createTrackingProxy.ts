/**
 * createTrackingProxy — wraps store.proxy in a second Proxy layer that
 * records which config nodes a component has read.
 *
 * Every `useForm` call creates its own tracking proxy → its own tracked set.
 * This lets `getSnapshot` check the versions of only the nodes that were
 * read, avoiding re-renders when fields the component never reads change.
 *
 * Tracking is node-level: reading ANY property (value, label, isVisible…)
 * adds the whole node to the tracked set.
 *
 * Lists: `items`, `map`, `length`, `loading`, `dirty`, `error`, `resolveStatus`
 * on a list proxy add the `ListState` object (the LIST_STATE brand, shared by
 * root and per-entity) to the tracked set. A mutation/resolve bumps that
 * ListState's version → getSnapshot detects the change → only the list
 * re-renders. `map` → entity proxies are wrapped in tracking proxies for
 * per-leaf row tracking.
 */

import { FIELD_STATE_PROPS, CONFIG_NODE, SOURCE_PROXY, STORE_REF, ENTITY_ID_LEAF, FILTER_STATE, LIST_STATE, FLOW_STATE } from "../store/constants";
import type { ProxyStore } from "../store/store";
import type { FilterState } from "../store/filtering/types";

/**
 * Flow-/step-proxy keys that are reactive through the FlowState object's
 * version (navigation bumps it). The FLOW_STATE brand check runs only when
 * the key matches — zero overhead for non-flow nodes on other keys.
 */
const FLOW_TRACKED_KEYS = new Set<string>([
  "currentStepKey",
  "currentStepIndex",
  "canGoBack",
  "history",
  "errors",
  "status",
  "steps",
  "current",
  "loading",
]);

export interface TrackingRefs {
  /** Set of config nodes the component has read. Only grows (accumulates). */
  accessed: Set<object>;
  /** Each node's version at first tracking — prevents spurious re-renders
   *  right after a node is added to the tracked set. */
  lastVersions: Map<object, number>;
  /**
   * The component accessed child keys (form.email, form.passport) without
   * reading FIELD_STATE_PROPS. Distinguishes:
   * - "navigation without reads" (Parent passes a subtree as a prop) → stable snapshot
   * - "touched nothing" (renderHook without JSX) → fallback to the global version
   */
  hasNavigated: boolean;
}

/**
 * Check whether an object is a tracking proxy (carries the SOURCE_PROXY symbol).
 */
export function isTrackingProxy(obj: unknown): boolean {
  return !!obj && typeof obj === "object" && !!(obj as any)[SOURCE_PROXY];
}

/**
 * Extract the source proxy and store from a tracking proxy.
 * Returns null when the object is not a tracking proxy.
 */
export function unwrapTrackingProxy<TConfig extends Record<string, any>>(
  obj: unknown,
): { sourceProxy: any; store: ProxyStore<TConfig> } | null {
  if (!isTrackingProxy(obj)) return null;
  return {
    sourceProxy: (obj as any)[SOURCE_PROXY],
    store: (obj as any)[STORE_REF],
  };
}

/**
 * Create a tracking proxy on top of a source proxy.
 * Cached by source-proxy object (one tracking proxy per nested node).
 *
 * @param sourceProxy — the base Proxy from store.proxy (or its child node)
 * @param refs        — per-component tracking state (accessed, lastVersions)
 * @param store       — the ProxyStore, for reading current node versions
 * @param cache       — WeakMap caching tracking proxy objects
 */
export function createTrackingProxy<TConfig extends Record<string, any>>(
  sourceProxy: any,
  refs: TrackingRefs,
  store: ProxyStore<TConfig>,
  cache: WeakMap<object, object>,
): any {
  if (cache.has(sourceProxy)) return cache.get(sourceProxy);

  const tracked = new Proxy(sourceProxy as Record<string | symbol, unknown>, {
    get(target, key: string | symbol) {
      // CONFIG_NODE — forwarded; the tracking proxy is transparent to this symbol
      if (key === CONFIG_NODE) return (target as any)[CONFIG_NODE];

      // SOURCE_PROXY — return the underlying store proxy (the tracking proxy's target)
      if (key === SOURCE_PROXY) return target;

      // STORE_REF — return the ProxyStore reference
      if (key === STORE_REF) return store;

      // Other symbols are forwarded as-is
      if (typeof key === "symbol") return (target as any)[key];

      // Reverse mapping on input: external → internal. State checks (list
      // keys, FIELD_STATE_PROPS) use `ikey`; reads and navigation use the
      // original external `key` (the source proxy translates it back).
      const ikey = (store.externalToInternal[key as string] ?? key) as string;

      // ── List proxy (single building block: root + per-entity) ──────────────
      // The tracking key is the ListState object, NOT the shared listConfigNode:
      // otherwise the versions of different owners of one per-entity list would
      // collapse, and root vs entity would need two branches. Must run BEFORE
      // FIELD_STATE_PROPS: `loading`/`dirty` belong to FIELD_STATE_PROPS, but on
      // a list they must be tracked by ListState, not CONFIG_NODE.
      const listState = (target as any)[LIST_STATE] as object | undefined;
      if (listState) {
        const trackNode = (node: object): void => {
          if (!refs.accessed.has(node)) {
            refs.accessed.add(node);
            refs.lastVersions.set(node, store.getNodeVersion(node));
          }
        };
        // A VISIBLE read is a function of the ListState AND the client filter
        // fields: a component rendering `list.values` must re-render on a
        // keystroke in a `where` field without ever reading the filter.
        // (Server fields reach the visible set through resolve → ListState.)
        const trackClientFilterFields = (): void => {
          const fState = (target as any)[FILTER_STATE] as FilterState | undefined;
          if (!fState || !fState.hasClientFields) return;
          for (const rt of fState.fields.values()) {
            if (rt.isClient) trackNode(rt.node as object);
          }
        };
        // `error`/`resolveStatus` (and the filter surface `values`/`fullLength`/
        // `filter`) are matched on the RAW key (LIST_ONLY_KEYS in
        // store/constants.ts): they are not mappable, and a fieldMapping of
        // `isInvalid → "error"` would rewrite them into `isInvalid` here and
        // skip the tracking registration.
        if (
          ikey === "loading" ||
          ikey === "dirty" ||
          key === "error" ||
          key === "resolveStatus" ||
          key === "fullLength"
        ) {
          trackNode(listState);
          return (target as any)[key];
        }
        if (ikey === "length") {
          trackNode(listState);
          trackClientFilterFields();
          return (target as any)[key];
        }
        if (ikey === "items" || (key === "values" && (target as any)[FILTER_STATE])) {
          trackNode(listState);
          trackClientFilterFields();
          const rawItems = (target as any)[key] as object[];
          return rawItems.map((item: object) =>
            createTrackingProxy(item, refs, store, cache),
          );
        }
        if (ikey === "map") {
          trackNode(listState);
          trackClientFilterFields();
          const origMap = (target as any)[key] as (
            fn: (item: object, index: number, id: string) => unknown,
          ) => unknown[];
          return (fn: (item: any, index: number, id: string) => unknown) =>
            origMap((item: object, index: number, id: string) =>
              fn(createTrackingProxy(item, refs, store, cache), index, id),
            );
        }
        if (key === "filter") {
          // Navigation into the filter controls — wrap so field/aggregate
          // reads on it register their own subscriptions.
          const result = (target as any)[key];
          if (result && typeof result === "object") {
            refs.hasNavigated = true;
            return createTrackingProxy(result, refs, store, cache);
          }
          return result;
        }
        // add/remove/setItems/getById/reload — forwarded without tracking
        // (calling them does not read reactive state).
        return (target as any)[key];
      }

      // ── Filter proxy (list.filter) ─────────────────────────────────────────
      // Carries FILTER_STATE without LIST_STATE. Aggregates subscribe by what
      // they derive from: isActive/activeCount/values read the field VALUES
      // (leaf versions bump on writes); isPending reads the debounce timer
      // (the gate bumps the owning ListState's version on arm/clear).
      const filterOnly = (target as any)[FILTER_STATE] as FilterState | undefined;
      if (filterOnly && !(target as any)[LIST_STATE]) {
        const trackNode = (node: object): void => {
          if (!refs.accessed.has(node)) {
            refs.accessed.add(node);
            refs.lastVersions.set(node, store.getNodeVersion(node));
          }
        };
        if (key === "isActive" || key === "activeCount" || key === "values") {
          for (const rt of filterOnly.fields.values()) trackNode(rt.node as object);
          return (target as any)[key];
        }
        if (key === "isPending") {
          trackNode(filterOnly.listState as unknown as object);
          return (target as any)[key];
        }
        // Fields fall through to the generic navigation below (their proxies
        // are wrapped, so .value reads register the leaf subscription);
        // set/reset/clear are methods and stay untracked.
      }

      // ── Flow proxy / step proxy (defineFlow) ────────────────────────────────
      // Navigation state is tracked by the FlowState object (the FLOW_STATE brand
      // is exposed by the flow node, the steps proxy and step nodes). Runs BEFORE
      // FIELD_STATE_PROPS: `loading` belongs there, but on a flow it is composite
      // (any step loading) and needs subscriptions to the step nodes, not just
      // the flow's CONFIG_NODE.
      if (FLOW_TRACKED_KEYS.has(ikey)) {
        const flowState = (target as any)[FLOW_STATE] as
          | { stepNodes?: object[] }
          | undefined;
        if (flowState) {
          // "steps" is pure navigation to the collection (re-read on every
          // re-render); the access itself doesn't depend on the current step — untracked.
          if (ikey !== "steps" && !refs.accessed.has(flowState)) {
            refs.accessed.add(flowState);
            refs.lastVersions.set(flowState, store.getNodeVersion(flowState));
          }
          // Composite loading: a step's resolve bumps the step node's version.
          if (ikey === "loading" && Array.isArray(flowState.stepNodes)) {
            for (const stepNode of flowState.stepNodes) {
              if (!refs.accessed.has(stepNode)) {
                refs.accessed.add(stepNode);
                refs.lastVersions.set(stepNode, store.getNodeVersion(stepNode));
              }
            }
          }
          const result = (target as any)[key];
          // Objects (the steps proxy, step proxies, and any child nodes that
          // happen to match by name) — wrapped recursively, like regular navigation.
          if (result && typeof result === "object") {
            refs.hasNavigated = true;
            return createTrackingProxy(result, refs, store, cache);
          }
          return result;
        }
      }

      // Field-state read → track the node.
      // submitting is a reactive group flag and needs tracking too.
      if (FIELD_STATE_PROPS.has(ikey) || ikey === "submitting") {
        const configNode = (target as any)[CONFIG_NODE] as object | undefined;
        if (configNode && !refs.accessed.has(configNode)) {
          refs.accessed.add(configNode);
          // Save the current version so getSnapshot doesn't treat it as a change
          refs.lastVersions.set(configNode, store.getNodeVersion(configNode));
        }
        return (target as any)[key];
      }

      // Child object → recursive tracking proxy
      const result = (target as any)[key];

      // Entity id access: the entity proxy returns the id string directly (not via a
      // leaf proxy), so we would normally miss tracking it. Detect by checking if the
      // entity proxy exposes ENTITY_ID_LEAF and register that leaf for subscriptions.
      // This ensures rekey() → idLeaf version bump → getSnapshot detects change → re-render.
      if (key === "id") {
        const idLeaf = (target as any)[ENTITY_ID_LEAF] as object | undefined;
        if (idLeaf && !refs.accessed.has(idLeaf)) {
          refs.accessed.add(idLeaf);
          refs.lastVersions.set(idLeaf, store.getNodeVersion(idLeaf));
        }
      }

      if (result && typeof result === "object") {
        refs.hasNavigated = true;
        return createTrackingProxy(result, refs, store, cache);
      }

      return result;
    },

    set(target, key: string | symbol, value: unknown) {
      // Writes are forwarded to the source proxy (the SET trap in buildProxy)
      return Reflect.set(target, key, value);
    },

    /**
     * Forward ownKeys from the source proxy so spread ({...trackingProxy})
     * returns the same keys as the store proxy (no validate, formatter, …).
     */
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },

    getOwnPropertyDescriptor(target, key: string | symbol) {
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  cache.set(sourceProxy, tracked);
  return tracked;
}
