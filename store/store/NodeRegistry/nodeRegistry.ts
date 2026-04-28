import { type FieldState } from "../../compute/index";
import { registerNodes, type GroupComputeMap, type ComputeEntry, type InitialSlice } from "../registerNodes";
import { buildNodeMaps } from "../nodeMap";
import { initGroupSubmitting } from "../../init/initGroupSubmitting";
import { getNodeGroupPath } from "../../groupDeps/getNodeGroupPath";
import type { AnyConfigNode, TranslateFn, ListState } from "../types";
import { isLeafNode, isGroupNode, isListNode } from "./nodeUtils";
import { type NodeView, type NodeViewKernel, makeIdentityView } from "./nodeView";

/**
 * Реестр узлов конфига.
 *
 * Объединяет данные,
 * `Palistor`: nodeState, nodePaths, nodeParents, computeNodes,
 * groupComputeMap, proxyCache.
 *
 * Выполняет инициализацию (registerNodes + buildNodeMaps + initGroupSubmitting)
 * в конструкторе.
 *
 * @internal используется пайплайнами и подсистемами через kernel
 */
export class NodeRegistry {
  // ─── Инициализация ───────────────────────────────────────────────────────

  constructor(
    rootConfig: AnyConfigNode,
    initialValues: Record<string, unknown>,
    translate: TranslateFn,
  ) {
    // Фаза 1: регистрируем все листовые узлы, устанавливаем начальные значения
    registerNodes(
      rootConfig,
      initialValues as InitialSlice<AnyConfigNode>,
      this.computeNodes,
      this.nodeState,
      "",
      this.groupComputeMap,
      translate,
      this.listStates,
      this.allListStates,
    );

    // Фаза 2: инициализируем submitting/dirty/revalidate для групп
    initGroupSubmitting(rootConfig, this.nodeState);

    // Фаза 3: строим маппинги путей и родителей
    buildNodeMaps(rootConfig, this.nodePaths, this.nodeParents);
  }

  // ─── Данные ──────────────────────────────────────────────────────────────

  /**
   * Вычисленное состояние каждого узла конфига.
   * Ключ — объект-узел, значение — FieldState.
   */
  readonly nodeState: WeakMap<object, FieldState> = new WeakMap();

  /**
   * Абсолютный dot-путь каждого узла конфига.
   * Например, passport.number → "passport.number".
   * Корневой узел не имеет пути в этой карте (используется "").
   */
  readonly nodePaths: WeakMap<object, string> = new WeakMap();

  /**
   * Прямой родитель каждого узла конфига.
   * Корневой узел → не имеет записи.
   */
  readonly nodeParents: WeakMap<object, object> = new WeakMap();

  /**
   * Все compute-узлы в порядке обхода (DFS).
   * Содержит листовые узлы и групповые узлы с computed-свойствами.
   * Используется NotificationHub для bumpLeafVersions().
   */
  readonly computeNodes: ComputeEntry[] = [];

  /**
   * Маппинг группового узла → массив его прямых дочерних записей (листья + группы с computed-свойствами).
   * Используется recomputeTargeted для пересчёта поддерева.
   */
  readonly groupComputeMap: GroupComputeMap = new WeakMap();

  /**
   * Кэш Proxy-объектов — один прокси на узел конфига.
   * Гарантирует стабильность ссылок (===) на proxy.
   */
  readonly proxyCache: WeakMap<object, unknown> = new WeakMap();

  /**
   * ListState для каждого ListNode в конфиге.
   * Ключ — объект-массив конфига (сам ListNode).
   * Заполняется при registerNodes (Phase 2A).
   */
  readonly listStates: WeakMap<object, ListState> = new WeakMap();

  /**
   * Все ListState-объекты в порядке регистрации.
   * Используется Palistor для регистрации списков в EntityRegistry.rekey() (Phase 2C).
   */
  readonly allListStates: ListState[] = [];

  /**
   * NodeView per storage node.
   * - Config-mode: populated lazily via getView (identity views cached in _identityViews).
   * - Entity-mode: populated by Palistor._setEntitiesRaw per (entityLeaf, templateField) pair.
   *   Map key = templateField (rules); supports multiple template bindings for one entity leaf.
   */
  readonly nodeViews: WeakMap<object, Map<object, NodeView>> = new WeakMap();

  private _kernel?: NodeViewKernel;
  private readonly _identityViews: WeakMap<object, NodeView> = new WeakMap();

  /** Called by Palistor after construction to wire the kernel reference. */
  setKernel(kernel: NodeViewKernel): void {
    this._kernel = kernel;
  }

  /**
   * Get NodeView for a node.
   * - via absent → identity view (storage === rules === node), cached.
   * - via present → entity view registered by _setEntitiesRaw; throws if not found.
   */
  getView(storage: AnyConfigNode, via?: object): NodeView {
    if (via !== undefined) {
      const view = this.nodeViews.get(storage as object)?.get(via);
      if (!view) {
        throw new Error("[NodeRegistry] NodeView not found for via — register it before calling getView");
      }
      return view;
    }

    let view = this._identityViews.get(storage as object);
    if (!view) {
      if (!this._kernel) {
        throw new Error("[NodeRegistry] getView called before setKernel");
      }
      view = makeIdentityView(storage, this._kernel);
      this._identityViews.set(storage as object, view);
    }
    return view;
  }

  // ─── Навигация ───────────────────────────────────────────────────────────

  /** Получить вычисленное состояние узла. */
  getState(node: object): FieldState | undefined {
    return this.nodeState.get(node);
  }

  /** Установить состояние узла. */
  setState(node: object, state: FieldState): void {
    this.nodeState.set(node, state);
  }

  /** Получить абсолютный dot-путь узла. Для корневого — undefined. */
  getPath(node: object): string | undefined {
    return this.nodePaths.get(node);
  }

  /** Получить непосредственного родителя узла. */
  getParent(node: object): object | undefined {
    return this.nodeParents.get(node);
  }

  /**
   * Получить path группы, к которой принадлежит узел.
   * - Листовой узел → path родительской группы
   * - Групповой узел → собственный path
   * - Корневой → ""
   */
  getGroupPath(node: object): string {
    return getNodeGroupPath(node, this.nodeParents, this.nodePaths);
  }

  /** Найти узел по dot-пути. Перебирает computeNodes и проверяет их пути. */
  findByPath(path: string): object | undefined {
    for (const entry of this.computeNodes) {
      if (entry.path === path) return entry.node;
    }
    return undefined;
  }

  /** Перебрать все compute-узлы. */
  forEachCompute(callback: (entry: ComputeEntry) => void): void {
    for (const entry of this.computeNodes) {
      callback(entry);
    }
  }

  isLeafNode = isLeafNode;
  isGroupNode = isGroupNode;
  isListNode = isListNode;

  /**
   * Зарегистрировать листовой узел, созданный в runtime (например, entity leaf при store.set()).
   *
   * Обновляет все WeakMap-ы реестра и добавляет запись в `computeNodes`,
   * чтобы `bumpLeafVersions` (NotificationHub) автоматически захватил новый узел.
   *
   * @param node    Объект-узел (`{ value }`)
   * @param path    Абсолютный dot-путь, e.g. "users.0.name"
   * @param parent  Непосредственный родительский объект-узел
   * @param state   Начальное FieldState
   */
  registerDynamicLeaf(
    node: object,
    path: string,
    parent: object,
    state: import("../../compute/index").FieldState,
  ): void {
    const entry: ComputeEntry = { node: node as import("../types").AnyConfigNode, path };
    this.computeNodes.push(entry);
    this.nodeState.set(node, state);
    this.nodePaths.set(node, path);
    this.nodeParents.set(node, parent);
    // groupComputeMap: добавить в список родительской группы
    let list = this.groupComputeMap.get(parent);
    if (!list) {
      list = [];
      this.groupComputeMap.set(parent, list);
    }
    list.push(entry);
  }

  /**
   * Снять регистрацию листового узла (например, при удалении entity).
   *
   * Удаляет запись из `computeNodes` и из `groupComputeMap` родителя.
   * WeakMap-записи (nodeState, nodePaths, nodeParents) утилизируются GC автоматически.
   *
   * @param node  Листовой объект-узел
   */
  unregisterLeaf(node: object): void {
    // Удалить из computeNodes
    const idx = this.computeNodes.findIndex((e) => e.node === node);
    if (idx !== -1) {
      this.computeNodes.splice(idx, 1);
    }
    // Удалить из groupComputeMap родителя
    const parent = this.nodeParents.get(node);
    if (parent) {
      const list = this.groupComputeMap.get(parent);
      if (list) {
        const listIdx = list.findIndex((e) => e.node === node);
        if (listIdx !== -1) list.splice(listIdx, 1);
      }
    }
  }
}
