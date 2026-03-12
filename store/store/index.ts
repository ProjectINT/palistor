import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify } from "../compute/recompute";
import { type FieldState } from "../compute/index";
import { type AnyConfigNode } from "./types";
import { createBuildProxy } from "../buildProxy/buildProxy";
import { registerNodes, type GroupLeafMap } from "./registerNodes";
import { recomputeAll as _recomputeAll, recomputeTargeted as _recomputeTargeted } from "../compute/recompute";
import type { TranslateFn } from "./types";
import { createPersistManager } from "../persist/persistManager";
import { buildNodeMaps } from "./nodeMap";
import { executeReset, type ResetDeps } from "../resetPipeline/resetPipeline";
import { executeSubmit, type SubmitDeps } from "../submitPipeline/submitPipeline";
import { fireOnChange, type OnChangeDeps } from "../onChangePipeline/onChangePipeline";
import { formatPatch } from "../writePipeline/writePipeline";
import { initGroupSubmitting } from "../init/initGroupSubmitting";
import { NotificationHub } from "../init/createNotificationHub";
import { createResolveManager } from "../init/createResolveManager";
import { type NotifyFn } from "../resolvePipeline";
import { buildValuesCache } from "../valuesCache/valuesCache";
import { NodeRegistry } from "./nodeRegistry";
import { ServiceRegistry } from "./serviceRegistry";
import { DirtyTracker } from "./dirtyTracker";
import { GroupDepsMap } from "./groupDepsMap";

import type {
  ConfigProxy,
  DeepPartialValues,
  ExtractValues,
  ProxyStore,
  ProxyStoreOptions,
} from "./types";

export type { FieldState } from "../compute/index";
export type { Resolve, NotifyFn } from "../resolvePipeline";
export type { SubmitResult } from "../submitPipeline/submitPipeline";

// Re-export all public types from the dedicated types module
export type {
  Unsubscribe,
  MaybeComputed,
  DeepPartialValues,
  FieldTypeMeta,
  ConfigNode,
  FieldProxyNode,
  GroupProxyNode,
  ConfigProxy,
  ExtractValues,
  ProxyStoreOptions,
  ProxyStore,
} from "./types";

// ─── Фабрика ─────────────────────────────────────────────────────────────────

/**
 * Создать ProxyStore с вычисляемым состоянием.
 *
 * @example
 * const store = createProxyStore({
 *   config: {
 *     email: { value: "", label: "Email", isRequired: true, validate: v => !v ? "required" : undefined },
 *     passport: {
 *       isVisible: (v) => v.paymentType === "bank",
 *       number: { value: "", label: "Passport Number" },
 *     },
 *   },
 *   initialValues: { email: "user@example.com" },
 * });
 *
 * store.proxy.email.value            // → "user@example.com"
 * store.proxy.email.isRequired       // → true
 * store.proxy.email.isInvalid        // → undefined (потому что value не пустой)
 * store.proxy.email.value = ""       // → пересчёт → isInvalid = true
 * store.proxy.passport.isVisible     // → false (paymentType != "bank")
 */
export function createProxyStore<TConfig extends Record<string, any>>(
  options: ProxyStoreOptions<TConfig>,
): ProxyStore<TConfig> {
  const { config, initialValues = {} } = options;
  const rootConfig = config as AnyConfigNode;

  // ─── Сервисы (нужны до NodeRegistry, т.к. передаются в конструктор) ───────

  const services = new ServiceRegistry();
  const { translate, notify } = services;

  // ─── Хранилища ────────────────────────────────────────────────────────────

  // NodeRegistry объединяет nodeState, nodePaths, nodeParents,
  // leafNodes, groupLeafMap, proxyCache и выполняет всю инициализацию узлов.
  const registry = new NodeRegistry(rootConfig, initialValues as Record<string, unknown>, translate);

  // Деструктурируем для обратной совместимости с существующим кодом пайплайнов.
  const { nodeState, nodePaths, nodeParents, leafNodes, groupLeafMap, proxyCache } = registry;

  const dirty = new DirtyTracker();

  // ─── Инициализация ─────────────────────────────────────────────────────────

  // NodeRegistry уже выполнил registerNodes, initGroupSubmitting, buildNodeMaps
  // в своём конструкторе. Строим кэш значений — ПОСЛЕ registerNodes.
  const valuesCache = buildValuesCache(rootConfig, nodeState);

  // Карта зависимостей групп: self-зависимости + кросс-групповые, построенные при первом
  // recomputeAll через tracking proxy (см. getTrackingWrap).
  const groupDepsMap = new GroupDepsMap(rootConfig, nodePaths, nodeParents);
  const trackingWrap = groupDepsMap.getTrackingWrap();

  /**
   * Пересчитать состояние. Два режима:
   * - changedNodes передан → таргетированный пересчёт только затронутых групп
   * - changedNodes не передан → полный пересчёт всего дерева (init, reset, resolve)
   *
   * При первом вызове (init) пропускает значения через trackingWrap,
   * чтобы зафиксировать кросс-групповые зависимости в groupDeps.
   * После этого tracking больше не нужен, кэш прокси освобождается.
   */
  function recomputeAll(changedNodes?: Set<object>): Set<object> {
    if (changedNodes && changedNodes.size > 0) {
      return _recomputeTargeted(changedNodes, {
        rootConfig,
        groupLeafMap,
        nodeState,
        nodeParents,
        nodePaths,
        groupDeps: groupDepsMap.deps,
        valuesCache,
        translate,
      });
    }
    if (!groupDepsMap.isBuilt) {
      const result = _recomputeAll(rootConfig, groupLeafMap, nodeState, valuesCache, translate, trackingWrap);
      groupDepsMap.markBuilt(); // зависимости построены — освобождаем прокси
      return result;
    }
    return _recomputeAll(rootConfig, groupLeafMap, nodeState, valuesCache, translate);
  }

  // Init: первый полный пересчёт — строит карту зависимостей и вычисляет состояние
  recomputeAll();

  // Capture initial values for dirty tracking (after recompute to get computed values)
  dirty.capture(rootConfig, nodeState);

  // ─── Notification hub ──────────────────────────────────────────────────────

  const hub = new NotificationHub({ leafNodes, nodePaths });

  const { subscribe, subscribeGlobal } = hub;

  const notifyChanged = (changed: Set<object>) =>
    hub.notifyChanged(changed, { rootConfig, nodeState, initialValueMap: dirty.initialValueMap });

  // ─── Translator ─────────────────────────────────────────────────────────────

  function setTranslator(t: TranslateFn | null) {
    if (services.setTranslator(t)) hub.bumpLeafVersions();
  }

  // ─── Notifier ─────────────────────────────────────────────────────────────────────

  function setNotifier(fn: NotifyFn | null) {
    services.setNotifier(fn);
  }

  // ─── Resolve system ────────────────────────────────────────────────────────

  const resolveManager = createResolveManager({
    rootConfig,
    nodeState,
    recomputeAll,
    notifyChanged,
    notify,
    initialValueMap: dirty.initialValueMap,
    valuesCache,
  });

  const { triggerResolve, getResolveState } = resolveManager;

  // ─── Handlers (submit, reset, onChange) ──────────────────────────────────

  const resetDeps: ResetDeps = { nodeState, recomputeAll, notifyChanged, initialValueMap: dirty.initialValueMap, valuesCache };
  const resetNode = (node: AnyConfigNode, values?: Record<string, unknown>) => {
    executeReset(node, resetDeps, values);
  };

  const setValuesNode = (node: AnyConfigNode, patch: Record<string, unknown>): void => {
    // Фаза 1: форматируем патч — каждое листовое значение проходит через formatter узла.
    const formatted = formatPatch(node, patch, valuesCache.values);
    // Фаза 2: применяем уже отформатированный патч к nodeState.
    const changed = applyPatch(node, nodeState, formatted, new Set(), valuesCache);
    recomputeAndNotify(changed, recomputeAll, notifyChanged);
  };

  const submitDeps: SubmitDeps = {
    nodeState,
    recomputeAll,
    notifyChanged,
    resetNode,
    clearPersist: () => persistManager.clear(),
    valuesCache,
    nodePaths,
    rootConfig,
  };

  const submitNode = (node: AnyConfigNode) => executeSubmit(node, submitDeps);

  const onChangeDeps: OnChangeDeps = {
    rootConfig,
    nodeState,
    nodePaths,
    nodeParents,
    recomputeAll,
    notifyChanged,
    valuesCache,
  };
  const onFieldChange = (
    node: AnyConfigNode,
    newValue: unknown,
    previousValue: unknown,
  ) => {
    fireOnChange(node, newValue, previousValue, onChangeDeps);
  };

  // ─── Построение Proxy ──────────────────────────────────────────────────────
  const buildProxy = createBuildProxy({
    proxyCache,
    nodeState,
    rootConfig,
    recomputeAll,
    notifyChanged,
    translate,
    submitNode,
    resetNode,
    setValuesNode,
    onFieldChange,
    triggerResolve,
    getResolveState,
    valuesCache,
  });

  // ─── Persist ────────────────────────────────────────────────────────────────

  const getValues = () => structuredClone(valuesCache.values) as ExtractValues<TConfig>;

  const persistManager = createPersistManager({
    rootConfig,
    nodeState,
    recomputeAll,
    notifyChanged,
    getValues: getValues as () => Record<string, unknown>,
    subscribeGlobal,
  });

  // ─── Публичный API ─────────────────────────────────────────────────────────

  // ─── Wire resolve retrigger into notification hub ─────────────────────────
  const postNotifyHook = resolveManager.createPostNotifyHook();
  if (postNotifyHook) hub.setPostNotifyHook(postNotifyHook);

  // ─── Launch eager resolvers (lazy: false) ──────────────────────────────────
  resolveManager.launchEager();

  return {
    proxy: buildProxy(rootConfig) as ConfigProxy<TConfig>,
    subscribe,
    subscribeGlobal,
    getVersion: hub.getVersion,
    getNodeVersion: hub.getNodeVersion,
    getValues,
    setTranslator,
    getTranslator: () => services.getTranslator(),
    setNotifier,
    getNotifier: () => services.getNotifier(),
    persist: persistManager,
    submit: () => submitNode(rootConfig),
    reset: (values?: DeepPartialValues<ExtractValues<TConfig>>) =>
      resetNode(rootConfig, values as Record<string, unknown> | undefined),
    setValues: (patch: DeepPartialValues<ExtractValues<TConfig>>) =>
      setValuesNode(rootConfig, patch as Record<string, unknown>),
  };
}

