import { type AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";
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
  recompute: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  notify: NotifyFn;
  /** Initial value snapshot — passed to resolve pipeline for dirty tracking. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
}

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * Менеджер resolve-подсистемы.
 *
 * Консолидирует:
 * - Инициализацию resolve-состояний (initResolveStates)
 * - triggerResolve / getResolveState
 * - Post-notify hook для retrigger по зависимостям
 * - Запуск eager resolvers (lazy: false)
 */
export class ResolveManager {
  /** Resolve states for all nodes with resolve config. */
  readonly states = new Map<object, ResolveState>();

  private readonly resolveEntries: Array<{ node: AnyConfigNode; resolve: Resolve }>;
  private readonly resolveEntryMap: Map<object, { node: AnyConfigNode; resolve: Resolve }>;
  private readonly resolveDeps: ResolveDeps;

  constructor(deps: ResolveManagerDeps) {
    const { rootConfig, nodeState, recompute, notifyChanged, notify, initialValueMap, valuesCache } = deps;

    this.resolveEntries = initResolveStates(rootConfig, this.states);
    this.resolveEntryMap = new Map(this.resolveEntries.map((e) => [e.node, e]));

    this.resolveDeps = {
      rootConfig,
      nodeState,
      resolveStates: this.states,
      recompute,
      notifyChanged,
      notify,
      getValues: () => structuredClone(valuesCache.values) as Record<string, unknown>,
      initialValueMap,
      valuesCache,
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Запустить resolve для конкретного узла (если у него есть resolve-конфиг).
   * Arrow function — сохраняет `this` при деструктуризации/передаче как callback.
   */
  triggerResolve = (node: AnyConfigNode): void => {
    const entry = this.resolveEntryMap.get(node);
    if (!entry) return;
    executeResolve(node, entry.resolve, this.resolveDeps);
  };

  /**
   * Получить текущее состояние resolve для узла.
   * Arrow function — сохраняет `this` при деструктуризации/передаче как callback.
   */
  getResolveState = (node: AnyConfigNode): ResolveState | undefined => {
    return this.states.get(node);
  };

  /**
   * Подключить retrigger resolve в notification hub.
   * Возвращает функцию-хук `(changedPaths) => void`, которую нужно
   * установить в `hub.setPostNotifyHook`.
   * Возвращает `null`, если resolve-записей нет.
   */
  createPostNotifyHook(): ((changedPaths: Set<string>) => void) | null {
    if (this.resolveEntries.length === 0) return null;

    return (changedPaths: Set<string>) => {
      const toRetrigger = findResolvesToRetrigger(
        changedPaths,
        this.states,
        this.resolveEntries,
      );
      for (const entry of toRetrigger) {
        resetResolveState(entry.node, this.states);
        executeResolve(entry.node, entry.resolve, this.resolveDeps);
      }
    };
  }

  /** Запустить eager resolvers (lazy: false). */
  launchEager(): void {
    for (const entry of this.resolveEntries) {
      const lazy = entry.resolve.options?.lazy ?? true;
      if (!lazy) {
        executeResolve(entry.node, entry.resolve, this.resolveDeps);
      }
    }
  }
}

// ─── Deprecated factory alias ─────────────────────────────────────────────────

/** @deprecated Use `new ResolveManager(deps)` instead. */
export function createResolveManager(deps: ResolveManagerDeps): ResolveManager {
  return new ResolveManager(deps);
}
