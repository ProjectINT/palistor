import type { EntityData } from "../entityRegistry";
import type { ListResolveConfig, ListState } from "../store/types";
import { recomputeAndNotify } from "../compute/recompute";
import type { ResolveDeps } from "./types";

// ─── List-specific deps ──────────────────────────────────────────────────────

/**
 * Дополнительные зависимости для executeListResolve.
 * Расширяет ResolveDeps с list-специфичными колбэками.
 */
export interface ListResolveDeps extends ResolveDeps {
  /**
   * Upsert entities в EntityRegistry + зарегистрировать leaf-ноды.
   * Не вызывает recompute/notifyChanged — они вызываются после.
   * Возвращает Set изменённых leaf-нод.
   */
  setEntitiesRaw: (items: EntityData[]) => Set<object>;

  /**
   * Синхронизировать valuesCache.values[listKey] с текущими itemIds.
   * Вызывается после обновления listState.itemIds.
   */
  syncListValuesCache: (listNode: object) => void;
}

// ─── Default nodeState for listNode ─────────────────────────────────────────

const DEFAULT_LIST_STATE = {
  value: undefined,
  isVisible: true,
  isRequired: false,
  isDisabled: false,
  isReadOnly: false,
  loading: false,
  dirty: false,
  revalidate: false,
} as const;

// ─── executeListResolve ──────────────────────────────────────────────────────

/**
 * Запустить resolve для ListNode.
 *
 * Отличается от executeResolve (для групп):
 * - resolver возвращает Array<EntityData> вместо Record<string, unknown>
 * - Результат → upsert entities + обновление listState.itemIds
 * - initialItemIds обновляется при успехе → dirty = false после resolve
 * - loading state хранится в nodeState для listNode (создаётся на лету)
 */
export function executeListResolve(
  listNode: object,
  resolve: ListResolveConfig,
  listState: ListState,
  deps: ListResolveDeps,
): Promise<unknown> {
  const {
    nodeState,
    resolveStates,
    recompute,
    notifyChanged,
    notify,
    setEntitiesRaw,
    syncListValuesCache,
  } = deps;

  const state = resolveStates.get(listNode);
  if (!state) return Promise.resolve();

  // Deduplication
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  state.status = "pending";
  state.attempt = 0;
  state.error = null;

  // Set loading = true on listNode's nodeState
  const nodeSt = nodeState.get(listNode);
  nodeState.set(listNode, { ...(nodeSt ?? DEFAULT_LIST_STATE), loading: true });

  // Notify about loading: true
  const loadingChanged = new Set<object>([listNode]);
  recomputeAndNotify(loadingChanged, recompute, notifyChanged);

  const promise = (async (): Promise<unknown> => {
    try {
      // Call resolver with current values snapshot
      const { getValues } = deps;
      const values = getValues();
      const result = await resolve.resolver(values);

      // Abort if state changed while awaiting (e.g. reset)
      if (state.status !== "pending") return result;

      // ── Success path ────────────────────────────────────────────────────
      const changed = new Set<object>([listNode]);

      if (Array.isArray(result) && result.length > 0) {
        // Upsert all entities (registers leaves, returns changed nodes)
        const entityChanged = setEntitiesRaw(result as EntityData[]);
        for (const n of entityChanged) changed.add(n);

        // Update itemIds from resolver result
        listState.itemIds = (result as Array<Record<string, unknown>>)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        // Save as initial snapshot for dirty tracking
        listState.initialItemIds = [...listState.itemIds];

        // Bump version → tracking proxy sees the change → React re-render
        listState.version++;

        // Sync valuesCache.values[listKey]
        syncListValuesCache(listNode);
      } else if (Array.isArray(result) && result.length === 0) {
        // Empty result — clear the list
        listState.itemIds = [];
        listState.initialItemIds = [];
        listState.version++;
        syncListValuesCache(listNode);
      }

      // Auto-deps from deps field
      if (resolve.deps) {
        state.dependencies = new Set<string>(resolve.deps);
      }

      // Update loading = false, status = resolved
      const updatedSt = nodeState.get(listNode);
      nodeState.set(listNode, { ...(updatedSt ?? DEFAULT_LIST_STATE), loading: false });
      state.status = "resolved";
      state.error = null;

      recomputeAndNotify(changed, recompute, notifyChanged);

      return result;
    } catch (err) {
      if (state.status !== "pending") return;

      // ── Error path ──────────────────────────────────────────────────────
      const updatedSt = nodeState.get(listNode);
      nodeState.set(listNode, { ...(updatedSt ?? DEFAULT_LIST_STATE), loading: false });
      state.status = "error";
      state.error = err;

      try {
        resolve.onError?.(err, { notify });
      } catch {
        // onError should not throw
      }

      recomputeAndNotify(new Set([listNode]), recompute, notifyChanged);
      return undefined;
    }
  })();

  state.promise = promise;
  return promise;
}
