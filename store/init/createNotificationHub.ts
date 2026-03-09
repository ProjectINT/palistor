import type { AnyConfigNode } from "../collectValues";
import type { FieldState } from "../compute";
import { recomputeDirty } from "../dirtyTracking";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Зависимости, необходимые для пересчёта dirty-флагов при уведомлении. */
export interface DirtyDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  initialValueMap: WeakMap<object, unknown>;
}

export interface NotificationHubDeps {
  leafNodes: Array<{ node: object; path: string }>;
  /** Маппинг узлов на их dot-пути (заполняется buildNodeMaps). */
  nodePaths: WeakMap<object, string>;
}

export interface NotificationHub {
  /**
   * Обработать набор изменённых узлов:
   * 1. Пересчитать dirty-флаги (leaf + group + root)
   * 2. Инкрементировать глобальную версию
   * 3. Обновить per-node версии + уведомить per-node подписчиков
   * 4. Уведомить глобальных подписчиков
   * 5. Вызвать postNotifyHook (retrigger resolves и т.д.)
   */
  notifyChanged: (changed: Set<object>, dirtyDeps: DirtyDeps) => void;

  /** Подписаться на изменения конкретного узла. */
  subscribe: (node: object, listener: () => void) => () => void;

  /** Подписаться на любое изменение в хранилище. */
  subscribeGlobal: (listener: () => void) => () => void;

  /** Глобальная версия хранилища. */
  getVersion: () => number;

  /** Версия конкретного узла. */
  getNodeVersion: (node: object) => number;

  /**
   * Инкрементировать версию для всех leaf-узлов + уведомить глобальных подписчиков.
   * Используется при смене translator — все компоненты перерендерятся.
   */
  bumpLeafVersions: () => void;

  /**
   * Зарегистрировать хук, вызываемый после каждого notifyChanged.
   * Получает множество dot-путей изменённых узлов.
   * Используется resolve-системой для retrigger по зависимостям.
   */
  setPostNotifyHook: (hook: ((changedPaths: Set<string>) => void) | null) => void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Создаёт систему уведомлений хранилища.
 *
 * Консолидирует:
 * - per-node и глобальные подписки
 * - версионирование (global + per-node)
 * - post-notify hook для внешних подсистем (resolve retrigger)
 */
export function createNotificationHub(deps: NotificationHubDeps): NotificationHub {
  const { leafNodes, nodePaths } = deps;

  /** Подписчики на изменение каждого поля. */
  const nodeListeners = new WeakMap<object, Set<() => void>>();

  /** Глобальные подписчики — уведомляются при ЛЮБОМ изменении. */
  const globalListeners = new Set<() => void>();

  /** Глобальная версия — инкрементируется при каждом изменении. */
  let version = 0;

  /** Версии отдельных узлов — для точечной подписки. */
  const nodeVersions = new WeakMap<object, number>();

  /** Хук, вызываемый после каждого notifyChanged (resolve retrigger и т.д.) */
  let postNotifyHook: ((changedPaths: Set<string>) => void) | null = null;

  // ─── Internal helpers ────────────────────────────────────────────────────

  function notifyNode(node: object) {
    nodeListeners.get(node)?.forEach((fn) => fn());
  }

  function notifyGlobals() {
    globalListeners.forEach((fn) => fn());
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  function notifyChanged(changed: Set<object>, dirtyDeps: DirtyDeps) {
    if (changed.size === 0) return;

    // Recompute dirty flags for all nodes (leaf + group)
    const { rootConfig, nodeState, initialValueMap } = dirtyDeps;
    const dirtyResult = recomputeDirty(rootConfig, nodeState, initialValueMap);
    for (const n of dirtyResult.changed) changed.add(n);

    // Update root node dirty flag
    const rootState = nodeState.get(rootConfig);
    if (rootState && rootState.dirty !== dirtyResult.anyDirty) {
      nodeState.set(rootConfig, { ...rootState, dirty: dirtyResult.anyDirty });
      changed.add(rootConfig);
    }

    // Инкрементируем глобальную версию
    version++;

    // Обновляем версии изменённых узлов + уведомляем per-node подписчиков
    for (const node of changed) {
      nodeVersions.set(node, version);
      notifyNode(node);
    }

    // Уведомляем глобальных подписчиков
    notifyGlobals();

    // Post-notify hook (resolve retrigger и т.д.)
    if (postNotifyHook) {
      const changedPaths = new Set<string>();
      for (const n of changed) {
        const p = nodePaths.get(n);
        if (p) changedPaths.add(p);
      }
      if (changedPaths.size > 0) {
        postNotifyHook(changedPaths);
      }
    }
  }

  const subscribe = (node: object, listener: () => void): (() => void) => {
    if (!nodeListeners.has(node)) nodeListeners.set(node, new Set());
    nodeListeners.get(node)!.add(listener);
    return () => nodeListeners.get(node)!.delete(listener);
  };

  const subscribeGlobal = (listener: () => void): (() => void) => {
    globalListeners.add(listener);
    return () => globalListeners.delete(listener);
  };

  function bumpLeafVersions() {
    version++;
    for (const { node } of leafNodes) {
      nodeVersions.set(node, version);
    }
    notifyGlobals();
  }

  return {
    notifyChanged,
    subscribe,
    subscribeGlobal,
    getVersion: () => version,
    getNodeVersion: (node: object) => nodeVersions.get(node) ?? 0,
    bumpLeafVersions,
    setPostNotifyHook: (hook) => { postNotifyHook = hook; },
  };
}
