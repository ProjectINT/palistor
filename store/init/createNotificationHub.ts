import type { AnyConfigNode, ListState } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ComputeEntry } from "../store/registerNodes";
import { recomputeDirtyTargeted } from "../dirtyTracking/recomputeDirtyTargeted";

// ─── Types ────────────────────────────────────────────────────────────────

/** Зависимости, необходимые для пересчёта dirty-флагов при уведомлении. */
export interface DirtyDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<AnyConfigNode, FieldState>;
  initialValueMap: WeakMap<AnyConfigNode, unknown>;
  /** ListStates для dirty-tracking по составу списков (Phase 2C). */
  listStates?: WeakMap<AnyConfigNode, ListState>;
  nodeParents: WeakMap<AnyConfigNode, AnyConfigNode>;
  nodePaths: WeakMap<AnyConfigNode, string>;
}

export interface NotificationHubDeps {
  computeNodes: ComputeEntry[];
  /** Маппинг узлов на их dot-пути (заполняется buildNodeMaps). */
  nodePaths: WeakMap<object, string>;
}

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * Система уведомлений хранилища.
 *
 * Консолидирует:
 * - per-node и глобальные подписки
 * - версионирование (global + per-node)
 * - post-notify hook для внешних подсистем (resolve retrigger)
 */
export class NotificationHub {
  private readonly computeNodes: ComputeEntry[];
  private readonly nodePaths: WeakMap<object, string>;

  /** Подписчики на изменение каждого поля. */
  private readonly nodeListeners = new WeakMap<AnyConfigNode, Set<() => void>>();

  /** Глобальные подписчики — уведомляются при ЛЮБОМ изменении. */
  private readonly globalListeners = new Set<() => void>();

  /** Глобальная версия — инкрементируется при каждом изменении. */
  private version = 0;

  /** Версии отдельных узлов — для точечной подписки. */
  private readonly nodeVersions = new WeakMap<AnyConfigNode, number>();

  /** Хук, вызываемый после каждого notifyChanged (resolve retrigger и т.д.) */
  private postNotifyHook: ((changedPaths: Set<string>) => void) | null = null;

  /**
   * Re-entrancy guard: предотвращает рекурсивный вызов postNotifyHook.
   * Пути, накопленные во время активного хука, откладываются и обрабатываются
   * последовательно после завершения текущего вызова.
   */
  private isDispatchingHook = false;
  private pendingHookPaths: Set<string> | null = null;

  constructor(deps: NotificationHubDeps) {
    this.computeNodes = deps.computeNodes;
    this.nodePaths = deps.nodePaths;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private notifyNode(node: AnyConfigNode): void {
    this.nodeListeners.get(node)?.forEach((fn) => fn());
  }

  private notifyGlobals(): void {
    this.globalListeners.forEach((fn) => fn());
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Обработать набор изменённых узлов:
   * 1. Пересчитать dirty-флаги (leaf + group + root)
   * 2. Инкрементировать глобальную версию
   * 3. Обновить per-node версии + уведомить per-node подписчиков
   * 4. Уведомить глобальных подписчиков
   * 5. Вызвать postNotifyHook (retrigger resolves и т.д.)
   */
  notifyChanged(changed: Set<AnyConfigNode>, dirtyDeps: DirtyDeps): void {
    if (changed.size === 0) return;

    // Recompute dirty flags targeted to changed nodes only
    const { rootConfig, nodeState, initialValueMap, listStates, nodeParents, nodePaths } = dirtyDeps;
    const dirtyResult = recomputeDirtyTargeted(changed, rootConfig, nodeState, initialValueMap, nodeParents, nodePaths, listStates);
    for (const n of dirtyResult.changed) changed.add(n as AnyConfigNode);

    // Инкрементируем глобальную версию
    this.version++;

    // Обновляем версии изменённых узлов + уведомляем per-node подписчиков
    for (const node of changed) {
      this.nodeVersions.set(node, this.version);
      this.notifyNode(node);
    }

    // Уведомляем глобальных подписчиков
    this.notifyGlobals();

    // Post-notify hook (resolve retrigger и т.д.)
    // Re-entrancy guard: если notifyChanged вызван рекурсивно (например,
    // из executeListResolve во время postNotifyHook), пути накапливаются
    // и обрабатываются последовательно после завершения внешнего вызова.
    if (this.postNotifyHook) {
      const changedPaths = new Set<string>();
      for (const n of changed) {
        const p = this.nodePaths.get(n);
        if (p) changedPaths.add(p);
      }
      if (changedPaths.size > 0) {
        if (this.isDispatchingHook) {
          // Рекурсивный вызов: откладываем пути
          if (!this.pendingHookPaths) this.pendingHookPaths = new Set();
          for (const p of changedPaths) this.pendingHookPaths.add(p);
        } else {
          this.isDispatchingHook = true;
          try {
            this.postNotifyHook(changedPaths);
            // Дрейнируем пути, накопленные во время вызова хука
            while (this.pendingHookPaths !== null && this.pendingHookPaths.size > 0) {
              const pending = this.pendingHookPaths;
              this.pendingHookPaths = null;
              this.postNotifyHook(pending);
            }
          } finally {
            this.isDispatchingHook = false;
            this.pendingHookPaths = null;
          }
        }
      }
    }
  }

  /** Подписаться на изменения конкретного узла. */
  subscribe = (node: AnyConfigNode, listener: () => void): (() => void) => {
    if (!this.nodeListeners.has(node)) this.nodeListeners.set(node, new Set());
    this.nodeListeners.get(node)!.add(listener);
    return () => this.nodeListeners.get(node)!.delete(listener);
  };

  /** Подписаться на любое изменение в хранилище. */
  subscribeGlobal = (listener: () => void): (() => void) => {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  };

  /** Глобальная версия хранилища. */
  getVersion = (): number => {
    return this.version;
  };

  /** Версия конкретного узла. */
  getNodeVersion = (node: AnyConfigNode): number => {
    return this.nodeVersions.get(node) ?? 0;
  };

  /**
   * Инкрементировать версию для всех leaf-узлов + уведомить глобальных подписчиков.
   * Используется при смене translator — все компоненты перерендерятся.
   */
  bumpLeafVersions(): void {
    this.version++;
    for (const { node } of this.computeNodes) {
      this.nodeVersions.set(node, this.version);
    }
    this.notifyGlobals();
  }

  /**
   * Зарегистрировать хук, вызываемый после каждого notifyChanged.
   * Получает множество dot-путей изменённых узлов.
   * Используется resolve-системой для retrigger по зависимостям.
   */
  setPostNotifyHook(hook: ((changedPaths: Set<string>) => void) | null): void {
    this.postNotifyHook = hook;
  }
}

// ─── Deprecated factory alias ────────────────────────────────────────────────

/** @deprecated Use `new NotificationHub(deps)` instead. */
export function createNotificationHub(deps: NotificationHubDeps): NotificationHub {
  return new NotificationHub(deps);
}

