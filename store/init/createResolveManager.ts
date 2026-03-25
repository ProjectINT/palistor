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
  /** Initial value snapshot — passed to resolve pipeline for dirty tracking. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
  /** The ProxyStore instance — passed as second argument to resolver. */
  store: any;
  // ─── Phase 2C: list-specific ────────────────────────────────────────────
  /** All ListState objects from NodeRegistry (for list resolve dispatch). */
  listStates: WeakMap<object, ListState>;
  /**
   * Upsert entities and register their leaves without triggering notify.
   * Called by executeListResolve after a list resolver succeeds.
   */
  setEntitiesRaw: (items: EntityData[]) => Set<object>;
  /**
   * Sync valuesCache.values[listKey] from listState.itemIds.
   * Called by executeListResolve after updating itemIds.
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
export class ResolveManager {
  /** Resolve states for all nodes with resolve config. */
  readonly states = new Map<object, ResolveState>();

  private readonly resolveEntries: AnyResolveEntry[];
  private readonly resolveEntryMap: Map<object, AnyResolveEntry>;
  private readonly resolveDeps: ResolveDeps;
  private readonly listResolveDeps: ListResolveDeps;
  private readonly listStates: WeakMap<object, ListState>;

  constructor(deps: ResolveManagerDeps) {
    const {
      rootConfig, nodeState, recompute, notifyChanged, notify,
      initialValueMap, valuesCache, store,
      listStates, setEntitiesRaw, syncListValuesCache,
    } = deps;

    this.listStates = listStates;
    this.resolveEntries = initResolveStates(rootConfig, this.states);
    this.resolveEntryMap = new Map(this.resolveEntries.map((e) => [e.node as object, e]));

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
    const entry = this.resolveEntryMap.get(node as object);
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
      for (const entry of toRetrigger) {
        resetResolveState(entry.node as AnyConfigNode, this.states);
        this._executeEntry(entry);
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

  // ─── Internal dispatch ─────────────────────────────────────────────────────

  /** Dispatch entry to the correct execute function (group vs list). */
  private _executeEntry(entry: AnyResolveEntry): void {
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

/** @deprecated Use `new ResolveManager(deps)` instead. */
export function createResolveManager(deps: ResolveManagerDeps): ResolveManager {
  return new ResolveManager(deps);
}
