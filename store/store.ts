import { applyPatch } from "./applyPatch/applyPatch";
import { recomputeAndNotify } from "./recomputeAll";
import { type FieldState } from "./compute";
import { type AnyConfigNode } from "./collectValues";
import { createBuildProxy } from "./buildProxy/buildProxy";
import { registerNodes, type GroupLeafMap } from "./registerNodes";
import { recomputeAll as _recomputeAll, recomputeTargeted as _recomputeTargeted } from "./recomputeAll";
import type { TrackingWrap } from "./recomputeAll";
import type { TranslateFn } from "./types";
import { createPersistManager } from "./persist/persistManager";
import { buildNodeMaps } from "./nodeMap";
import { executeReset, type ResetDeps } from "./resetPipeline";
import { executeSubmit, type SubmitDeps } from "./submitPipeline";
import { fireOnChange, type OnChangeDeps } from "./onChangePipeline";
import { formatPatch } from "./writePipeline";
import { captureInitialValues } from "./dirtyTracking";
import { initGroupSubmitting } from "./init/initGroupSubmitting";
import { createNotificationHub } from "./init/createNotificationHub";
import { createResolveManager } from "./init/createResolveManager";
import { type NotifyFn } from "./resolvePipeline/";
import { createGroupDeps, createTrackingValues, getNodeGroupPath } from "./groupDeps";
import { buildValuesCache } from "./valuesCache";

import type {
  ConfigProxy,
  DeepPartialValues,
  ExtractValues,
  ProxyStore,
  ProxyStoreOptions,
} from "./types";

export type { FieldState } from "./compute";
export type { Resolve, NotifyFn } from "./resolvePipeline/";
export type { SubmitResult } from "./submitPipeline";

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

  // ─── Хранилища ────────────────────────────────────────────────────────────

  /**
   * Вычисленное состояние каждого листового поля.
   * Ключ — объект-узел конфига, значение — FieldState.
   */
  const nodeState = new WeakMap<object, FieldState>();

  /**
   * Список всех листовых узлов конфига (для bumpLeafVersions в notification hub).
   * Заполняется при init.
   */
  const leafNodes: Array<{ node: AnyConfigNode; path: string }> = [];

  /**
   * Маппинг группового узла → массив его прямых листьев.
   * Используется recomputeGroup для скопированного пересчёта поддерева.
   */
  const groupLeafMap: GroupLeafMap = new WeakMap();

  /** Кэш Proxy-объектов — один прокси на узел конфига. */
  const proxyCache = new WeakMap<object, unknown>();

  /** Зарегистрированная функция перевода (label, placeholder, description). */
  let translator: TranslateFn = (v) => v;

  /** Зарегистрированная функция уведомления (toast, alert — для resolver onError). */
  let notifier: NotifyFn = () => {};

  /** Стабильная функция перевода, делегирует в текущий translator. */
  const translate: TranslateFn = (...args: any[]) => translator(...args);

  /** Стабильная функция уведомления, делегирует в текущий notifier. */
  const notify: NotifyFn = (...args) => notifier(...args);

  /**
   * Initial values for dirty tracking.
   * Captured after init and reset/hydrate.
   */
  const initialValueMap = new WeakMap<object, unknown>();

  /** Маппинг узла → dot-путь и узла → родитель. */
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();

  // ─── Инициализация ─────────────────────────────────────────────────────────

  // Выполняем инициализацию
  registerNodes(rootConfig, initialValues, leafNodes, nodeState, "", groupLeafMap);

  // Инициализируем submitting/dirty/revalidate для корневого и вложенных групп
  initGroupSubmitting(rootConfig, nodeState);

  // Строим маппинг узлов (пути + родители) — ПЕРЕД recomputeAll,
  // т.к. нужны для построения карты зависимостей при tracking
  buildNodeMaps(rootConfig, nodePaths, nodeParents);

  // Строим постоянно-актуальный кеш значений — ПОСЛЕ registerNodes
  const valuesCache = buildValuesCache(rootConfig, nodeState);

  // Создаём карту зависимостей групп (self-зависимости для каждой группы)
  const groupDeps = createGroupDeps(rootConfig, nodePaths);

  // Tracking-обёртка: при первом recomputeAll перехватываем GET-доступы
  // к значениям других групп и записываем кросс-групповые зависимости.
  const trackingWrap: TrackingWrap = (node, values) => {
    const recipientPath = getNodeGroupPath(node, nodeParents, nodePaths);
    return createTrackingValues(values, recipientPath, groupDeps);
  };

  // Первый recomputeAll с tracking — строит карту зависимостей
  _recomputeAll(rootConfig, groupLeafMap, nodeState, valuesCache, translate, trackingWrap);

  /**
   * Пересчитать состояние. Два режима:
   * - changedNodes передан → таргетированный пересчёт только затронутых групп
   * - changedNodes не передан → полный пересчёт всего дерева (init, reset, resolve)
   */
  function recomputeAll(changedNodes?: Set<object>): Set<object> {
    if (changedNodes && changedNodes.size > 0) {
      return _recomputeTargeted(changedNodes, {
        rootConfig,
        groupLeafMap,
        nodeState,
        nodeParents,
        nodePaths,
        groupDeps,
        valuesCache,
        translate,
      });
    }
    return _recomputeAll(rootConfig, groupLeafMap, nodeState, valuesCache, translate);
  }

  // Capture initial values for dirty tracking (after recompute to get computed values)
  captureInitialValues(rootConfig, nodeState, initialValueMap);

  // ─── Notification hub ──────────────────────────────────────────────────────

  const hub = createNotificationHub({ leafNodes, nodePaths });

  const { subscribe, subscribeGlobal } = hub;

  const notifyChanged = (changed: Set<object>) =>
    hub.notifyChanged(changed, { rootConfig, nodeState, initialValueMap });

  // ─── Translator ─────────────────────────────────────────────────────────────

  function setTranslator(t: TranslateFn | null) {
    const next = typeof t === "function" ? t : (v: string) => v;
    if (translator === next) return;
    translator = next;
    hub.bumpLeafVersions();
  }

  // ─── Notifier ─────────────────────────────────────────────────────────────────────

  function setNotifier(fn: NotifyFn | null) {
    notifier = typeof fn === "function" ? fn : () => {};
  }

  // ─── Resolve system ────────────────────────────────────────────────────────

  const resolveManager = createResolveManager({
    rootConfig,
    nodeState,
    recomputeAll,
    notifyChanged,
    notify,
    initialValueMap,
    valuesCache,
  });

  const { triggerResolve, getResolveState } = resolveManager;

  // ─── Handlers (submit, reset, onChange) ──────────────────────────────────

  const resetDeps: ResetDeps = { nodeState, recomputeAll, notifyChanged, initialValueMap, valuesCache };
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
    getTranslator: () => translator,
    setNotifier,
    getNotifier: () => notifier,
    persist: persistManager,
    submit: () => submitNode(rootConfig),
    reset: (values?: DeepPartialValues<ExtractValues<TConfig>>) =>
      resetNode(rootConfig, values as Record<string, unknown> | undefined),
    setValues: (patch: DeepPartialValues<ExtractValues<TConfig>>) =>
      setValuesNode(rootConfig, patch as Record<string, unknown>),
  };
}

