import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify as _recomputeAndNotify } from "../compute/recompute";
import { recomputeTargeted, collectGroupComputeNodes, recomputeLeaves } from "../compute/recompute";
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
import { generateTmpId } from "../entityRegistry";
import type { EntityData } from "../entityRegistry";
import type { EntityNode } from "../entityRegistry/types";
import { isLeafNode, isListNode, isGroupNode, configKeys } from "../traversal";

import type {
  AnyConfigNode,
  DeepPartialValues,
  ExtractValues,
  ListState,
  ProxyStore,
  ProxyStoreOptions,
  RawStoreProxy,
  TranslateFn,
  Unsubscribe,
} from "./types";
import type { FieldState } from "../compute/index";

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

  /** @internal Реестр узлов: nodeState, nodePaths, nodeParents, computeNodes, groupComputeMap, proxyCache. */
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
  private readonly _proxy: RawStoreProxy<TConfig>;
  private readonly _persist: PersistManager;

  /**
   * Нереактивный контекст — произвольные данные, доступные через `store.context`.
   * Устанавливается через `setContext()` или хук `useStoreContext()`.
   */
  private _context: Record<string, unknown> = {};

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
    this.nodes.setKernel(this);
    const { nodeState, nodePaths, nodeParents, computeNodes } = this.nodes;

    // ─── DirtyTracker + ValuesCache ──────────────────────────────────────────

    this.dirty = new DirtyTracker();
    this.values = buildValuesCache(rootConfig, nodeState);

    // ─── EntityRegistry ──────────────────────────────────────────────────────

    this.entityRegistry = new EntityRegistry();

    // Register all list states so EntityRegistry.rekey() can update itemIds
    for (const ls of this.nodes.allListStates) {
      this.entityRegistry.registerList(ls);
    }

    // ─── GroupDepsMap + первый recompute ──────────────────────────────────────

    this.groupDepsMap = new GroupDepsMap(rootConfig, nodePaths, nodeParents);
    this.recompute(); // первый полный пересчёт — строит карту зависимостей
    this.dirty.capture(rootConfig, nodeState);

    // ─── NotificationHub ────────────────────────────────────────────────────

    this.hub = new NotificationHub({ computeNodes, nodePaths });

    // ─── ResolveManager ──────────────────────────────────────────────────────

    this.resolveManager = new ResolveManager({
      rootConfig,
      nodeState,
      recompute: () => this.recompute(),
      notifyChanged: (c) => this.notifyChanged(c),
      notify,
      initialValueMap: this.dirty.initialValueMap,
      valuesCache: this.values,
      store: this,
      listStates: this.nodes.listStates,
      setEntitiesRaw: (items, listNode) => this._setEntitiesRaw(items, listNode),
      syncListValuesCache: (listNode) => this._syncListValuesCache(listNode),
      entityRegistry: this.entityRegistry,
    });

    // ─── Pipeline классы ─────────────────────────────────────────────────────

    this.writePipeline = new WritePipeline(this);
    this.resetPipeline = new ResetPipeline(this);
    this.submitPipeline = new SubmitPipeline(this);
    this.onChangePipeline = new OnChangePipeline(this);
    this.proxyBuilder = new ProxyBuilder(this);

    this._proxy = this.proxyBuilder.build(rootConfig) as RawStoreProxy<TConfig>;

    // ─── PersistManager ───────────────────────────────────────────────────────

    this._persist = new PersistManager(this);

    // ─── Wire resolve retrigger ──────────────────────────────────────────────

    const postNotifyHook = this.resolveManager.createPostNotifyHook();
    if (postNotifyHook) this.hub.setPostNotifyHook(postNotifyHook);

    // ─── Начальный контекст (Phase 4) ────────────────────────────────────────

    if (options.context) {
      this._context = options.context;
    }

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
    const { nodeState, nodePaths, nodeParents, groupComputeMap } = this.nodes;
    const { translate } = this.services;

    if (changedNodes && changedNodes.size > 0) {
      return recomputeTargeted(changedNodes, {
        rootConfig: this.rootConfig,
        groupComputeMap,
        nodeState,
        nodeParents,
        nodePaths,
        groupDeps: this.groupDepsMap.deps,
        valuesCache: this.values,
        translate,
      });
    }

    const computeNodes = collectGroupComputeNodes(this.rootConfig, groupComputeMap);

    if (!this.groupDepsMap.isBuilt) {
      const trackingWrap = this.groupDepsMap.getTrackingWrap();
      const result = recomputeLeaves(computeNodes, nodeState, this.values, translate, trackingWrap);
      this.groupDepsMap.markBuilt();
      return result;
    }

    return recomputeLeaves(computeNodes, nodeState, this.values, translate);
  }

  /**
   * Уведомить подписчиков об изменённых узлах.
   * Пересчитывает dirty-флаги и инкрементирует версии.
   *
   * @internal
   */
  notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed as Set<AnyConfigNode>, {
      rootConfig: this.rootConfig,
      nodeState: this.nodes.nodeState as WeakMap<AnyConfigNode, FieldState>,
      initialValueMap: this.dirty.initialValueMap as WeakMap<AnyConfigNode, unknown>,
      listStates: this.nodes.listStates as WeakMap<AnyConfigNode, ListState>,
      nodeParents: this.nodes.nodeParents as WeakMap<AnyConfigNode, AnyConfigNode>,
      nodePaths: this.nodes.nodePaths as WeakMap<AnyConfigNode, string>,
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

  get proxy(): RawStoreProxy<TConfig> {
    return this._proxy;
  }

  get context(): Record<string, unknown> {
    return this._context;
  }

  setContext(ctx: Record<string, unknown>): void {
    const changedKeys = new Set<string>();
    for (const key of Object.keys(ctx)) {
      if (this._context[key] !== ctx[key]) changedKeys.add(key);
    }

    this._context = { ...this._context, ...ctx };

    if (changedKeys.size > 0) {
      const changedPaths = new Set<string>();
      for (const key of changedKeys) changedPaths.add(`$context.${key}`);
      this.resolveManager.retriggerByPaths(changedPaths);
    }
  }

  get persist(): PersistManager {
    return this._persist;
  }

  subscribe(node: object, listener: () => void): Unsubscribe {
    return this.hub.subscribe(node as AnyConfigNode, listener);
  }

  subscribeGlobal(listener: () => void): Unsubscribe {
    return this.hub.subscribeGlobal(listener);
  }

  getVersion(): number {
    return this.hub.getVersion();
  }

  getNodeVersion(node: object): number {
    return this.hub.getNodeVersion(node as AnyConfigNode);
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
    const changed = this._setEntitiesRaw(items);

    if (changed.size === 0) return;
    const recomputed = this.recompute(changed);
    // Merge original changed: entity leaves have no computed props,
    // so recomputed may be empty — still need to notify about the entity values.
    for (const n of changed) recomputed.add(n);
    this.notifyChanged(recomputed);
  }

  /**
   * Переименовать entity: перенести с oldId на newId.
   *
   * - Обновляет EntityRegistry (entities Map, bindings, resolvedCache, id leaf value).
   * - Обновляет itemIds во всех ListState-объектах.
   * - Обновляет entityProjectionObjs (переносит POJO-зеркало).
   * - Уведомляет подписчиков об изменении id leaf.
   *
   * No-op если entity с oldId не существует.
   */
  rekey(oldId: string, newId: string): void {
    const entity = this.entityRegistry.get(oldId);
    if (!entity) return;

    // EntityRegistry.rekey() updates: entities Map, id.value, bindings, resolvedCache, allRegisteredLists.itemIds
    this.entityRegistry.rekey(oldId, newId);

    // Move entityProjectionObjs entry
    const projObj = this.entityProjectionObjs.get(oldId);
    if (projObj) {
      this.entityProjectionObjs.delete(oldId);
      this.entityProjectionObjs.set(newId, projObj);
    }

    // Notify: id leaf changed
    const idLeaf = entity.id as object;
    const changed = new Set<object>([idLeaf]);
    // Update nodeState value for id leaf
    const leafState = this.nodes.nodeState.get(idLeaf);
    if (leafState) {
      this.nodes.nodeState.set(idLeaf, { ...leafState, value: newId });
      if (projObj) projObj["id"] = newId;
    }
    const recomputed = this.recompute(changed);
    for (const n of changed) recomputed.add(n);
    this.notifyChanged(recomputed);
  }

  /**
   * Удалить entity из реестра по ID.
   *
   * - Удаляет leaf-ноды entity из NodeRegistry (computeNodes, groupComputeMap).
   * - Очищает bindings и resolvedCache.
   * - Уведомляет подписчиков.
   *
   * No-op если entity не существует.
   */
  delete(id: string): void {
    const entityNode = this.entityRegistry.get(id);
    if (!entityNode) return;

    // C2: каскадное удаление child-entity, принадлежащих этой entity.
    // Снимаем копию множества — childrenByOwner мутируется при рекурсивном delete.
    const childIds = this.entityRegistry.getChildrenByOwner(id);
    if (childIds && childIds.size > 0) {
      for (const childId of [...childIds]) {
        this.delete(childId);
      }
    }

    // Собрать все leaf-ноды entity
    const deletedLeaves = new Set<object>();
    this.collectEntityLeaves(entityNode, deletedLeaves);

    // Удалить leaf-ноды из NodeRegistry (предотвращает утечку памяти)
    for (const leaf of deletedLeaves) {
      this.nodes.unregisterLeaf(leaf);
    }

    // Phase 4: cleanup per-entity field resolve states
    this.resolveManager.cleanupEntityResolveStates(id);

    // Удалить entity из реестра (очищает bindings + resolvedCache)
    this.entityRegistry.delete(id);

    // Уведомить подписчиков
    this.notifyChanged(deletedLeaves);
  }

  /**
   * Сбросить resolved-кэш для entity (все template или конкретный).
   *
   * - `invalidate(id)` — очистить весь кэш для entity
   * - `invalidate(id, templateNode)` — очистить только для конкретной пары
   *
   * При следующем mount useForm(entity, template) resolve будет перезапущен.
   */
  invalidate(id: string, templateNode?: object): void {
    this.entityRegistry.clearResolved(id, templateNode);
  }

  /**
   * Submit entity через template.
   * Вызывается из EntityProjectionProxy.submit().
   *
   * 1. submitting: true → notify
   * 2. Валидация через template field rules (validate)
   * 3. templateNode.onSubmit(entityProxy, store)
   * 4. templateNode.afterSubmit(result, { reset })
   * 5. submitting: false → notify
   *
   * @internal
   */
  async executeEntityTemplateSubmit(
    entityId: string,
    templateNode: AnyConfigNode,
    entityProxy: object,
  ): Promise<SubmitResult> {
    // Шаг 1: Найти entity в реестре. Если не найдена — ранний выход с ошибкой.
    const entityNode = this.entityRegistry.get(entityId);
    if (!entityNode) {
      return {
        success: false,
        errors: [{ path: "", message: `Entity "${entityId}" not found` }],
      };
    }

    // Шаг 2: Получить (или создать) объект состояния привязки { loading, submitting }
    // для пары (entityId, templateNode). Используется EntityProjectionProxy
    // для отображения спиннера в UI.
    const bindingState = this.resolveManager.entityStates.getOrCreate(entityId, templateNode as object);
    const entityNodeObj = entityNode as unknown as object;

    // Шаг 3: Поднять флаг submitting и уведомить подписчиков (React перерендерит
    // компоненты, привязанные к этой entity — например, кнопка покажет спиннер).
    bindingState.submitting = true;
    this.notifyChanged(new Set<object>([entityNodeObj]));

    try {
      // Шаг 4: Валидация — рекурсивно обойти template-поля и вызвать validate()
      // для каждого leaf-поля, у которого есть валидатор. Текущие значения
      // берутся из nodeState entity.
      const errors: Array<{ path: string; message: string }> = [];
      this.collectEntityTemplateErrors(
        templateNode,
        entityNode as unknown as Record<string, unknown>,
        errors,
        "",
      );

      // Если есть ошибки валидации — вернуть их, не вызывая onSubmit.
      if (errors.length > 0) {
        return { success: false, errors };
      }

      // Шаг 5: Вызвать пользовательский onSubmit(entityProxy, store).
      // entityProxy — это Proxy entity с template-правилами, store — сам Palistor.
      // Обычно здесь выполняется API-запрос на сервер.
      let result: unknown;
      if (typeof templateNode.onSubmit === "function") {
        result = await (
          templateNode.onSubmit as (
            proxy: object,
            store: unknown,
          ) => Promise<unknown> | unknown
        )(entityProxy, this);
      }

      // Шаг 6: Вызвать afterSubmit(result, { reset }) — хук после успешного submit.
      // reset для entity template — no-op (у entity нет встроенного сброса, в отличие от form).
      if (typeof templateNode.afterSubmit === "function") {
        const reset = () => void 0; // entity template has no built-in reset
        await (
          templateNode.afterSubmit as (
            r: unknown,
            actions: { reset: () => void },
          ) => void | Promise<void>
        )(result, { reset });
      }

      return { success: true, result };
    } finally {
      // Шаг 7 (always): Снять флаг submitting и уведомить подписчиков.
      // finally гарантирует сброс даже при ошибке в onSubmit/afterSubmit.
      bindingState.submitting = false;
      this.notifyChanged(new Set<object>([entityNodeObj]));
    }
  }

  // ─── Приватные helpers для entity ────────────────────────────────────────

  /**
   * Upsert entities in EntityRegistry and register/update their leaf nodes.
   * Returns Set of changed leaf nodes. Does NOT call recompute or notifyChanged.
   *
   * Used internally by `set()` and by `executeListResolve` via the
   * `setEntitiesRaw` callback in ResolveManagerDeps.
   *
   * Phase 4: when `listNode` is provided, triggers entity field resolves for
   * each template field entry belonging to that list.
   *
   * @internal
   */
  _setEntitiesRaw(items: EntityData[], listNode?: object): Set<object> {
    const changed = new Set<object>();

    for (const item of items) {
      // Создать новый EntityNode или обновить существующий (рекурсивный merge).
      // Если item.id отсутствует — EntityRegistry сгенерирует временный _tmp_* id.
      const entityNode = this.entityRegistry.upsert(item);
      const entityId = entityNode.id.value as string;
      // Все entity-ноды живут в namespace "_entity_." для изоляции от config-нод формы.
      const entityPrefix = `_entity_.${entityId}`;

      // projectionObj — «зеркало» entity в виде plain POJO { id, field1, field2 }.
      // Используется в valuesCache.values как элемент массива списка.
      // Ссылочная идентичность POJO сохраняется между upsert-ами, меняются только значения.
      let projectionObj = this.entityProjectionObjs.get(entityId);
      if (!projectionObj) {
        projectionObj = {};
        this.entityProjectionObjs.set(entityId, projectionObj);
      }

      // DFS-обход entity-дерева: зарегистрировать новые leaf-ноды
      // или обнаружить изменения в существующих.
      this.walkAndSyncEntityNode(entityNode, entityPrefix, entityNode, changed, projectionObj);

      // Entity field resolves are lazy-only: triggered when a component first reads
      // field.value or field.loading (via queueMicrotask in buildEntityProjectionProxy).
      // This avoids N×M concurrent requests for large lists where N = entities, M = resolve fields.
    }

    return changed;
  }

  /**
   * Sync valuesCache.values[listKey] from listState.itemIds.
   * Used by executeListResolve after updating itemIds.
   *
   * @internal
   */
  _syncListValuesCache(listNode: object): void {
    // Найти «слот» в valuesCache для этого списка (пара { parent, key }).
    // parent — родительский POJO-объект в valuesCache.values, key — имя поля.
    const slot = this.values.nodeSlot.get(listNode);
    if (!slot) return;

    // listState хранит itemIds — упорядоченный массив entity ID текущего списка.
    const listState = this.nodes.listStates.get(listNode);
    if (!listState) return;

    // Перестроить массив: заменить itemIds на соответствующие POJO-зеркала.
    // Результат: valuesCache.values.users = [{ id: "u1", ... }, { id: "u2", ... }]
    // Это тот же массив, на который ссылается proxy.users.value — React увидит обновление.
    slot.parent[slot.key] = listState.itemIds
      .map((id) => this.entityProjectionObjs.get(id))
      .filter((obj): obj is Record<string, unknown> => obj !== undefined);
  }

  /** @internal Текущий id entity (учитывает rekey через nodeState). */
  private _entityId(entity: EntityNode): string {
    const idLeaf = entity.id as object;
    return (
      (this.nodes.nodeState.get(idLeaf) as { value: unknown } | undefined)?.value ??
      entity.id.value
    ) as string;
  }

  /**
   * Материализовать состав per-entity списка в projectionObj владельца
   * (вариант C, C3/C4). Записывает массив projectionObj-ов child-entity в
   * `ownerProjectionObj`-е по пути списка (`["contacts"]` или, для списка в
   * nested-группе, `["profile", "contacts"]`).
   *
   * Это включает вложенный список в `store.getValues()`: projectionObj владельца
   * входит в массив корневого списка (`values.users[i]`) по ссылке, а child
   * projectionObj-ы сами рекурсивно материализуют свои списки.
   *
   * No-op, если у владельца нет projectionObj (single-binding entity, не входящая
   * ни в один корневой список) или listConfigNode не имеет известного пути.
   *
   * @internal
   */
  _syncEntityListValuesCache(ownerEntity: EntityNode, listConfigNode: object): void {
    const path = this.nodes.listFieldKeys.get(listConfigNode);
    if (!path || path.length === 0) return;

    const ownerId = this._entityId(ownerEntity);
    const projectionObj = this.entityProjectionObjs.get(ownerId);
    if (!projectionObj) return;

    const els = ownerEntity.lists?.get(listConfigNode);
    const itemIds = els?.itemIds ?? [];
    const materialized = itemIds
      .map((id) => this.entityProjectionObjs.get(id))
      .filter((obj): obj is Record<string, unknown> => obj !== undefined);

    // Спускаемся к родительскому POJO по пути (создавая промежуточные группы),
    // затем пишем состав списка под финальным ключом.
    let target = projectionObj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      let next = target[k];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        next = {};
        target[k] = next;
      }
      target = next as Record<string, unknown>;
    }
    target[path[path.length - 1]] = materialized;
  }

  /**
   * Восстановить состав корневых И per-entity списков из снимка значений
   * (вариант C, C3 — persist hydrate).
   *
   * `applyPatch` пропускает list-узлы, поэтому состав списков восстанавливается
   * отдельным проходом: для каждого list-поля создаём child-entity, проставляем
   * owner-ссылку (для вложенных), заполняем `itemIds`/`initialItemIds` и
   * синхронизируем valuesCache. Рекурсивно обрабатывает nested-of-nested.
   *
   * Возвращает множество изменённых узлов для последующего notify.
   *
   * @internal
   */
  restoreLists(values: Record<string, unknown>): Set<object> {
    const changed = new Set<object>();
    this._restoreListsRec(this.rootConfig, values, null, changed);
    return changed;
  }

  private _restoreListsRec(
    configNode: AnyConfigNode,
    valueObj: Record<string, unknown> | undefined,
    ownerEntity: EntityNode | null,
    changed: Set<object>,
  ): void {
    for (const key of configKeys(configNode as Record<string, unknown>)) {
      const child = (configNode as Record<string, unknown>)[key];
      if (!child || typeof child !== "object") continue;

      // Вложенная группа (не список): рекурсия, чтобы достать списки внутри неё.
      if (!Array.isArray(child)) {
        if (isGroupNode(child as object)) {
          const nested = valueObj?.[key];
          if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            this._restoreListsRec(
              child as AnyConfigNode,
              nested as Record<string, unknown>,
              ownerEntity,
              changed,
            );
          }
        }
        continue;
      }

      if (!isListNode(child as object)) continue;

      const arr = valueObj?.[key];
      if (!Array.isArray(arr)) continue;

      const listConfigNode = child as object;
      const template = (child as unknown[])[0] as AnyConfigNode;
      const ids: string[] = [];

      for (const itemObj of arr) {
        if (!itemObj || typeof itemObj !== "object") continue;
        const rawId = (itemObj as { id?: unknown }).id;
        const id =
          typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
        const flat = this._stripListFields(
          { ...(itemObj as Record<string, unknown>), id },
          template,
        );
        const leafChanged = this._setEntitiesRaw([flat]);
        for (const n of leafChanged) changed.add(n);
        ids.push(id);

        const childEntity = this.entityRegistry.get(id);
        if (childEntity) {
          if (ownerEntity) {
            this.entityRegistry.setEntityOwner(
              childEntity,
              this._entityId(ownerEntity),
              listConfigNode,
            );
          }
          // Рекурсия во вложенные списки этого item.
          this._restoreListsRec(
            template,
            itemObj as Record<string, unknown>,
            childEntity,
            changed,
          );
        }
      }

      if (ownerEntity) {
        const els = this.entityRegistry.getOrCreateEntityListState(ownerEntity, listConfigNode);
        els.itemIds = ids;
        els.initialItemIds = [...ids];
        this._syncEntityListValuesCache(ownerEntity, listConfigNode);
        changed.add(els as unknown as object);
      } else {
        const listState = this.nodes.listStates.get(listConfigNode);
        if (listState) {
          listState.itemIds = ids;
          listState.initialItemIds = [...ids];
          this._syncListValuesCache(listConfigNode);
          changed.add(listConfigNode);
        }
      }
    }
  }

  /**
   * Вернуть поверхностную копию объекта данных entity без list-полей
   * (их состав восстанавливается отдельно через EntityListState). Иначе
   * `createEntityNode` затянул бы массив как обычный leaf-value.
   */
  private _stripListFields(
    itemObj: Record<string, unknown>,
    template: AnyConfigNode,
  ): EntityData {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(itemObj)) {
      const tField = (template as Record<string, unknown> | undefined)?.[key];
      if (Array.isArray(tField)) continue; // list-поле — пропускаем
      result[key] = itemObj[key];
    }
    return result as EntityData;
  }

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
  private walkAndSyncEntityNode(
    node: Record<string, unknown>,
    prefix: string,
    parent: object,
    changed: Set<object>,
    projectionObj?: Record<string, unknown>,
  ): void {
    // Зарегистрировать dot-path группового узла (e.g. "_entity_.u1", "_entity_.u1.address").
    // nodePaths используется в compute-подсистеме для определения «группы» листа
    // (getNodeGroupPath) и при таргетированном recompute.
    if (!this.nodes.nodePaths.has(parent)) {
      this.nodes.nodePaths.set(parent, prefix);
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      // Пропускаем примитивы (не часть entity-дерева)
      if (!child || typeof child !== "object") continue;

      const childObj = child as object;
      const childPath = `${prefix}.${key}`;

      if (isLeafNode(childObj)) {
        // ── Листовой узел (EntityLeafNode): { value: <текущее значение> } ──
        const leaf = childObj as { value: unknown };
        if (!this.nodes.nodeState.has(childObj)) {
          // Первая встреча с этим leaf — зарегистрировать в NodeRegistry:
          // - nodeState: хранит FieldState (value, isVisible, dirty, etc.)
          // - nodePaths: маппинг node → dot-path
          // - nodeParents: маппинг node → parent group
          // Все entity leaf-ы всегда visible, не обязательны, не disabled.
          this.nodes.registerDynamicLeaf(childObj, childPath, parent, {
            value: leaf.value,
            isVisible: true,
            isRequired: false,
            isDisabled: false,
            isReadOnly: false,
            dirty: false,
            revalidate: false,
          });
          // Seed initialValueMap so recomputeDirtyTargeted compares against the entity's
          // loaded value instead of `undefined` — prevents spurious dirty=true on first load.
          this.dirty.initialValueMap.set(childObj, leaf.value);
          // Привязать leaf к POJO-зеркалу через nodeSlot.
          // При следующих updateValuesCacheEntry(node, newValue)
          // значение в projectionObj обновится автоматически за O(1).
          if (projectionObj !== undefined) {
            this.values.nodeSlot.set(childObj, { parent: projectionObj, key });
            projectionObj[key] = leaf.value;
          }
          changed.add(childObj);
        } else {
          // Leaf уже зарегистрирован — проверяем, изменилось ли значение.
          // Это происходит при повторном upsert (обновление entity с сервера).
          const state = this.nodes.nodeState.get(childObj)!;
          if (state.value !== leaf.value) {
            // Обновляем nodeState напрямую (без writePipeline — это raw-запись)
            state.value = leaf.value;
            // Обновить projectionObj через nodeSlot: O(1), не нужно искать POJO.
            updateValuesCacheEntry(this.values, childObj, leaf.value);
            changed.add(childObj);
          }
          // Если значение не изменилось — leaf не попадёт в changed,
          // подписчики не будут уведомлены (оптимизация).
        }
      } else {
        // ── Групповой узел (EntityGroupNode): вложенный объект без "value" ──
        // Например: address: { city: { value: "Moscow" } }
        // Создаём вложенный POJO в projectionObj (если нужно) и рекурсируем.
        let nestedProjectionObj: Record<string, unknown> | undefined;
        if (projectionObj !== undefined) {
          if (!projectionObj[key] || typeof projectionObj[key] !== "object") {
            projectionObj[key] = {};
          }
          nestedProjectionObj = projectionObj[key] as Record<string, unknown>;
        }
        this.walkAndSyncEntityNode(
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
  private collectEntityLeaves(
    node: Record<string, unknown>,
    result: Set<object>,
  ): void {
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (!child || typeof child !== "object") continue;
      if (isLeafNode(child as object)) {
        // Leaf-нода: объект с полем "value" → добавить в результат
        result.add(child as object);
      } else {
        // Группа — рекурсивно обойти вложенные узлы
        this.collectEntityLeaves(child as Record<string, unknown>, result);
      }
    }
  }

  /**
   * Collect validation errors for entity-template fields.
   * Iterates template fields recursively, calls templateField.validate() with
   * current entity values.
   *
   * @internal
   */
  private collectEntityTemplateErrors(
    templateNode: AnyConfigNode,
    entityNode: Record<string, unknown>,
    errors: Array<{ path: string; message: string }>,
    parentPath: string,
  ): void {
    const translate = this.services.translate;
    // Построить plain-объект значений entity — передаётся вторым аргументом
    // в каждый validate(), чтобы валидатор мог проверять зависимости между полями.
    // Пример: validate: (v, vals) => vals.password !== vals.confirmPassword ? "Mismatch" : undefined
    const entityValues = this.buildEntityValuesForTemplate(entityNode);

    for (const key of configKeys(templateNode as Record<string, unknown>)) {
      const templateField = (templateNode as Record<string, unknown>)[key];
      if (!templateField || typeof templateField !== "object") continue;

      // Формируем dot-path для сообщения об ошибке (e.g. "address.city")
      const path = parentPath ? `${parentPath}.${key}` : key;

      if (isLeafNode(templateField as object)) {
        // Leaf-поле template — проверяем, есть ли validate() функция
        if (typeof (templateField as Record<string, unknown>).validate === "function") {
          // Извлечь текущее значение из entity. Приоритет:
          // 1. nodeState (актуальное значение после write pipeline)
          // 2. fallback на entityField.value (если node ещё не зарегистрирован)
          const entityField = entityNode[key];
          const currentValue =
            entityField && typeof entityField === "object"
              ? (
                  this.nodes.nodeState.get(entityField as object) as
                    | { value: unknown }
                    | undefined
                )?.value ?? (entityField as { value: unknown }).value
              : undefined;

          // Вызвать validate(currentValue, allEntityValues, translateFn).
          // Если возвращает строку — это сообщение об ошибке.
          // undefined / false = поле валидно.
          const result = (
            (templateField as Record<string, unknown>).validate as (
              v: unknown,
              vals: Record<string, unknown>,
              t: (...args: unknown[]) => string,
            ) => string | undefined | false
          )(currentValue, entityValues, translate);

          if (result) errors.push({ path, message: result });
        }
      } else {
        // Группа template — рекурсия в соответствующий вложенный узел entity.
        // Template и entity должны иметь одинаковую структуру вложенности.
        const entityField = entityNode[key];
        if (entityField && typeof entityField === "object") {
          this.collectEntityTemplateErrors(
            templateField as AnyConfigNode,
            entityField as Record<string, unknown>,
            errors,
            path,
          );
        }
      }
    }
  }

  /**
   * Build flat values object from entity node, reading from nodeState.
   * Used in template validators (collectEntityTemplateErrors).
   *
   * @internal
   */
  private buildEntityValuesForTemplate(
    entityNode: Record<string, unknown>,
  ): Record<string, unknown> {
    // Результат: plain-объект вида { id: "u1", name: "Alice", address: { city: "Moscow" } }
    const values: Record<string, unknown> = {};
    for (const key of Object.keys(entityNode)) {
      const field = entityNode[key];
      if (field && typeof field === "object") {
        if (isLeafNode(field as object)) {
          // Leaf: читаем value из nodeState (актуальное), fallback на field.value
          values[key] =
            (this.nodes.nodeState.get(field as object) as { value: unknown } | undefined)?.value ??
            (field as { value: unknown }).value;
        } else {
          // Группа: рекурсивно собрать вложенный объект
          values[key] = this.buildEntityValuesForTemplate(field as Record<string, unknown>);
        }
      }
    }
    return values;
  }
}
