/**
 * useForm — the React hook that connects a component to a ProxyStore.
 *
 * Returns a reactive proxy. Dot access to fields IS the subscription: the
 * component re-renders only when a field it actually read changes.
 *
 * @example
 * ```tsx
 * const store = new Palistor({ config });
 *
 * function App() {
 *   const form = useForm(store);
 *
 *   return (
 *     <div>
 *       <PassportSection passport={form.passport} />
 *       <input
 *         value={form.email.value}
 *         onChange={(e) => { form.email.value = e.target.value }}
 *       />
 *     </div>
 *   );
 * }
 *
 * // Child component with its own useForm for an independent subscription:
 * function PassportSection({ passport }) {
 *   const p = useForm(passport); // ← accepts a subtree!
 *   if (!p.isVisible) return null;
 *   return <NumberField field={p.number} />;
 * }
 * ```
 *
 * How it works:
 *   1. useSyncExternalStore subscribes to global store changes.
 *   2. getSnapshot compares versions of only the nodes that were read →
 *      a re-render happens only when something that was read changed.
 *   3. store.proxy is wrapped in a tracking proxy. Every GET records the
 *      config node into a tracked set. getSnapshot checks only those nodes.
 *   4. A write `form.email.value = "X"` → store.proxy.email.value = "X" →
 *      SET trap → formatter → validate → recompute → notify → re-render
 *      (only of components that read the changed nodes).
 *
 * Overloads:
 *   - useForm(store)        — the main form, pass the ProxyStore
 *   - useForm(proxySubtree) — accepts a tracking-proxy subtree (from a prop),
 *     creating an **independent** tracking scope for this component
 *   - useForm(entityProxy, templateSelector) — binds an entity to a template.
 *     entityProxy comes from list.items/list.getById. templateSelector = (s) => s.editForm.
 *     Calls entityRegistry.bind on mount, unbind on unmount.
 */

import { useSyncExternalStore, useCallback, useRef, useMemo, useEffect } from "react";
import type { ProxyStore, ConfigProxy, GroupProxyNode, RawStoreProxyMarker } from "../store/store";
import type { PalistorRef, PalistorList, Palistor, PalistorEntityProxy, FieldMapping } from "../store/store/types";
import {
  createTrackingProxy,
  unwrapTrackingProxy,
  type TrackingRefs,
} from "./createTrackingProxy";
import { ENTITY_ID, STORE_REF, CONFIG_NODE } from "../store/constants";
import { buildEntityProjectionProxy } from "../store/buildProxy/buildEntityProjectionProxy";
import type { Palistor as PalistorClass } from "../store/store/palistor";
import type { AnyConfigNode } from "../store/store/types";

/**
 * Extract the store and sourceProxy from the useForm argument.
 * Supports a ProxyStore directly and tracking-proxy subtrees.
 */
function resolveInput<TConfig extends Record<string, any>>(
  input: ProxyStore<TConfig> | any,
): { store: ProxyStore<TConfig>; sourceProxy: any } {
  // A tracking proxy (a subtree passed as a prop)
  const unwrapped = unwrapTrackingProxy<TConfig>(input);
  if (unwrapped) return unwrapped;

  // A raw GroupProxyNode from store.proxy.someGroup is NOT acceptable.
  // The user must pass either a ProxyStore (new Palistor()) or a tracking
  // proxy (from a parent useForm's prop).
  if (input != null && typeof input === "object" && (input as any)[CONFIG_NODE]) {
    throw new Error(
      "useForm: received a raw store proxy node (store.proxy.someGroup). " +
      "This is not allowed.\n\n" +
      "The correct way:\n" +
      "  1. Get a tracking proxy via useForm(store):\n" +
      "       const form = useForm(store);\n" +
      "  2. Pass the subtree as a prop to the child component:\n" +
      "       <Child section={form.someGroup} />\n" +
      "  3. In the child component call useForm(props.section).\n\n" +
      "Never pass store.proxy or its child nodes directly into useForm.",
    );
  }

  // Otherwise it's a ProxyStore — use store.proxy as the sourceProxy
  return { store: input, sourceProxy: input.proxy };
}

/**
 * Connects a React component to a ProxyStore.
 *
 * The component re-renders only when fields it read during the previous
 * render change. The tracking proxy automatically records accesses to
 * FIELD_STATE_PROPS (value, label, isVisible, error…) and getSnapshot
 * checks the versions of only those nodes.
 *
 * On the first render the tracked set is empty → the global version is used
 * (fallback). After the first render tracking is fully targeted.
 *
 * @param input — a ProxyStore created via new Palistor(), OR a tracking-proxy
 *                subtree (from another useForm's prop)
 * @returns a tracking proxy — typed by the config (or subtree)
 */
/**
 * An "error" type TypeScript surfaces in diagnostics when a raw `store.proxy`
 * or its subtree is passed into `useForm`. The interface name is deliberately
 * long and descriptive — it appears in the error text and explains the fix.
 *
 * @see {@link RawStoreProxyMarker}
 */
export interface _PALISTOR_ERROR__do_not_pass_store_proxy_subtree_to_useForm__call_useForm_store_first {
  readonly _palistorError:
    "useForm received a raw store.proxy subtree. Use: const form = useForm(store); then drill into form.subtree (a tracking proxy). See useForm-raw-proxy-pitfall.md.";
}

/**
 * Turns T into the error type when T carries {@link RawStoreProxyMarker}.
 * Applied to the subtree overload's parameter to make
 * `useForm(store.proxy.subtree)` a compile-time error.
 */
type ForbidRawStoreProxy<T> = T extends RawStoreProxyMarker
  ? _PALISTOR_ERROR__do_not_pass_store_proxy_subtree_to_useForm__call_useForm_store_first
  : T;

export function useForm<T extends Record<string, any>>(input: PalistorRef<T>): PalistorEntityProxy<T>;
export function useForm<T extends Record<string, any>>(input: PalistorList<T>): PalistorList<T>;
export function useForm<T extends Record<string, any> & { id?: any }>(
  input: Palistor<T>,
): PalistorEntityProxy<T>;
export function useForm<T extends GroupProxyNode>(
  input: ForbidRawStoreProxy<T>,
): T;

export function useForm<
  TConfig extends Record<string, any>,
  TMapping extends FieldMapping = {},
>(
  input: ProxyStore<TConfig, TMapping>,
): ConfigProxy<TConfig, TMapping>;

/**
 * Overload: bind an entity to a template for display/editing.
 *
 * @param entity           — an EntityProjectionProxy from list.items or list.getById
 * @param templateSelector — template selector function: (store) => store.editUserForm
 * @returns a tracking proxy of the entity through the template (template fields + entity values)
 *
 * Lifecycle:
 *   - mount: entityRegistry.bind(entityId, templateNode)
 *   - unmount: entityRegistry.unbind(entityId, templateNode)
 *
 * Resolved cache: when the same entity+template is opened again,
 * `isResolved` returns true → the resolve is skipped.
 */
export function useForm(
  entity: object,
  templateSelector: (store: any) => any,
): any;

export function useForm(
  input: any,
  templateSelector?: (store: any) => any,
): any {
  // ─── Detect entity mode ──────────────────────────────────────────────────

  const isEntityMode = typeof templateSelector === "function";

  // ─── Entity mode: build metadata once and store in a ref ─────────────────
  // Must happen before any hooks to ensure all hooks called unconditionally.

  interface EntityMeta {
    entityId: string;
    entityStore: PalistorClass<any>;
    templateNode: AnyConfigNode;
    entityProxy: object;
  }

  const entityMetaRef = useRef<EntityMeta | null>(null);

  if (isEntityMode && !entityMetaRef.current) {
    const entityId = (input as any)[ENTITY_ID] as string | undefined;
    const entityStore = (input as any)[STORE_REF] as PalistorClass<any> | undefined;

    if (!entityId || !entityStore) {
      throw new Error(
        "useForm: first argument must be an entity proxy (from list.items or list.getById) " +
        "when templateSelector is provided.",
      );
    }

    const templateProxy = templateSelector(entityStore.proxy);
    const templateNode = (templateProxy as any)[CONFIG_NODE] as AnyConfigNode;

    if (!templateNode) {
      throw new Error("useForm: templateSelector must return a group proxy node.");
    }

    const entityNode = entityStore.entityRegistry.get(entityId);
    if (!entityNode) {
      throw new Error(`useForm: entity "${entityId}" not found in registry.`);
    }

    const entityProxy = buildEntityProjectionProxy(
      entityNode,
      templateNode,
      entityStore,
      new WeakMap(),
    );

    entityMetaRef.current = { entityId, entityStore, templateNode, entityProxy };
  }

  // ─── Standard mode: resolve store + sourceProxy ──────────────────────────

  const { store: stdStore, sourceProxy: stdSourceProxy } = useMemo(
    () =>
      isEntityMode
        ? { store: null as any, sourceProxy: null as any }
        : resolveInput<any>(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, isEntityMode],
  );

  // ─── Unified store + sourceProxy ────────────────────────────────────────

  const store: ProxyStore<any> = isEntityMode
    ? entityMetaRef.current!.entityStore
    : stdStore;

  const sourceProxy: any = isEntityMode
    ? entityMetaRef.current!.entityProxy
    : stdSourceProxy;

  // ─── Tracking state (per-component, stable refs) ─────────────────────────

  const refsRef = useRef<TrackingRefs | null>(null);
  if (!refsRef.current) {
    refsRef.current = {
      accessed: new Set<object>(),
      lastVersions: new Map<object, number>(),
      hasNavigated: false,
    };
  }
  const refs = refsRef.current;

  const cacheRef = useRef<WeakMap<object, object> | null>(null);
  if (!cacheRef.current) cacheRef.current = new WeakMap();

  const snapshotRef = useRef(0);

  // ─── Tracking proxy ───────────────────────────────────────────────────────

  const trackingProxy = useMemo(
    () => createTrackingProxy(sourceProxy, refs, store, cacheRef.current!),
    [store, sourceProxy, refs],
  );

  // ─── Bind/unbind lifecycle (entity mode only) ────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isEntityMode) return;
    const meta = entityMetaRef.current;
    if (!meta) return;

    // Bind the entity to the template — register that this template is currently displaying it
    meta.entityStore.entityRegistry.bind(meta.entityId, meta.templateNode);

    // Run the template-level resolve unless it already ran for this entity+template pair
    if (!meta.entityStore.entityRegistry.isResolved(meta.entityId, meta.templateNode)) {
      meta.entityStore.resolveManager.triggerEntityTemplateResolve(
        meta.entityId,
        meta.templateNode,
        meta.entityProxy,
      );
    }

    // Per-field resolves are now triggered lazily from the entity leaf proxy GET trap
    // (on first access to .value or .loading) — no eager loop needed here.

    return () => {
      // On unmount unbind the entity from the template — it no longer displays this entity
      meta.entityStore.entityRegistry.unbind(meta.entityId, meta.templateNode);
    };
  }, []); // bind once on mount, unbind on unmount

  // ─── useSyncExternalStore ────────────────────────────────────────────────

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeGlobal(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(() => {
    const { accessed, lastVersions } = refs;

    if (accessed.size === 0) {
      return refs.hasNavigated ? snapshotRef.current : store.getVersion();
    }

    let changed = false;
    for (const node of accessed) {
      const currentVersion = store.getNodeVersion(node);
      if (currentVersion !== lastVersions.get(node)) {
        changed = true;
        break;
      }
    }

    if (changed) {
      snapshotRef.current = store.getVersion();
      for (const node of accessed) {
        lastVersions.set(node, store.getNodeVersion(node));
      }
    }

    return snapshotRef.current;
  }, [store, refs]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return trackingProxy;
}
