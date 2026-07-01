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
 * Извлечь store и sourceProxy из аргумента useForm.
 * Поддерживает ProxyStore напрямую и tracking proxy поддеревья.
 */
function resolveInput<TConfig extends Record<string, any>>(
  input: ProxyStore<TConfig> | any,
): { store: ProxyStore<TConfig>; sourceProxy: any } {
  // Если это tracking proxy (поддерево переданное пропсом)
  const unwrapped = unwrapTrackingProxy<TConfig>(input);
  if (unwrapped) return unwrapped;

  // Сырой GroupProxyNode из store.proxy.someGroup — НЕ подходит.
  // Пользователь должен передавать либо ProxyStore (new Palistor()),
  // либо tracking proxy (из пропса родительского useForm).
  if (input != null && typeof input === "object" && (input as any)[CONFIG_NODE]) {
    throw new Error(
      "useForm: получен сырой proxy-узел стора (store.proxy.someGroup). " +
      "Это не допустимо.\n\n" +
      "Правильный способ:\n" +
      "  1. Получите tracking proxy через useForm(store):\n" +
      "       const form = useForm(store);\n" +
      "  2. Передайте поддерево как проп дочернему компоненту:\n" +
      "       <Child section={form.someGroup} />\n" +
      "  3. В дочернем компоненте вызовите useForm(props.section).\n\n" +
      "Нельзя передавать store.proxy или его дочерние узлы напрямую в useForm.",
    );
  }

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
/**
 * Тип-«ошибка», который TypeScript показывает в диагностике, если в
 * `useForm` передали сырой `store.proxy` или его поддерево. Имя интерфейса
 * специально длинное и описательное — оно появится в тексте ошибки и
 * подскажет, что делать.
 *
 * @see {@link RawStoreProxyMarker}
 */
export interface _PALISTOR_ERROR__do_not_pass_store_proxy_subtree_to_useForm__call_useForm_store_first {
  readonly _palistorError:
    "useForm received a raw store.proxy subtree. Use: const form = useForm(store); then drill into form.subtree (a tracking proxy). See useForm-raw-proxy-pitfall.md.";
}

/**
 * Превращает T в тип-ошибку, если T помечен {@link RawStoreProxyMarker}.
 * Применяется к параметру subtree-перегрузки `useForm`, чтобы сделать
 * `useForm(store.proxy.subtree)` ошибкой компиляции.
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

    // Привязываем entity к template — регистрируем, что этот шаблон сейчас отображает данную entity
    meta.entityStore.entityRegistry.bind(meta.entityId, meta.templateNode);

    // Запускаем resolve на уровне template, если он ещё не выполнялся для этой entity+template пары
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
      // При размонтировании отвязываем entity от template — шаблон больше не отображает эту entity
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

