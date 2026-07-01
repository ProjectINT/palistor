import type { EntityData } from "../entityRegistry";
import type { ListResolveConfig, ListState } from "../store/types";
import { recomputeAndNotify } from "../compute/recompute";
import { createContextTrackingProxy } from "./createContextTrackingProxy";
import type { ContextTrackingResult } from "./createContextTrackingProxy";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
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
   * Phase 4: listNode передаётся для автоматического запуска entity field resolves.
   */
  setEntitiesRaw: (items: EntityData[], listNode?: object) => Set<object>;

  /**
   * Синхронизировать valuesCache с составом списка (единый метод, root + entity).
   * Вызывается после обновления listState.itemIds.
   */
  syncListValuesCache: (listState: ListState) => void;
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
    store,
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

  // Уведомляем об изменении loading: true.
  // U2: бампаем и сам ListState (новый ключ трекинга), и listNode (мост для тестов).
  const loadingChanged = new Set<object>([listNode, listState as object]);
  recomputeAndNotify(loadingChanged, recompute, notifyChanged);

  const promise = (async (): Promise<unknown> => {
    let contextTracking: ContextTrackingResult | null = null;
    let valuesTracking: ReturnType<typeof createValuesTrackingProxy> | null = null;

    try {
      // Вызываем resolver со снимком текущих значений через tracking proxy
      // для автоматической регистрации зависимостей (deps)
      const { getValues } = deps;
      const freshValues = getValues();
      valuesTracking = createValuesTrackingProxy(freshValues);

      // Оборачиваем store.context в tracking proxy для автоматических контекстных зависимостей
      contextTracking = createContextTrackingProxy(store.context);
      const storeProxy = new Proxy(store, {
        get(target, key) {
          if (key === "context") return contextTracking!.proxy;
          return (target as any)[key];
        },
      });

      const result = await resolve.resolver(valuesTracking.proxy, storeProxy);

      // Прерываем, если статус изменился во время ожидания (например, reset)
      if (state.status !== "pending") return result;

      // ── Success path ────────────────────────────────────────────────────
      // U2: ListState — ключ трекинга; listNode — мост обратной совместимости.
      const changed = new Set<object>([listNode, listState as object]);

      if (Array.isArray(result) && result.length > 0) {
        // Upsert всех сущностей (регистрирует листья, возвращает изменённые узлы)
        // Pass listNode so that entity field resolves are triggered automatically (Phase 4).
        const entityChanged = setEntitiesRaw(result as EntityData[], listNode);
        for (const n of entityChanged) changed.add(n);

        // Обновляем itemIds из результата resolver-а
        listState.itemIds = (result as Array<Record<string, unknown>>)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        // Сохраняем как начальный снимок для dirty-трекинга
        listState.initialItemIds = [...listState.itemIds];

        // Синхронизируем valuesCache.values[listKey]
        syncListValuesCache(listState);
      } else if (Array.isArray(result) && result.length === 0) {
        // Пустой результат — очищаем список
        listState.itemIds = [];
        listState.initialItemIds = [];
        syncListValuesCache(listState);
      }

      // Авто-зависимости: явные deps + values tracking + контекстные зависимости
      const mergedDeps = new Set<string>(resolve.deps ?? []);
      for (const p of valuesTracking.getAccessedPaths()) mergedDeps.add(p);
      if (contextTracking) {
        for (const key of contextTracking.getAccessedKeys()) {
          mergedDeps.add(`$context.${key}`);
        }
      }
      state.dependencies = mergedDeps;

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

      // Сохраняем контекстные зависимости даже в случае ошибки
      {
        const mergedDeps = new Set<string>(resolve.deps ?? []);
        if (valuesTracking) {
          for (const p of valuesTracking.getAccessedPaths()) mergedDeps.add(p);
        }
        if (contextTracking) {
          for (const key of contextTracking.getAccessedKeys()) {
            mergedDeps.add(`$context.${key}`);
          }
        }
        state.dependencies = mergedDeps;
      }

      try {
        resolve.onError?.(err, { notify });
      } catch {
        // onError не должен бросать исключения
      }

      recomputeAndNotify(new Set([listNode, listState as object]), recompute, notifyChanged);

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
