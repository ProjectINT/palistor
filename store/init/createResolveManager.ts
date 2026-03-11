import { type AnyConfigNode } from "../types";
import type { FieldState } from "../compute";
import type { ValuesCache } from "../valuesCache";
import {
  type Resolve,
  type NotifyFn,
  type ResolveState,
  type ResolveDeps,
  initResolveStates,
  executeResolve,
  findResolvesToRetrigger,
  resetResolveState,
} from "../resolvePipeline/index";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolveManagerDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  notify: NotifyFn;
  /** Initial value snapshot — passed to resolve pipeline for dirty tracking. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
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
  const { rootConfig, nodeState, recomputeAll, notifyChanged, notify, initialValueMap, valuesCache } = deps;

  // ─── Init ──────────────────────────────────────────────────────────────────

  /** Resolve states for all nodes with resolve config. */
  const resolveStates = new Map<object, ResolveState>();

  /** All resolve entries (node + resolve config). */
  const resolveEntries = initResolveStates(rootConfig, resolveStates);

  /** Map for O(1) lookup in triggerResolve. */
  const resolveEntryMap = new Map<object, { node: AnyConfigNode; resolve: Resolve }>(
    resolveEntries.map((e) => [e.node, e]),
  );

  // ─── Deps for executeResolve ───────────────────────────────────────────────

  const resolveDeps: ResolveDeps = {
    rootConfig,
    nodeState,
    resolveStates,
    recomputeAll,
    notifyChanged,
    notify,
    getValues: () => structuredClone(valuesCache.values) as Record<string, unknown>,
    initialValueMap,
    valuesCache,
  };

  // ─── Public API ────────────────────────────────────────────────────────────

  function triggerResolve(node: AnyConfigNode) {
    const entry = resolveEntryMap.get(node);
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
        executeResolve(entry.node, entry.resolve, resolveDeps);
      }
    };
  }

  function launchEager() {
    for (const entry of resolveEntries) {
      const lazy = entry.resolve.options?.lazy ?? true;
      if (!lazy) {
        executeResolve(entry.node, entry.resolve, resolveDeps);
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
