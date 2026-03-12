import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify as _recomputeAndNotify } from "../compute/recompute";
import { recomputeAll as _recomputeAll, recomputeTargeted as _recomputeTargeted } from "../compute/recompute";
import { createBuildProxy } from "../buildProxy/buildProxy";
import { createPersistManager } from "../persist/persistManager";
import type { PersistManager } from "../persist/persistManager";
import { executeReset, type ResetDeps } from "../resetPipeline/resetPipeline";
import { executeSubmit, type SubmitDeps } from "../submitPipeline/submitPipeline";
import type { SubmitResult } from "../submitPipeline/submitPipeline";
import { fireOnChange, type OnChangeDeps } from "../onChangePipeline/onChangePipeline";
import { formatPatch } from "../writePipeline/writePipeline";
import { NotificationHub } from "../init/createNotificationHub";
import { ResolveManager } from "../init/createResolveManager";
import type { NotifyFn } from "../resolvePipeline";
import { buildValuesCache } from "../valuesCache/valuesCache";
import type { ValuesCache } from "../valuesCache/valuesCache";
import { NodeRegistry } from "./nodeRegistry";
import { ServiceRegistry } from "./serviceRegistry";
import { DirtyTracker } from "./dirtyTracker";
import { GroupDepsMap } from "./groupDepsMap";

import type {
  AnyConfigNode,
  ConfigProxy,
  DeepPartialValues,
  ExtractValues,
  ProxyStore,
  ProxyStoreOptions,
  TranslateFn,
  Unsubscribe,
} from "./types";

// ─── Palistor ─────────────────────────────────────────────────────────────────

/**
 * Публичный класс формы. Одновременно является DI-контейнером для всех
 * внутренних подсистем и реализует публичный интерфейс `ProxyStore`.
 *
 * @example
 * const store = new Palistor({ config: myConfig, initialValues: {...} });
 * store.proxy.email.value = "test@example.com";
 * store.submit();
 */
export class Palistor<TConfig extends Record<string, any>> implements ProxyStore<TConfig> {
  // ─── @internal подсистемы ─────────────────────────────────────────────────

  /** @internal Реестр узлов: nodeState, nodePaths, nodeParents, leafNodes, groupLeafMap, proxyCache. */
  readonly nodes: NodeRegistry;

  /** @internal Глобальные сервисы: translator, notifier и их делегаты. */
  readonly services: ServiceRegistry;

  /** @internal Отслеживание dirty-флагов. */
  readonly dirty: DirtyTracker;

  /** @internal Мутабельный кэш значений. */
  readonly values: ValuesCache;

  /** @internal Карта межгрупповых зависимостей. */
  readonly groupDepsMap: GroupDepsMap;

  /** @internal Система уведомлений: версии, подписки, post-notify hook. */
  readonly hub: NotificationHub;

  /** @internal Менеджер resolve-подсистемы. */
  readonly resolveManager: ResolveManager;

  // ─── Приватные данные ─────────────────────────────────────────────────────

  private readonly _rootConfig: AnyConfigNode;
  private readonly _proxy: ConfigProxy<TConfig>;
  private readonly _persist: PersistManager;

  /** @internal Выполнить submit pipeline для узла. */
  private _submitNode!: (node: AnyConfigNode) => Promise<SubmitResult>;

  /** @internal Выполнить reset pipeline для узла. */
  private _resetNode!: (node: AnyConfigNode, values?: Record<string, unknown>) => void;

  // ─── Конструктор ──────────────────────────────────────────────────────────

  constructor(options: ProxyStoreOptions<TConfig>) {
    const { config, initialValues = {} } = options;
    const rootConfig = config as AnyConfigNode;
    this._rootConfig = rootConfig;

    // ─── Сервисы ────────────────────────────────────────────────────────────

    this.services = new ServiceRegistry();
    const { translate, notify } = this.services;

    // ─── NodeRegistry ────────────────────────────────────────────────────────

    this.nodes = new NodeRegistry(rootConfig, initialValues as Record<string, unknown>, translate);
    const { nodeState, nodePaths, nodeParents, leafNodes, groupLeafMap, proxyCache } = this.nodes;

    // ─── DirtyTracker + ValuesCache ──────────────────────────────────────────

    this.dirty = new DirtyTracker();
    this.values = buildValuesCache(rootConfig, nodeState);

    // ─── GroupDepsMap + первый recomputeAll ──────────────────────────────────

    this.groupDepsMap = new GroupDepsMap(rootConfig, nodePaths, nodeParents);
    this.recomputeAll(); // первый полный пересчёт — строит карту зависимостей
    this.dirty.capture(rootConfig, nodeState);

    // ─── NotificationHub ────────────────────────────────────────────────────

    this.hub = new NotificationHub({ leafNodes, nodePaths });

    // ─── ResolveManager ──────────────────────────────────────────────────────

    this.resolveManager = new ResolveManager({
      rootConfig,
      nodeState,
      recomputeAll: () => this.recomputeAll(),
      notifyChanged: (c) => this.notifyChanged(c),
      notify,
      initialValueMap: this.dirty.initialValueMap,
      valuesCache: this.values,
    });

    // ─── Pipeline deps ────────────────────────────────────────────────────────

    const resetDeps: ResetDeps = {
      nodeState,
      recomputeAll: () => this.recomputeAll(),
      notifyChanged: (c) => this.notifyChanged(c),
      initialValueMap: this.dirty.initialValueMap,
      valuesCache: this.values,
    };

    this._resetNode = (node, values) => executeReset(node, resetDeps, values);

    const submitDeps: SubmitDeps = {
      nodeState,
      recomputeAll: () => this.recomputeAll(),
      notifyChanged: (c) => this.notifyChanged(c),
      resetNode: (node, values) => executeReset(node, resetDeps, values),
      clearPersist: () => this._persist.clear(),
      valuesCache: this.values,
      nodePaths,
      rootConfig,
    };

    this._submitNode = (node) => executeSubmit(node, submitDeps);

    const onChangeDeps: OnChangeDeps = {
      rootConfig,
      nodeState,
      nodePaths,
      nodeParents,
      recomputeAll: () => this.recomputeAll(),
      notifyChanged: (c) => this.notifyChanged(c),
      valuesCache: this.values,
    };

    // ─── Proxy ────────────────────────────────────────────────────────────────

    const buildProxy = createBuildProxy({
      proxyCache,
      nodeState,
      rootConfig,
      recomputeAll: () => this.recomputeAll(),
      notifyChanged: (c) => this.notifyChanged(c),
      translate,
      submitNode: (node) => this._submitNode(node),
      resetNode: (node, values) => this._resetNode(node, values),
      setValuesNode: (node, patch) => this._setValuesNode(node, patch),
      onFieldChange: (node, newVal, prevVal) => fireOnChange(node, newVal, prevVal, onChangeDeps),
      triggerResolve: this.resolveManager.triggerResolve,
      getResolveState: this.resolveManager.getResolveState,
      valuesCache: this.values,
    });

    this._proxy = buildProxy(rootConfig) as ConfigProxy<TConfig>;

    // ─── PersistManager ───────────────────────────────────────────────────────

    this._persist = createPersistManager({
      rootConfig,
      nodeState,
      recomputeAll: () => this.recomputeAll(),
      notifyChanged: (c) => this.notifyChanged(c),
      getValues: () => this.getValues() as Record<string, unknown>,
      subscribeGlobal: (fn) => this.hub.subscribeGlobal(fn),
    });

    // ─── Wire resolve retrigger ──────────────────────────────────────────────

    const postNotifyHook = this.resolveManager.createPostNotifyHook();
    if (postNotifyHook) this.hub.setPostNotifyHook(postNotifyHook);

    // ─── Launch eager resolvers ──────────────────────────────────────────────

    this.resolveManager.launchEager();
  }

  // ─── @internal методы-фасады ──────────────────────────────────────────────

  /**
   * Пересчитать состояние узлов.
   *
   * - `changedNodes` передан и не пуст → таргетированный пересчёт (быстро)
   * - иначе → полный пересчёт всего дерева (init, reset, resolve-завершение)
   *
   * При первом вызове без changedNodes строит карту групповых зависимостей.
   *
   * @internal
   */
  recomputeAll(changedNodes?: Set<object>): Set<object> {
    const { nodeState, nodePaths, nodeParents, groupLeafMap } = this.nodes;
    const { translate } = this.services;

    if (changedNodes && changedNodes.size > 0) {
      return _recomputeTargeted(changedNodes, {
        rootConfig: this._rootConfig,
        groupLeafMap,
        nodeState,
        nodeParents,
        nodePaths,
        groupDeps: this.groupDepsMap.deps,
        valuesCache: this.values,
        translate,
      });
    }

    if (!this.groupDepsMap.isBuilt) {
      const trackingWrap = this.groupDepsMap.getTrackingWrap();
      const result = _recomputeAll(
        this._rootConfig,
        groupLeafMap,
        nodeState,
        this.values,
        translate,
        trackingWrap,
      );
      this.groupDepsMap.markBuilt();
      return result;
    }

    return _recomputeAll(this._rootConfig, groupLeafMap, nodeState, this.values, translate);
  }

  /**
   * Уведомить подписчиков об изменённых узлах.
   * Пересчитывает dirty-флаги и инкрементирует версии.
   *
   * @internal
   */
  notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed, {
      rootConfig: this._rootConfig,
      nodeState: this.nodes.nodeState,
      initialValueMap: this.dirty.initialValueMap,
    });
  }

  // ─── Приватные pipeline-методы ────────────────────────────────────────────

  private _setValuesNode(node: AnyConfigNode, patch: Record<string, unknown>): void {
    const formatted = formatPatch(node, patch, this.values.values);
    const changed = applyPatch(node, this.nodes.nodeState, formatted, new Set(), this.values);
    _recomputeAndNotify(changed, () => this.recomputeAll(), (c) => this.notifyChanged(c));
  }

  // ─── ProxyStore — публичный API ───────────────────────────────────────────

  get proxy(): ConfigProxy<TConfig> {
    return this._proxy;
  }

  get persist(): PersistManager {
    return this._persist;
  }

  subscribe(node: object, listener: () => void): Unsubscribe {
    return this.hub.subscribe(node, listener);
  }

  subscribeGlobal(listener: () => void): Unsubscribe {
    return this.hub.subscribeGlobal(listener);
  }

  getVersion(): number {
    return this.hub.getVersion();
  }

  getNodeVersion(node: object): number {
    return this.hub.getNodeVersion(node);
  }

  getValues(): ExtractValues<TConfig> {
    return structuredClone(this.values.values) as ExtractValues<TConfig>;
  }

  setTranslator(t: TranslateFn | null): void {
    if (this.services.setTranslator(t)) this.hub.bumpLeafVersions();
  }

  getTranslator(): TranslateFn {
    return this.services.getTranslator();
  }

  setNotifier(fn: NotifyFn | null): void {
    this.services.setNotifier(fn);
  }

  getNotifier(): NotifyFn {
    return this.services.getNotifier();
  }

  submit(): Promise<SubmitResult> {
    return this._submitNode(this._rootConfig);
  }

  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void {
    this._resetNode(this._rootConfig, values as Record<string, unknown> | undefined);
  }

  setValues(patch: DeepPartialValues<ExtractValues<TConfig>>): void {
    this._setValuesNode(this._rootConfig, patch as Record<string, unknown>);
  }
}
