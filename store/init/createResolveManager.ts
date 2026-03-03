import { collectValues, type AnyConfigNode } from "../collectValues";
import type { FieldState } from "../compute";
import {
  type Resolve,
  type NotifyFn,
  type ResolveState,
  type ResolveDeps,
  initResolveStates,
  executeResolve,
  findResolvesToRetrigger,
  resetResolveState,
} from "../resolvePipeline";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolveManagerDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  getNotifier: () => NotifyFn | null;
}

export interface ResolveManager {
  /** Запустить resolve для конкретного узла (если у него есть resolve-конфиг). */
  triggerResolve: (node: AnyConfigNode) => void;

  /** Получить текущее состояние resolve для узла. */
  getResolveState: (node: AnyConfigNode) => ResolveState | undefined;

  /**
   * Подключить retrigger resolve в notification hub.
   * Возвращает функцию-хук `(changedPaths) => void`, которую нужно
   * установить в `hub.setPostNotifyHook`.
   * Возвращает `null`, если resolve-записей нет.
   */
  createPostNotifyHook: () => ((changedPaths: Set<string>) => void) | null;

  /** Запустить eager resolvers (lazy: false). */
  launchEager: () => void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Создаёт менеджер resolve-подсистемы.
 *
 * Консолидирует:
 * - Инициализацию resolve-состояний (initResolveStates)
 * - triggerResolve / getResolveState
 * - Post-notify hook для retrigger по зависимостям
 * - Запуск eager resolvers (lazy: false)
 */
export function createResolveManager(deps: ResolveManagerDeps): ResolveManager {
  const { rootConfig, nodeState, recomputeAll, notifyChanged, getNotifier } = deps;

  // ─── Init ──────────────────────────────────────────────────────────────────

  /** Resolve states for all nodes with resolve config. */
  const resolveStates = new Map<object, ResolveState>();

  /** All resolve entries (node + resolve config). */
  const resolveEntries = initResolveStates(rootConfig, resolveStates);

  // ─── Deps for executeResolve ───────────────────────────────────────────────

  const resolveDeps: ResolveDeps = {
    rootConfig,
    nodeState,
    resolveStates,
    recomputeAll,
    notifyChanged,
    getNotifier,
    getValues: () => collectValues(rootConfig, nodeState) as Record<string, unknown>,
  };

  // ─── Public API ────────────────────────────────────────────────────────────

  function triggerResolve(node: AnyConfigNode) {
    const entry = resolveEntries.find(
      (e: { node: AnyConfigNode; resolve: Resolve }) => e.node === node,
    );
    if (!entry) return;
    executeResolve(node, entry.resolve, resolveDeps);
  }

  function getResolveState(node: AnyConfigNode): ResolveState | undefined {
    return resolveStates.get(node);
  }

  function createPostNotifyHook(): ((changedPaths: Set<string>) => void) | null {
    if (resolveEntries.length === 0) return null;

    return (changedPaths: Set<string>) => {
      const toRetrigger = findResolvesToRetrigger(
        changedPaths,
        resolveStates,
        resolveEntries,
      );
      for (const entry of toRetrigger) {
        resetResolveState(entry.node, resolveStates);
        triggerResolve(entry.node);
      }
    };
  }

  function launchEager() {
    for (const entry of resolveEntries) {
      const lazy = entry.resolve.options?.lazy ?? true;
      if (!lazy) {
        triggerResolve(entry.node);
      }
    }
  }

  return {
    triggerResolve,
    getResolveState,
    createPostNotifyHook,
    launchEager,
  };
}
