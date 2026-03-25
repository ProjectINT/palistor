/**
 * useForm — React хук для подключения к ProxyStore
 *
 * Возвращает реактивный прокси. Доступ к полям через точку — это и есть
 * подписка: компонент перерендерится только при изменении прочитанных полей.
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
 * // Дочерний компонент с useForm для независимой подписки:
 * function PassportSection({ passport }) {
 *   const p = useForm(passport); // ← принимает поддерево!
 *   if (!p.isVisible) return null;
 *   return <NumberField field={p.number} />;
 * }
 * ```
 *
 * Как работает:
 *   1. useSyncExternalStore подписывается на глобальные изменения store.
 *   2. getSnapshot сравнивает версии только прочитанных узлов →
 *      re-render происходит только если изменилось то, что читалось.
 *   3. store.proxy оборачивается в tracking proxy. Каждый GET записывает
 *      config-ноду в tracked set. getSnapshot проверяет только эти ноды.
 *   4. Запись `form.email.value = "X"` → store.proxy.email.value = "X" →
 *      SET trap → formatter → validate → recompute → notify → re-render
 *      (только компонентов, которые читали изменившиеся ноды).
 *
 * Перегрузки:
 *   - useForm(store)        — основной вариант, передаём ProxyStore
 *   - useForm(proxySubtree) — принимает tracking proxy поддерево (из пропса),
 *     создаёт **независимый** tracking для этого компонента
 *   - useForm(entityProxy, templateSelector) — привязка entity к template.
 *     entityProxy из list.items/list.getById. templateSelector = (s) => s.editForm.
 *     Вызывает entityRegistry.bind на mount, unbind на unmount.
 */

import { useSyncExternalStore, useCallback, useRef, useMemo, useEffect } from "react";
import type { ProxyStore, ConfigProxy } from "../store/store";
import {
  createTrackingProxy,
  unwrapTrackingProxy,
  type TrackingRefs,
} from "./createTrackingProxy";
import { ENTITY_ID, STORE_REF, CONFIG_NODE } from "../store/constants";
import { buildEntityProjectionProxy } from "../store/buildProxy/buildEntityProjectionProxy";
import type { Palistor } from "../store/store/palistor";
import type { AnyConfigNode } from "../store/store/types";

/**
 * Извлечь store и sourceProxy из аргумента useForm.
 * Поддерживает ProxyStore напрямую и tracking proxy поддеревья.
 */
function resolveInput<TConfig extends Record<string, any>>(
  input: ProxyStore<TConfig> | any,
): { store: ProxyStore<TConfig>; sourceProxy: any } {
  // Если это tracking proxy (поддерево переданное пропсом)
  const unwrapped = unwrapTrackingProxy<TConfig>(input);
  if (unwrapped) return unwrapped;

  // Иначе это ProxyStore — берём store.proxy как sourceProxy
  return { store: input, sourceProxy: input.proxy };
}

/**
 * Подключает React-компонент к ProxyStore.
 *
 * Компонент перерендерится только при изменении полей, которые он читал
 * во время предыдущего рендера. Tracking proxy автоматически записывает
 * обращения к FIELD_STATE_PROPS (value, label, isVisible, error…) и
 * getSnapshot проверяет версии только этих нод.
 *
 * На первом рендере tracked set пуст → используется глобальная версия
 * (fallback). После первого рендера tracking работает точечно.
 *
 * @param input — ProxyStore, созданный через new Palistor(), ИЛИ
 *                tracking proxy поддерево (из пропса другого useForm)
 * @returns tracking proxy — типизированный по конфигу (или поддереву)
 */
export function useForm<TConfig extends Record<string, any>>(
  input: ProxyStore<TConfig> | ConfigProxy<TConfig>,
): ConfigProxy<TConfig>;

/**
 * Перегрузка: привязка entity к template для отображения/редактирования.
 *
 * @param entity           — EntityProjectionProxy из list.items или list.getById
 * @param templateSelector — функция выбора template: (store) => store.editUserForm
 * @returns tracking proxy entity через template (поля template + значения entity)
 *
 * Lifecycle:
 *   - mount: entityRegistry.bind(entityId, templateNode)
 *   - unmount: entityRegistry.unbind(entityId, templateNode)
 *
 * Resolved cache (3A.4): при повторном открытии той же entity+template
 * `isResolved` возвращает true → resolve будет пропущен (Phase 3B).
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
    entityStore: Palistor<any>;
    templateNode: AnyConfigNode;
    entityProxy: object;
  }

  const entityMetaRef = useRef<EntityMeta | null>(null);

  if (isEntityMode && !entityMetaRef.current) {
    const entityId = (input as any)[ENTITY_ID] as string | undefined;
    const entityStore = (input as any)[STORE_REF] as Palistor<any> | undefined;

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

  // ─── Tracking state (per-component, стабильные ref-ы) ────────────────────

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

    // 3A.3: bind entity to template on mount
    meta.entityStore.entityRegistry.bind(meta.entityId, meta.templateNode);

    // 3B.1: trigger resolve if not already resolved
    if (!meta.entityStore.entityRegistry.isResolved(meta.entityId, meta.templateNode)) {
      meta.entityStore.triggerEntityTemplateResolve(
        meta.entityId,
        meta.templateNode,
        meta.entityProxy,
      );
    }

    return () => {
      // 3A.3: unbind entity from template on unmount
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

