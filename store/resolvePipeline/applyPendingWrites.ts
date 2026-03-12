import { applyPatch } from "../applyPatch/applyPatch";
import { type AnyConfigNode } from "../store/types";
import { type PendingWrite } from "./createValuesTrackingProxy";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";

// ─── Применение буферизированных записей ────────────────────────────────────
//
// Это вторая половина пайплайна отложенных записей.
//
// КРАТКОЕ ОПИСАНИЕ ПОТОКА:
//   1. Резолвер запускается с прокси из createValuesTrackingProxy().
//   2. Каждое `values.x.y = z` внутри резолвера перехватывается и сохраняется как
//      PendingWrite { path: "x.y", value: z } — ничего не мутируется.
//   3. После возврата резолвера вызывается applyPendingWrites() со
//      собранным списком PendingWrite-записей.
//   4. Для каждой записи восстанавливаем вложенный патч-объект, который ожидает applyPatch(),
//      затем вызываем applyPatch() для реальной записи в хранилище.
//   5. applyPatch() фиксирует узлы конфига, которые изменились, в множество `changed`.
//   6. Вызывающий код использует `changed`, чтобы решить, какие зависимые резолверы перезапустить.

/**
 * Сбрасывает все буферизированные записи из одного запуска резолвера в реальное хранилище.
 *
 * Преобразует каждый плоский путь (через точку) обратно во вложенную структуру патча,
 * которую понимает applyPatch(), затем применяет его.
 *
 * Пример:
 *   PendingWrite { path: "user.vehicleExists", value: false }
 *   → patch = { user: { vehicleExists: false } }
 *   → applyPatch(rootConfig, nodeState, patch, changed, valuesCache)
 *
 * Несколько уровней вложенности работают аналогично:
 *   path: "a.b.c" → patch = { a: { b: { c: value } } }
 *
 * @param writes      — записи, буферизированные createValuesTrackingProxy во время выполнения резолвера
 * @param rootConfig  — корень дерева конфига полей (используется applyPatch для поиска узлов)
 * @param nodeState   — состояние узлов в рантайме (флаги dirty, ошибки и т.д.)
 * @param valuesCache — изменяемый кэш значений, который applyPatch обновляет на месте
 * @returns           — множество узлов конфига, значение которых реально изменилось (для отслеживания зависимостей)
 */
export function applyPendingWrites(
  writes: PendingWrite[],
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
): Set<object> {
  // Накапливает все узлы конфига, значение которых реально изменилось в ходе этого сброса.
  // Возвращается вызывающему коду, чтобы тот мог запланировать повторный запуск зависимых резолверов.
  const changed = new Set<object>();

  for (const { path, value } of writes) {
    // ── Восстанавливаем вложенный патч из пути через точку ──────────────────
    // applyPatch() ожидает вложенный объект, зеркалирующий дерево конфига, а не плоский путь.
    // Строим его вручную, обходя сегменты пути и вкладывая объекты друг в друга.
    //
    // Пример: path = "user.vehicleExists"
    //   parts = ["user", "vehicleExists"]
    //   После цикла: patch = { user: { vehicleExists: <value> } }
    const parts = path.split(".");
    let patch: Record<string, unknown> = {};
    let current = patch; // курсор `current` идёт вглубь строящегося вложенного объекта
    for (let i = 0; i < parts.length - 1; i++) {
      // Создаём промежуточный пустой объект для каждого сегмента пути, кроме последнего.
      current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    // Помещаем реальное значение на листе (последний сегмент).
    current[parts[parts.length - 1]] = value;

    // ── Применяем патч к реальному хранилищу ────────────────────────────────
    // applyPatch обходит rootConfig по форме патча, записывает значения в
    // valuesCache, обновляет nodeState (флаги dirty и т.д.) и фиксирует
    // в `changed` все узлы, значение которых изменилось.
    applyPatch(rootConfig, nodeState, patch, changed, valuesCache);
  }

  // Возвращаем множество изменённых узлов, чтобы пайплайн резолвов мог
  // запланировать повторные запуски для всего, что зависело от этих значений.
  return changed;
}
