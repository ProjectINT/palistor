import { type AnyConfigNode } from "../store/types";
import type { ListState } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";
import type { EntityData } from "../entityRegistry";
import {
  type Resolve,
  type NotifyFn,
  type ResolveState,
  type ResolveDeps,
  type ListResolveDeps,
  type AnyResolveEntry,
  initResolveStates,
  executeResolve,
  executeListResolve,
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
  /** Снимок начальных значений — передаётся в resolve-пайплайн для dirty-трекинга. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
  /** Экземпляр ProxyStore — передаётся вторым аргументом в resolver. */
  store: any;
  // ─── Фаза 2C: специфика списков ─────────────────────────────────────────
  /** Все объекты ListState из NodeRegistry (для диспетчеризации list resolve). */
  listStates: WeakMap<object, ListState>;
  /**
   * Upsert-ит сущности и регистрирует их листья без вызова notify.
   * Вызывается из executeListResolve после успешного list resolver-а.
   */
  setEntitiesRaw: (items: EntityData[]) => Set<object>;
  /**
   * Синхронизирует valuesCache.values[listKey] с текущими listState.itemIds.
   * Вызывается из executeListResolve после обновления itemIds.
   */
  syncListValuesCache: (listNode: object) => void;
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
// ─── Helpers ─────────────────────────────────────────────────────────────────

function isContextSatisfied(
  contextDeps: string[] | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!contextDeps || contextDeps.length === 0) return true;
  return contextDeps.every((key) => context[key] != null);
}

// ─── Class ───────────────────────────────────────────────────────────────────

export class ResolveManager {
  /** Resolve-состояния всех узлов с resolve-конфигом. */
  readonly states = new Map<object, ResolveState>();

  private readonly resolveEntries: AnyResolveEntry[];
  private readonly resolveEntryMap: Map<AnyConfigNode, AnyResolveEntry>;
  private readonly resolveDeps: ResolveDeps;
  private readonly listResolveDeps: ListResolveDeps;
  private readonly listStates: WeakMap<object, ListState>;
  /** Entries waiting for their contextDeps to be satisfied before starting. */
  private readonly pendingContextQueue = new Set<AnyResolveEntry>();

  constructor(deps: ResolveManagerDeps) {
    const {
      rootConfig, nodeState, recompute, notifyChanged, notify,
      initialValueMap, valuesCache, store,
      listStates, setEntitiesRaw, syncListValuesCache,
    } = deps;

    this.listStates = listStates;
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
      store,
    };

    this.listResolveDeps = {
      ...this.resolveDeps,
      setEntitiesRaw,
      syncListValuesCache,
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
    this._executeEntry(entry);
  };

  /**
   * Получить текущее состояние resolve для узла.
   * Arrow function — сохраняет `this` при деструктуризации/передаче как callback.
   */
  getResolveState = (node: AnyConfigNode): ResolveState | undefined => {
    return this.states.get(node as object);
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

      // Отслеживаем узлы, которые только что запущены, чтобы не помечать их
      // pendingRetrigger в том же тике (у них уже есть новое значение зависимости).
      const justTriggeredNodes = new Set<object>(toRetrigger.map((e) => e.node as object));

      for (const entry of toRetrigger) {
        resetResolveState(entry.node as AnyConfigNode, this.states);
        this._executeEntry(entry);
      }

      // Помечаем resolver-ы, которые УЖЕ были в pending (не только что запущены),
      // чьи зависимости изменились — они перезапустятся после завершения текущей резолюции.
      for (const entry of this.resolveEntries) {
        if (justTriggeredNodes.has(entry.node as object)) continue;
        const state = this.states.get(entry.node as object);
        if (!state || state.status !== "pending") continue;
        for (const dep of state.dependencies) {
          if (changedPaths.has(dep)) {
            state.pendingRetrigger = true;
            break;
          }
        }
      }
    };
  }

  /** Запустить eager resolvers (lazy: false). */
  launchEager(): void {
    for (const entry of this.resolveEntries) {
      const lazy = entry.resolve?.options?.lazy ?? true;
      if (!lazy) {
        this._executeEntry(entry);
      }
    }
  }

  /**
   * Ретриггерить резолверы, зависящие от изменённых путей.
   * Используется из `Palistor.setContext()` для реактивного перезапуска
   * резолверов при изменении контекста.
   */
  retriggerByPaths(changedPaths: Set<string>): void {
    if (changedPaths.size === 0) return;

    const toRetrigger = findResolvesToRetrigger(
      changedPaths,
      this.states,
      this.resolveEntries,
    );

    for (const entry of toRetrigger) {
      resetResolveState(entry.node as AnyConfigNode, this.states);
      this._executeEntry(entry);
    }

    // Flush pending context queue: launch entries whose contextDeps are now satisfied
    for (const entry of this.pendingContextQueue) {
      const resolve = entry.resolve as Resolve | undefined;
      if (isContextSatisfied(resolve?.contextDeps, this.resolveDeps.store.context)) {
        this.pendingContextQueue.delete(entry);
        this._executeEntry(entry);
      }
    }
  }

  // ─── Internal dispatch ─────────────────────────────────────────────────────

  /** Диспетчеризует запись в нужную функцию выполнения (группа или список). */
  private _executeEntry(entry: AnyResolveEntry): void {
    // Phase 4 gating: если contextDeps не удовлетворены — откладываем в очередь
    const resolve = entry.resolve as Resolve | undefined;
    if (!isContextSatisfied(resolve?.contextDeps, this.resolveDeps.store.context)) {
      this.pendingContextQueue.add(entry);
      return;
    }

    if (entry.isListNode) {
      const listState = this.listStates.get(entry.node as object);
      if (listState && entry.resolve) {
        executeListResolve(
          entry.node as object,
          entry.resolve as import("../store/types").ListResolveConfig,
          listState,
          this.listResolveDeps,
        );
      }
    } else {
      executeResolve(
        (entry as { node: AnyConfigNode; resolve: Resolve }).node,
        (entry as { node: AnyConfigNode; resolve: Resolve }).resolve,
        this.resolveDeps,
      );
    }
  }
}

// ─── Deprecated factory alias ─────────────────────────────────────────────────

/** @deprecated Используйте `new ResolveManager(deps)`. */
export function createResolveManager(deps: ResolveManagerDeps): ResolveManager {
  return new ResolveManager(deps);
}
