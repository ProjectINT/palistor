import type { AnyConfigNode } from "./types";
import { createGroupDeps } from "../groupDeps/createGroupDeps";
import { createTrackingValues } from "../groupDeps/createTrackingValues";
import { getNodeGroupPath } from "../groupDeps/getNodeGroupPath";
import type { TrackingWrap } from "../compute/recompute";
import { isLeafNode } from "../traversal";

/**
 * Карта зависимостей между группами.
 *
 * Объединяет:
 * - `Set<string>` пар donor→recipient (межгрупповые зависимости)
 * - кэш tracking-proxy и флаг «зависимости построены»
 * - логику `createTrackingValues` при первом полном recomputeAll
 *
 * @internal используется `Palistor` и compute-пайплайнами
 */
export class GroupDepsMap {
  private readonly _deps: Set<string>;
  private readonly _proxyCache = new Map<string, Record<string, unknown>>();
  private _built = false;
  private readonly _nodeParents: WeakMap<object, object>;
  private readonly _nodePaths: WeakMap<object, string>;

  constructor(
    rootConfig: AnyConfigNode,
    nodePaths: WeakMap<object, string>,
    nodeParents: WeakMap<object, object>,
  ) {
    this._deps = createGroupDeps(rootConfig, nodePaths);
    this._nodePaths = nodePaths;
    this._nodeParents = nodeParents;
  }

  /**
   * Raw `Set<string>` пар зависимостей — для совместимости с `recomputeTargeted`
   * и другими функциями, принимающими `groupDeps` напрямую.
   * @internal
   */
  get deps(): Set<string> {
    return this._deps;
  }

  /** Были ли кросс-групповые зависимости уже построены в первом recomputeAll? */
  get isBuilt(): boolean {
    return this._built;
  }

  /**
   * Возвращает `TrackingWrap`-функцию, которая перехватывает READ-доступы
   * к значениям других групп и записывает зависимости в `deps`.
   *
   * Использовать ТОЛЬКО при первом `recomputeAll` (`isBuilt === false`).
   * После завершения вызвать `markBuilt()`.
   *
   * Принимает group-scoped values (parent из nodeSlot):
   * - Для листовых узлов: values = scope родительской группы,
   *   currentGroupPath = recipientPath (= путь родительской группы).
   * - Для групповых узлов (с isVisible и т.п.): values = scope
   *   родителя группы (grandparent scope), currentGroupPath = путь родителя.
   *   recipientPath при этом = собственный путь группы.
   *
   * Кэш использует составной ключ `currentGroupPath\0recipientPath`, чтобы
   * избежать коллизии между листовыми и групповыми узлами с одинаковым recipientPath.
   */
  getTrackingWrap(): TrackingWrap {
    return (node: object, values: Record<string, unknown>): Record<string, unknown> => {
      const isLeaf = isLeafNode(node);

      // Путь группы, ПОД которой эта compute-запись лежит в groupComputeMap —
      // именно её пересчитывает recomputeTargeted, поэтому реципиентом кросс-
      // групповой зависимости должна быть она:
      // - лист хранится под родительской группой → getNodeGroupPath(leaf) = её путь;
      // - групповой узел (isVisible и т.п.) тоже хранится под РОДИТЕЛЬСКОЙ группой,
      //   поэтому берём путь родителя, а не собственный путь узла. Иначе зависимость
      //   пишется на own-path группы, а recompute этой группы трогает только её
      //   ДЕТЕЙ — но не её собственный isVisible-энтри (он под родителем), и
      //   кросс-групповое isVisible соседа не пересчитывается.
      // `values` здесь — scope этой же родительской группы, поэтому currentGroupPath
      // (корень вложенности) совпадает с ownerGroupPath.
      const ownerGroupPath: string = isLeaf
        ? getNodeGroupPath(node, this._nodeParents, this._nodePaths)
        : (() => {
            const parent = this._nodeParents.get(node);
            return parent ? (this._nodePaths.get(parent) ?? "") : "";
          })();

      const cached = this._proxyCache.get(ownerGroupPath);
      if (cached) return cached;

      const proxy = createTrackingValues(values, ownerGroupPath, this._deps, ownerGroupPath);
      this._proxyCache.set(ownerGroupPath, proxy);
      return proxy;
    };
  }

  /**
   * Пометить зависимости как построенные и освободить proxy-кэш.
   * Вызывается ровно один раз — после первого полного `recomputeAll`.
   */
  markBuilt(): void {
    this._built = true;
    this._proxyCache.clear();
  }
}
