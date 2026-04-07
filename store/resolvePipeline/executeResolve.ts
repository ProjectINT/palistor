import { applyPatch } from "../applyPatch/applyPatch";
import { type AnyConfigNode } from "../store/types";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
import { mergeInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import type { Resolve, ResolveDeps } from "./types";
import { applyPendingWrites } from "./applyPendingWrites";

// ─── Core execution ──────────────────────────────────────────────────────────

/**
 * Запустить resolve для заданного узла.
 *
 * Пайплайн:
 * 1. Проверить статус → если pending, вернуть существующий промис (дедупликация)
 * 2. Установить status = pending, loading = true
 * 3. Если есть optimisticResolver → запустить, применить патч (без notify, батчем)
 * 4. Обернуть values в tracking write-proxy
 * 5. Вызвать resolver(trackedValues)
 * 6. Логика повторов: при ошибке повторять до retry.attempts раз
 * 7. При успехе:
 *    - applyPatch(result) к поддереву узла
 *    - сбросить буферизованные записи (сайд-эффекты)
 *    - loading = false, status = resolved
 *    - recomputeAll (однократно)
 *    - notifyChanged (однократно)
 * 8. При ошибке (после всех повторов):
 *    - onError(error, { notify })
 *    - loading = false, status = error
 *    - recomputeAll + notifyChanged
 * 9. Сохранить accessedPaths для авто-зависимостей
 */
export function executeResolve(
  node: AnyConfigNode,
  resolve: Resolve,
  deps: ResolveDeps,
): Promise<unknown> {
  const {
    rootConfig, nodeState,
    resolveStates, recompute,
    notifyChanged, notify,
    getValues, initialValueMap,
    valuesCache, store
  } = deps;

  const state = resolveStates.get(node);

  if (!state) return Promise.resolve();

  // Дедупликация: если уже в pending, вернуть тот же промис
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  // ── Устанавливаем состояние загрузки ───────────────────────────────────────
  state.status = "pending";
  state.attempt = 0;
  state.error = null;

  // Обновляем loading в FieldState
  const nodeSt = nodeState.get(node);
  if (nodeSt) {
    nodeState.set(node, { ...nodeSt, loading: true });
  } else {
    nodeState.set(node, {
      value: undefined,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      loading: true,
    });
  }

  // ── Оптимистичный resolver (синхронный) ────────────────────────────────────
  const allChanged = new Set<object>();
  allChanged.add(node); // узел сам изменился (loading: true)

  if (resolve.optimisticResolver) {
    try {
      const values = getValues();
      const optimisticResult = resolve.optimisticResolver(values);
      if (optimisticResult && typeof optimisticResult === "object") {
        applyPatch(node, nodeState, optimisticResult as Record<string, unknown>, allChanged, valuesCache);
      }
    } catch {
      // Ошибка optimistic resolver не критична — продолжаем с async resolver
    }
  }

  // Уведомляем об изменении loading: true (и оптимистичных данных)
  recomputeAndNotify(allChanged, recompute, notifyChanged);

  // ── Выполнение async resolver ────────────────────────────────────────────
  const retryOpts = resolve.options?.retry ?? { attempts: 0, delay: 1000 };
  const maxAttempts = retryOpts.attempts;
  const retryDelay = retryOpts.delay ?? 1000;

  const promise = (async (): Promise<unknown> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      state.attempt = attempt;

      // Ждём перед повтором (кроме первой попытки)
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, retryDelay));
        // Повторная проверка: если статус изменился (например, произошёл reset) — прерываем
        if (state.status !== "pending") return;
      }

      try {
        // Создаём tracking proxy для свежего снимка values
        const freshValues = getValues();
        const tracking = createValuesTrackingProxy(freshValues);

        const result = await resolve.resolver(tracking.proxy, store);

        // Повторная проверка: если статус изменился во время ожидания — прерываем
        if (state.status !== "pending") return result;

        // ── Успешный путь ────────────────────────────────────────────────
        const changed = new Set<object>();
        changed.add(node);

        // 1. Применяем результат resolver к поддереву узла
        if (result && typeof result === "object") {
          applyPatch(node, nodeState, result as Record<string, unknown>, changed, valuesCache);
          // Обновляем начальный снимок для затронутых листьев (данные resolver = начальное состояние)
          mergeInitialValues(node, nodeState, initialValueMap, result as Record<string, unknown>);
        }

        // 2. Сбрасываем буферизованные сайд-эффекты
        const writes = tracking.getPendingWrites();

        if (writes.length > 0) {
          const writeChanged = applyPendingWrites(writes, rootConfig, nodeState, valuesCache);
          for (const n of writeChanged) changed.add(n);
        }

        // 3. Обновляем loading / status
        const updatedState = nodeState.get(node);
        if (updatedState) {
          nodeState.set(node, { ...updatedState, loading: false });
        }
        state.status = "resolved";
        state.error = null;

        // 4. Сохраняем авто-зависимости (объединяем с явными deps)
        const accessedPaths = tracking.getAccessedPaths();
        const mergedDeps = new Set<string>(resolve.deps ?? []);
        for (const p of accessedPaths) mergedDeps.add(p);
        state.dependencies = mergedDeps;

        // 5. Recompute + notify (однократно)
        recomputeAndNotify(changed, recompute, notifyChanged);

        // 6. Если зависимость изменилась пока были в pending — перезапускаем немедленно
        if (state.pendingRetrigger) {
          state.pendingRetrigger = false;
          state.status = "idle";
          state.promise = null;
          executeResolve(node, resolve, deps);
        }

        return result;
      } catch (err) {
        lastError = err;
        // Переходим к следующей попытке (если есть)
      }
    }

    // ── Путь ошибки (все попытки исчерпаны) ─────────────────────────────────
    if (state.status !== "pending") return; // прерван

    const changed = new Set<object>();

    changed.add(node);

    // Обновляем loading / status / error
    const updatedState = nodeState.get(node);
    if (updatedState) {
      nodeState.set(node, { ...updatedState, loading: false });
    }
    state.status = "error";
    state.error = lastError;

    // Вызываем обработчик onError
    try {
      resolve.onError(lastError, { notify });
    } catch {
      // onError не должен бросать исключения, но если бросил — подавляем
    }

    // Recompute + notify
    recomputeAndNotify(changed, recompute, notifyChanged);

    // Если зависимость изменилась пока были в pending — перезапускаем немедленно
    if (state.pendingRetrigger) {
      state.pendingRetrigger = false;
      state.status = "idle";
      state.promise = null;
      executeResolve(node, resolve, deps);
    }

    return undefined;
  })();

  state.promise = promise;
  return promise;
}
