import { collectValues, type AnyConfigNode } from "./collectValues";
import { applyPatch } from "./applyPatch";
import type { FieldState } from "./compute";

// ─── Типы ────────────────────────────────────────────────────────────────────

/** Зависимости pipeline — всё, что нужно для выполнения записи. */
export interface WriteDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
}

/** Результат выполнения write pipeline. */
export interface WriteResult {
  /** Все узлы, чьё состояние изменилось (для уведомления подписчиков). */
  changed: Set<object>;
  /** True если запись пропущена — значение после форматирования совпадает с текущим. */
  skipped?: boolean;
}

// ─── Фазы pipeline (чистые функции) ─────────────────────────────────────────

/**
 * Фаза 1: Форматирование входного значения.
 *
 * Если у узла есть formatter — вызывает его, передавая сырое значение
 * и текущий snapshot всех значений формы.
 * Если formatter отсутствует — возвращает значение как есть.
 *
 * Чистая функция: не мутирует nodeState, не имеет побочных эффектов.
 */
export function formatValue(
  rawValue: unknown,
  node: AnyConfigNode,
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
): unknown {
  if (typeof node.formatter !== "function") return rawValue;

  const allValues = collectValues(rootConfig, nodeState);
  return (node.formatter as (v: string | boolean, vals: Record<string, unknown>) => string | number | boolean)(
    rawValue as string | boolean,
    allValues,
  );
}

/**
 * Фаза 2: Сохранение значения в nodeState.
 *
 * Иммутабельно обновляет FieldState: создаёт новый объект с новым value.
 * Возвращает true если запись прошла, false если узел не зарегистрирован.
 */
export function storeValue(
  node: AnyConfigNode,
  processedValue: unknown,
  nodeState: WeakMap<object, FieldState>,
): boolean {
  const state = nodeState.get(node);
  if (!state) return false;

  nodeState.set(node, { ...state, value: processedValue });
  return true;
}

/**
 * Фаза 3: Применение setter (сайд-эффект записи).
 *
 * Если у узла есть setter — вызывает его с новым значением
 * и snapshot всех значений. Setter возвращает патч: вложенный объект
 * со значениями для обновления других полей.
 *
 * applyPatch рекурсивно обходит дерево конфига и применяет патч,
 * возвращая Set узлов, чьи значения были фактически изменены.
 *
 * Если setter отсутствует или вернул пустой/невалидный объект —
 * возвращает пустой Set.
 */

export type Setter = (v: unknown, vals: Record<string, unknown>, prev: unknown) => Record<string, unknown>;

export function runSetter(
  node: AnyConfigNode,
  processedValue: unknown,
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  previousValue?: unknown,
): Set<object> {
  if (typeof node.setter !== "function") return new Set();

  const allValues = collectValues(rootConfig, nodeState);
  
  const patch = (node.setter as Setter)(
    processedValue,
    allValues,
    previousValue,
  );

  if (!patch || typeof patch !== "object") return new Set();

  return applyPatch(rootConfig, nodeState, patch);
}

/**
 * Полный write pipeline: format → store → setter → recompute → merge changed.
 *
 * Объединяет все фазы записи в одну функцию.
 * Каждая фаза — отдельная чистая функция, которая тестируется независимо.
 *
 * @param node   — узел конфига, в который пишем
 * @param rawValue — сырое значение из пользовательского ввода
 * @param deps   — зависимости (rootConfig, nodeState, recomputeAll)
 * @returns WriteResult с множеством изменённых узлов, или null если запись невозможна
 */
export function writeValue(
  node: AnyConfigNode,
  rawValue: unknown,
  deps: WriteDeps,
  previousValue?: unknown,
): WriteResult | null {
  const { rootConfig, nodeState, recomputeAll } = deps;

  // Фаза 1: Форматирование
  const processedValue = formatValue(rawValue, node, rootConfig, nodeState);

  // Фаза 1.5: Проверка — значение не изменилось?
  const currentState = nodeState.get(node);
  if (currentState && Object.is(processedValue, currentState.value)) {
    return { changed: new Set<object>(), skipped: true };
  }

  // Фаза 2: Запись значения
  const stored = storeValue(node, processedValue, nodeState);

  if (!stored) return null;

  // Фаза 3: Setter — патч зависимых полей
  const patchedNodes = runSetter(node, processedValue, rootConfig, nodeState, previousValue);

  // Фаза 4: Пересчёт всех computed-свойств (validate, isVisible, …)
  const recomputedNodes = recomputeAll();

  // Фаза 5: Объединение всех изменённых узлов
  const changed = mergeChanged(node, patchedNodes, recomputedNodes);

  return { changed };
}

/**
 * Объединить все источники изменений в один Set.
 *
 * — currentNode: всегда считается изменённым (пользователь явно туда писал)
 * — patchedNodes: узлы, обновлённые setter-патчем
 * — recomputedNodes: узлы, пересчитанные recomputeAll
 */
export function mergeChanged(
  currentNode: object,
  patchedNodes: Set<object>,
  recomputedNodes: Set<object>,
): Set<object> {
  const changed = new Set(recomputedNodes);
  for (const n of patchedNodes) changed.add(n);
  changed.add(currentNode);
  return changed;
}
