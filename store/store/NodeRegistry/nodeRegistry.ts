import { type FieldState } from "../../compute/index";
import { registerNodes, type GroupLeafMap, type LeafEntry, type InitialSlice } from "../registerNodes";
import { buildNodeMaps } from "../nodeMap";
import { initGroupSubmitting } from "../../init/initGroupSubmitting";
import { getNodeGroupPath } from "../../groupDeps/getNodeGroupPath";
import type { AnyConfigNode, TranslateFn } from "../types";
import { isLeaf, isGroup } from "./nodeUtils";

/**
 * Реестр узлов конфига.
 *
 * Объединяет данные,
 * `Palistor`: nodeState, nodePaths, nodeParents, leafNodes,
 * groupLeafMap, proxyCache.
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
      this.leafNodes,
      this.nodeState,
      "",
      this.groupLeafMap,
      translate,
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
   * Все листовые узлы в порядке обхода (DFS).
   * Используется NotificationHub для bumpLeafVersions.
   */
  readonly leafNodes: LeafEntry[] = [];

  /**
   * Маппинг группового узла → массив его прямых листовых записей.
   * Используется recomputeGroup для пересчёта поддерева.
   */
  readonly groupLeafMap: GroupLeafMap = new WeakMap();

  /**
   * Кэш Proxy-объектов — один прокси на узел конфига.
   * Гарантирует стабильность ссылок (===) на proxy.
   */
  readonly proxyCache: WeakMap<object, unknown> = new WeakMap();

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

  /** Найти узел по dot-пути. Перебирает leafNodes и проверяет их пути. */
  findByPath(path: string): object | undefined {
    for (const entry of this.leafNodes) {
      if (entry.path === path) return entry.node;
    }
    return undefined;
  }

  /** Перебрать все листовые узлы. */
  forEachLeaf(callback: (entry: LeafEntry) => void): void {
    for (const entry of this.leafNodes) {
      callback(entry);
    }
  }

  isLeaf = isLeaf;
  isGroup = isGroup;
}
