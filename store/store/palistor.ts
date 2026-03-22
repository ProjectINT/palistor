import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify as _recomputeAndNotify } from "../compute/recompute";
import { recomputeTargeted, collectGroupLeafNodes, recomputeLeaves } from "../compute/recompute";
import { ProxyBuilder } from "../buildProxy/buildProxy";
import { PersistManager } from "../persist/persistManager";
import { ResetPipeline } from "../resetPipeline/resetPipeline";
import { SubmitPipeline } from "../submitPipeline/submitPipeline";
import type { SubmitResult } from "../submitPipeline/submitPipeline";
import { OnChangePipeline } from "../onChangePipeline/onChangePipeline";
import { WritePipeline } from "../writePipeline/writePipeline";
import { formatPatch } from "../writePipeline/writePipeline";
import { NotificationHub } from "../init/createNotificationHub";
import { ResolveManager } from "../init/createResolveManager";
import type { NotifyFn } from "../resolvePipeline";
import { buildValuesCache, updateValuesCacheEntry } from "../valuesCache/valuesCache";
import type { ValuesCache } from "../valuesCache/valuesCache";
import { NodeRegistry } from "./NodeRegistry/nodeRegistry";
import { ServiceRegistry } from "./serviceRegistry";
import { DirtyTracker } from "./dirtyTracker";
import { GroupDepsMap } from "./groupDepsMap";
import { EntityRegistry } from "../entityRegistry";
import type { EntityData } from "../entityRegistry";

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

  /** @internal Реестр entity-объектов (Phase 1B+). */
  readonly entityRegistry: EntityRegistry;

  /**
   * @internal Plain POJO mirrors for each entity — used in valuesCache.values
   * (list arrays) and nodeSlot for O(1) updates.
   * Key: entityId, Value: plain object `{ id, field1, field2, ... }`.
   */
  readonly entityProjectionObjs: Map<string, Record<string, unknown>> = new Map();

  /** @internal Система уведомлений: версии, подписки, post-notify hook. */
  readonly hub: NotificationHub;

  /** @internal Менеджер resolve-подсистемы. */
  readonly resolveManager: ResolveManager;

  // ─── @internal pipeline-классы ───────────────────────────────────────────

  /** @internal Write pipeline. */
  readonly writePipeline: WritePipeline;

  /** @internal Reset pipeline. */
  readonly resetPipeline: ResetPipeline;

  /** @internal Submit pipeline. */
  readonly submitPipeline: SubmitPipeline;

  /** @internal onChange pipeline. */
  readonly onChangePipeline: OnChangePipeline;

  /** @internal ProxyBuilder. */
  readonly proxyBuilder: ProxyBuilder;

  // ─── Приватные данные ─────────────────────────────────────────────────────

  /** @internal Корневой конфиг, неизменяемый. */
  readonly rootConfig: AnyConfigNode;
  private readonly _proxy: ConfigProxy<TConfig>;
  private readonly _persist: PersistManager;

  // ─── Конструктор ──────────────────────────────────────────────────────────

  constructor(options: ProxyStoreOptions<TConfig>) {
    const { config, initialValues = {} } = options;
    const rootConfig = config as AnyConfigNode;
    this.rootConfig = rootConfig;

    // ─── Сервисы ────────────────────────────────────────────────────────────

    this.services = new ServiceRegistry();
    const { translate, notify } = this.services;

    // ─── NodeRegistry ────────────────────────────────────────────────────────

    this.nodes = new NodeRegistry(rootConfig, initialValues as Record<string, unknown>, translate);
    const { nodeState, nodePaths, nodeParents, leafNodes, groupLeafMap } = this.nodes;

    // ─── DirtyTracker + ValuesCache ──────────────────────────────────────────

    this.dirty = new DirtyTracker();
    this.values = buildValuesCache(rootConfig, nodeState);

    // ─── EntityRegistry ──────────────────────────────────────────────────────

    this.entityRegistry = new EntityRegistry();

    // ─── GroupDepsMap + первый recompute ──────────────────────────────────────

    this.groupDepsMap = new GroupDepsMap(rootConfig, nodePaths, nodeParents);
    this.recompute(); // первый полный пересчёт — строит карту зависимостей
    this.dirty.capture(rootConfig, nodeState);

    // ─── NotificationHub ────────────────────────────────────────────────────

    this.hub = new NotificationHub({ leafNodes, nodePaths });

    // ─── ResolveManager ──────────────────────────────────────────────────────

    this.resolveManager = new ResolveManager({
      rootConfig,
      nodeState,
      recompute: () => this.recompute(),
      notifyChanged: (c) => this.notifyChanged(c),
      notify,
      initialValueMap: this.dirty.initialValueMap,
      valuesCache: this.values,
    });

    // ─── Pipeline классы ─────────────────────────────────────────────────────

    this.writePipeline = new WritePipeline(this);
    this.resetPipeline = new ResetPipeline(this);
    this.submitPipeline = new SubmitPipeline(this);
    this.onChangePipeline = new OnChangePipeline(this);
    this.proxyBuilder = new ProxyBuilder(this);

    this._proxy = this.proxyBuilder.build(rootConfig) as ConfigProxy<TConfig>;

    // ─── PersistManager ───────────────────────────────────────────────────────

    this._persist = new PersistManager(this);

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
  recompute(changedNodes?: Set<object>): Set<object> {
    const { nodeState, nodePaths, nodeParents, groupLeafMap } = this.nodes;
    const { translate } = this.services;

    if (changedNodes && changedNodes.size > 0) {
      return recomputeTargeted(changedNodes, {
        rootConfig: this.rootConfig,
        groupLeafMap,
        nodeState,
        nodeParents,
        nodePaths,
        groupDeps: this.groupDepsMap.deps,
        valuesCache: this.values,
        translate,
      });
    }

    const leafNodes = collectGroupLeafNodes(this.rootConfig, groupLeafMap);

    if (!this.groupDepsMap.isBuilt) {
      const trackingWrap = this.groupDepsMap.getTrackingWrap();
      const result = recomputeLeaves(leafNodes, nodeState, this.values, translate, trackingWrap);
      this.groupDepsMap.markBuilt();
      return result;
    }

    return recomputeLeaves(leafNodes, nodeState, this.values, translate);
  }

  /**
   * Уведомить подписчиков об изменённых узлах.
   * Пересчитывает dirty-флаги и инкрементирует версии.
   *
   * @internal
   */
  notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed, {
      rootConfig: this.rootConfig,
      nodeState: this.nodes.nodeState,
      initialValueMap: this.dirty.initialValueMap,
    });
  }

  // ─── @internal pipeline-методы ────────────────────────────────────────────

  /** @internal Применить bulk-патч к узлу (один recompute + notify). */
  setValuesNode(node: AnyConfigNode, patch: Record<string, unknown>): void {
    const formatted = formatPatch(node, patch, this.values.values);
    const changed = applyPatch(node, this.nodes.nodeState, formatted, new Set(), this.values);
    _recomputeAndNotify(changed, () => this.recompute(), (c) => this.notifyChanged(c));
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

  setNotifier(fn: NotifyFn | null): void {
    this.services.setNotifier(fn);
  }

  submit(): Promise<SubmitResult> {
    return this.submitPipeline.execute(this.rootConfig);
  }

  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void {
    this.resetPipeline.execute(this.rootConfig, values as Record<string, unknown> | undefined);
  }

  setValues(patch: DeepPartialValues<ExtractValues<TConfig>>): void {
    this.setValuesNode(this.rootConfig, patch as Record<string, unknown>);
  }

  /**
   * Создать или обновить entity (или массив entities) в реестре.
   *
   * - Если entity с таким id не существует — создаётся и регистрируются leaf-ноды.
   * - Если существует — рекурсивный merge; обновлённые leaf-ноды маркируются как изменённые.
   * - Batch-режим: массив entities обрабатывается одним recompute + notifyChanged.
   */
  set(data: EntityData | EntityData[]): void {
    const items = Array.isArray(data) ? data : [data];
    const changed = new Set<object>();

    for (const item of items) {
      const entityNode = this.entityRegistry.upsert(item);
      const entityId = entityNode.id.value as string;
      const entityPrefix = `_entity_.${entityId}`;

      // Get or create entity projection POJO (used in valuesCache list arrays)
      let projectionObj = this.entityProjectionObjs.get(entityId);
      if (!projectionObj) {
        projectionObj = {};
        this.entityProjectionObjs.set(entityId, projectionObj);
      }

      this._walkAndSyncEntityNode(entityNode, entityPrefix, entityNode, changed, projectionObj);
    }

    if (changed.size === 0) return;
    const recomputed = this.recompute(changed);
    // Merge original changed: entity leaves have no computed props,
    // so recomputed may be empty — still need to notify about the entity values.
    for (const n of changed) recomputed.add(n);
    this.notifyChanged(recomputed);
  }

  /**
   * Удалить entity из реестра по ID.
   *
   * - Удаляет leaf-ноды entity из NodeRegistry (leafNodes, groupLeafMap).
   * - Очищает bindings и resolvedCache.
   * - Уведомляет подписчиков.
   *
   * No-op если entity не существует.
   */
  delete(id: string): void {
    const entityNode = this.entityRegistry.get(id);
    if (!entityNode) return;

    // Собрать все leaf-ноды entity
    const deletedLeaves = new Set<object>();
    this._collectEntityLeaves(entityNode, deletedLeaves);

    // Удалить leaf-ноды из NodeRegistry (предотвращает утечку памяти)
    for (const leaf of deletedLeaves) {
      this.nodes.unregisterLeaf(leaf);
    }

    // Удалить entity из реестра (очищает bindings + resolvedCache)
    this.entityRegistry.delete(id);

    // Уведомить подписчиков
    this.notifyChanged(deletedLeaves);
  }

  // ─── Приватные helpers для entity ────────────────────────────────────────

  /**
   * Рекурсивный обход entity node: регистрирует новые leaf-ноды через
   * `registerDynamicLeaf` и собирает изменённые в `changed`.
   *
   * Также поддерживает entity projection POJO (projectionObj):
   * - Новые leaf-ноды: регистрируют nodeSlot → projectionObj
   * - Существующие leaf-ноды: обновляют через updateValuesCacheEntry
   *
   * @param node          Текущий узел entity для обхода
   * @param prefix        Dot-путь текущего узла (e.g. "_entity_.u1")
   * @param parent        Родительский объект (для регистрации leaf-нод)
   * @param changed       Множество изменённых узлов (накапливается)
   * @param projectionObj Plain POJO at the current nesting level for valuesCache
   */
  private _walkAndSyncEntityNode(
    node: Record<string, unknown>,
    prefix: string,
    parent: object,
    changed: Set<object>,
    projectionObj?: Record<string, unknown>,
  ): void {
    // Регистрируем path группового узла для корректной работы getNodeGroupPath
    if (!this.nodes.nodePaths.has(parent)) {
      this.nodes.nodePaths.set(parent, prefix);
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (!child || typeof child !== "object") continue;

      const childObj = child as object;
      const childPath = `${prefix}.${key}`;

      if ("value" in childObj) {
        // Листовой узел
        const leaf = childObj as { value: unknown };
        if (!this.nodes.nodeState.has(childObj)) {
          // Новый leaf — регистрируем
          this.nodes.registerDynamicLeaf(childObj, childPath, parent, {
            value: leaf.value,
            isVisible: true,
            isRequired: false,
            isDisabled: false,
            isReadOnly: false,
            dirty: false,
            revalidate: false,
          });
          // Register nodeSlot so updateValuesCacheEntry keeps projectionObj in sync
          if (projectionObj !== undefined) {
            this.values.nodeSlot.set(childObj, { parent: projectionObj, key });
            projectionObj[key] = leaf.value;
          }
          changed.add(childObj);
        } else {
          // Существующий leaf — обнаруживаем изменение
          const state = this.nodes.nodeState.get(childObj)!;
          if (state.value !== leaf.value) {
            state.value = leaf.value;
            // Update projectionObj via nodeSlot (O(1) through registered slot)
            updateValuesCacheEntry(this.values, childObj, leaf.value);
            changed.add(childObj);
          }
        }
      } else {
        // Групповой узел — рекурсия
        let nestedProjectionObj: Record<string, unknown> | undefined;
        if (projectionObj !== undefined) {
          if (!projectionObj[key] || typeof projectionObj[key] !== "object") {
            projectionObj[key] = {};
          }
          nestedProjectionObj = projectionObj[key] as Record<string, unknown>;
        }
        this._walkAndSyncEntityNode(
          child as Record<string, unknown>,
          childPath,
          childObj,
          changed,
          nestedProjectionObj,
        );
      }
    }
  }

  /**
   * Рекурсивно собрать все leaf-ноды из entity node tree.
   * Используется в `delete()` для очистки NodeRegistry.
   */
  private _collectEntityLeaves(
    node: Record<string, unknown>,
    result: Set<object>,
  ): void {
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (!child || typeof child !== "object") continue;
      if ("value" in (child as object)) {
        result.add(child as object);
      } else {
        this._collectEntityLeaves(child as Record<string, unknown>, result);
      }
    }
  }
}
