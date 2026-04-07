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

  // Дедупликация
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  state.status = "pending";
  state.attempt = 0;
  state.error = null;

  // Устанавливаем loading = true в nodeState для listNode
  const nodeSt = nodeState.get(listNode);
  nodeState.set(listNode, { ...(nodeSt ?? DEFAULT_LIST_STATE), loading: true });

  // Уведомляем об изменении loading: true
  const loadingChanged = new Set<object>([listNode]);
  recomputeAndNotify(loadingChanged, recompute, notifyChanged);

  const promise = (async (): Promise<unknown> => {
    try {
      // Вызываем resolver со снимком текущих значений
      const { getValues } = deps;
      const values = getValues();
      const result = await resolve.resolver(values);

      // Прерываем, если статус изменился во время ожидания (например, reset)
      if (state.status !== "pending") return result;

      // ── Success path ────────────────────────────────────────────────────
      const changed = new Set<object>([listNode]);

      if (Array.isArray(result) && result.length > 0) {
        // Upsert всех сущностей (регистрирует листья, возвращает изменённые узлы)
        const entityChanged = setEntitiesRaw(result as EntityData[]);
        for (const n of entityChanged) changed.add(n);

        // Обновляем itemIds из результата resolver-а
        listState.itemIds = (result as Array<Record<string, unknown>>)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        // Сохраняем как начальный снимок для dirty-трекинга
        listState.initialItemIds = [...listState.itemIds];

        // Увеличиваем версию → tracking proxy видит изменение → React перерисовывается
        listState.version++;

        // Синхронизируем valuesCache.values[listKey]
        syncListValuesCache(listNode);
      } else if (Array.isArray(result) && result.length === 0) {
        // Пустой результат — очищаем список
        listState.itemIds = [];
        listState.initialItemIds = [];
        listState.version++;
        syncListValuesCache(listNode);
      }

      // Авто-зависимости из поля deps
      if (resolve.deps) {
        state.dependencies = new Set<string>(resolve.deps);
      }

      // Обновляем loading = false, status = resolved
      const updatedSt = nodeState.get(listNode);
      nodeState.set(listNode, { ...(updatedSt ?? DEFAULT_LIST_STATE), loading: false });
      state.status = "resolved";
      state.error = null;

      recomputeAndNotify(changed, recompute, notifyChanged);

      // Если зависимость изменилась пока были в pending — перезапускаем немедленно
      if (state.pendingRetrigger) {
        state.pendingRetrigger = false;
        state.status = "idle";
        state.promise = null;
        executeListResolve(listNode, resolve, listState, deps);
      }

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
        // onError не должен бросать исключения
      }

      recomputeAndNotify(new Set([listNode]), recompute, notifyChanged);

      // Если зависимость изменилась пока были в pending — перезапускаем немедленно
      if (state.pendingRetrigger) {
        state.pendingRetrigger = false;
        state.status = "idle";
        state.promise = null;
        executeListResolve(listNode, resolve, listState, deps);
      }

      return undefined;
    }
  })();

  state.promise = promise;
  return promise;
}
