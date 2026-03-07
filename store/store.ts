import { applyPatch } from "./applyPatch";
import { type FieldState } from "./compute";
import { collectValues, type AnyConfigNode } from "./collectValues";
import { createBuildProxy } from "./buildProxy/buildProxy";
import { registerNodes } from "./registerNodes";
import { recomputeAll as _recomputeAll } from "./recomputeAll";
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
import { type NotifyFn } from "./resolvePipeline";

import type {
  ConfigProxy,
  DeepPartialValues,
  ExtractValues,
  ProxyStore,
  ProxyStoreOptions,
} from "./types";

export type { FieldState } from "./compute";
export type { Resolve, NotifyFn } from "./resolvePipeline";
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
   * Список всех листовых узлов конфига (для полного пересчёта).
   * Заполняется при init, используется при recompute.
   */
  const leafNodes: Array<{ node: AnyConfigNode; path: string }> = [];

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

  function recomputeAll(): Set<object> {
    return _recomputeAll(rootConfig, leafNodes, nodeState, translate);
  }

  // Выполняем инициализацию
  registerNodes(rootConfig, initialValues, leafNodes, nodeState);

  // Инициализируем submitting/dirty/revalidate для корневого и вложенных групп
  initGroupSubmitting(rootConfig, nodeState);

  recomputeAll(); // вычисляем isVisible, isRequired, error и т.д.

  // Capture initial values for dirty tracking (after recompute to get computed values)
  captureInitialValues(rootConfig, nodeState, initialValueMap);

  // Строим маппинг узлов (пути + родители)
  buildNodeMaps(rootConfig, nodePaths, nodeParents);

  // ─── Notification hub ──────────────────────────────────────────────────────

  const hub = createNotificationHub({
    rootConfig,
    nodeState,
    initialValueMap,
    leafNodes,
    nodePaths,
  });

  const { notifyChanged, subscribe, subscribeGlobal } = hub;

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
  });

  const { triggerResolve, getResolveState } = resolveManager;

  // ─── Handlers (submit, reset, onChange) ──────────────────────────────────

  const resetDeps: ResetDeps = { nodeState, recomputeAll, notifyChanged, initialValueMap };
  const resetNode = (node: AnyConfigNode, values?: Record<string, unknown>) => {
    executeReset(node, resetDeps, values);
  };

  const setValuesNode = (node: AnyConfigNode, patch: Record<string, unknown>): void => {
    // Фаза 1: форматируем патч — каждое листовое значение проходит через formatter узла.
    const formatted = formatPatch(node, nodeState, patch, rootConfig);
    // Фаза 2: применяем уже отформатированный патч к nodeState.
    const changed = applyPatch(node, nodeState, formatted);
    const recomputed = recomputeAll();
    for (const n of changed) recomputed.add(n);
    notifyChanged(recomputed);
  };

  const submitDeps: SubmitDeps = {
    nodeState,
    recomputeAll,
    notifyChanged,
    resetNode,
    clearPersist: () => persistManager.clear(),
  };

  const submitNode = (node: AnyConfigNode) => executeSubmit(node, submitDeps);

  const onChangeDeps: OnChangeDeps = {
    rootConfig,
    nodeState,
    nodePaths,
    nodeParents,
    recomputeAll,
    notifyChanged,
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
  });

  // ─── Persist ────────────────────────────────────────────────────────────────

  const getValues = () => collectValues(rootConfig, nodeState) as ExtractValues<TConfig>;

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

