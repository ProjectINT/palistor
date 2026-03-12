import { type AnyConfigNode } from "../store/types";
import { CONFIG_PROPS } from "../constants";
import { applyPatch } from "../applyPatch/applyPatch";
import type { FieldState } from "../compute/index";
import { updateValuesCacheEntry, type ValuesCache } from "../valuesCache/valuesCache";

// ─── Типы ────────────────────────────────────────────────────────────────────

/** Зависимости pipeline — всё, что нужно для выполнения записи. */
export interface WriteDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  /**
   * Пересчёт состояния.
   * - Без аргументов → полный recomputeAll
   * - С changedNodes → таргетированный пересчёт затронутых групп
   */
  recomputeAll: (changedNodes?: Set<object>) => Set<object>;
  /** Постоянно-актуальный кеш значений. */
  valuesCache: ValuesCache;
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
  allValues: Record<string, unknown>,
): unknown {
  if (typeof node.formatter !== "function") return rawValue;

  return (node.formatter as (v: string | boolean, vals: Record<string, unknown>) => string | number | boolean)(
    rawValue as string | boolean,
    allValues,
  );
}

/**
 * Отформатировать патч: рекурсивно обходит дерево конфига параллельно с деревом патча
 * и для каждого листового значения применяет formatter узла (если он есть).
 *
 * Возвращает новый объект-патч с отформатированными значениями.
 * Исходный patch не мутируется.
 *
 * Используется как первая фаза перед applyPatch:
 *   const formatted = formatPatch(config, nodeState, patch, rootConfig);
 *   applyPatch(config, nodeState, formatted);
 */
export function formatPatch(
  configNode: AnyConfigNode,
  patch: Record<string, unknown>,
  allValues: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(patch)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = configNode[key] as AnyConfigNode | undefined;
    if (!child || typeof child !== "object") continue;

    const patchValue = patch[key];

    if ("value" in child) {
      // Листовой узел — прогоняем через formatter
      result[key] = formatValue(patchValue, child, allValues);
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      // Групповой узел — рекурсия
      result[key] = formatPatch(child, patchValue as Record<string, unknown>, allValues);
    }
  }

  return result;
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
  valuesCache?: ValuesCache,
): boolean {
  const state = nodeState.get(node);
  if (!state) return false;

  nodeState.set(node, { ...state, value: processedValue });
  if (valuesCache) updateValuesCacheEntry(valuesCache, node, processedValue);
  return true;
}

/**
 * Фаза 3 (альтернативная ветка): Применение setter.
 *
 * Setter — альтернативный путь записи: вместо сохранения значения
 * в текущий узел, setter возвращает патч для обновления других полей.
 *
 * Вызывается ТОЛЬКО когда у узла есть setter (проверка на стороне вызывающего).
 * Если setter вернул не-объект — логирует ошибку, но не ломает рантайм.
 */

export type Setter = (v: unknown, vals: Record<string, unknown>, prev: unknown) => Record<string, unknown>;

export function runSetter(
  node: AnyConfigNode,
  processedValue: unknown,
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  previousValue?: unknown,
): Set<object> {
  const patch = (node.setter as Setter)(
    processedValue,
    valuesCache.values,
    previousValue,
  );

  if (!patch || typeof patch !== "object") {
    console.error(
      `[Palistor] setter must return an object, got ${patch === null ? "null" : typeof patch}.`,
      { node, value: processedValue },
    );
    return new Set();
  }

  return applyPatch(rootConfig, nodeState, patch, new Set(), valuesCache);
}

/**
 * Полный write pipeline: format → (setter | store) → recompute → merge changed.
 *
 * После форматирования проверяется наличие setter:
 * — Если setter есть → альтернативная запись: патч зависимых полей (storeValue НЕ вызывается).
 * — Если setter нет → прямая запись значения в текущий узел через storeValue.
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
  const { rootConfig, nodeState, recomputeAll, valuesCache } = deps;

  // Фаза 1: Форматирование
  const processedValue = formatValue(rawValue, node, valuesCache.values);

  // Фаза 1.5: Проверка — значение не изменилось?
  const currentState = nodeState.get(node);
  if (currentState && Object.is(processedValue, currentState.value)) {
    return { changed: new Set<object>(), skipped: true };
  }

  // Фаза 2: Ветвление — setter (альтернативная запись) или прямая запись
  let patchedNodes: Set<object>;

  // Всегда записываем значение в текущий узел
  const stored = storeValue(node, processedValue, nodeState, valuesCache);
  if (!stored) return null;

  if (typeof node.setter === "function") {
    // Setter-ветка: дополнительно патчит зависимые поля
    patchedNodes = runSetter(node, processedValue, rootConfig, nodeState, valuesCache, previousValue);
  } else {
    patchedNodes = new Set();
  }

  // Фаза 3: Таргетированный пересчёт затронутых групп
  const changedSoFar = new Set<object>([node]);
  for (const n of patchedNodes) changedSoFar.add(n);
  const recomputedNodes = recomputeAll(changedSoFar);

  // Фаза 4: Объединение всех изменённых узлов
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
