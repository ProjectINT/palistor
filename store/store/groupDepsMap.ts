import type { AnyConfigNode } from "./types";
import { createGroupDeps } from "../groupDeps/createGroupDeps";
import { createTrackingValues } from "../groupDeps/createTrackingValues";
import { getNodeGroupPath } from "../groupDeps/getNodeGroupPath";
import type { TrackingWrap } from "../compute/recompute";

/**
 * Карта зависимостей между группами.
 *
 * Объединяет:
 * - `Set<string>` пар donor→recipient (межгрупповые зависимости)
 * - кэш tracking-proxy и флаг «зависимости построены»
 * - логику `createTrackingValues` при первом полном recomputeAll
 *
 * @internal используется `createProxyStore` и compute-пайплайнами
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
   */
  getTrackingWrap(): TrackingWrap {
    return (node: object, values: Record<string, unknown>): Record<string, unknown> => {
      const recipientPath = getNodeGroupPath(node, this._nodeParents, this._nodePaths);
      const cached = this._proxyCache.get(recipientPath);
      if (cached) return cached;
      const proxy = createTrackingValues(values, recipientPath, this._deps);
      this._proxyCache.set(recipientPath, proxy);
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
