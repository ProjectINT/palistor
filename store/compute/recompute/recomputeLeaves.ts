import { type FieldState, computeFieldState, fieldStateChanged } from "../index";
import type { TranslateFn } from "../../store/types";
import type { ComputeEntry } from "../../store/registerNodes";
import { updateValuesCacheEntry, type ValuesCache } from "../../valuesCache/valuesCache";
import { topologicalSortComputed } from "./topologicalSortComputed";
import type { TrackingWrap } from "./types";

/**
 * Пересчитать вычисленное состояние для заданного списка листовых узлов.
 *
 * Фаза 1: Пересчитать computed-значения (value — функция) в топологическом порядке.
 * Фаза 2: Пересчитать FieldState (isVisible, isRequired, error…) для всех полей.
 *
 * Каждый узел получает group-scoped values — значения Parent-группы из nodeSlot.
 * Это позволяет конфигу писать функции в терминах своей группы (без навигации
 * от корня), даже когда конфиг вложен в глобальный store.
 * Для кросс-групповых зависимостей используется явная навигация через объект parent.
 *
 * @param trackingWrap — опциональная обёртка для отслеживания кросс-групповых зависимостей.
 *                       Если передана, group-scoped values оборачиваются через неё.
 *
 * Возвращает Set узлов, чьё состояние изменилось (для notify).
 */
export function recomputeLeaves(
  computeNodes: ComputeEntry[],
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  translate: TranslateFn,
  trackingWrap?: TrackingWrap,
): Set<object> {
  // ── Фаза 1: Пересчёт computed-значений ──────────────────────────────────
  const computedEntries = computeNodes.filter(({ node }) => typeof node.value === "function");
  const changed = new Set<object>();

  if (computedEntries.length > 0) {
    const sorted = topologicalSortComputed(computedEntries);

    for (const { node } of sorted) {
      // Получаем group-scoped values: parent-объект из nodeSlot, чтобы computed-функция
      // работала в терминах своей группы, а не глобального корня.
      const groupValues = valuesCache.nodeSlot.get(node)?.parent ?? valuesCache.values;
      const currentValues = trackingWrap ? trackingWrap(node, groupValues) : groupValues;

      const state = nodeState.get(node);
      if (!state) continue; // Узел ещё не инициализирован — пропускаем молча; Phase 2 всё равно возьмёт prev?.value ?? "".

      // Вычисляем новое значение, передавая в функцию текущий снапшот.
      // node.value здесь — selector вида (values) => values.a + values.b.
      const computedValue = (node.value as (values: Record<string, unknown>) => unknown)(currentValues);

      // Сравнение по ссылке (===): computed-функция должна возвращать стабильную ссылку,
      // если содержимое не изменилось; иначе Phase 2 излишне пересчитает downstream-узлы.
      // Если state отсутствует (узел ещё не инициализирован) — пропускаем молча;
      // Phase 2 всё равно возьмёт prev?.value ?? "".
      if (state && state.value !== computedValue) {
        nodeState.set(node, { ...state, value: computedValue });
        // Мутируем valuesCache.values in-place через slot (O(1)), чтобы узлы,
        // идущие дальше в топологическом порядке, уже видели обновлённое значение.
        updateValuesCacheEntry(valuesCache, node, computedValue);
        changed.add(node);
      }
    }
  }

  // ── Фаза 2: Пересчёт FieldState (флаги, валидация, строки) ──────────────

  for (const { node } of computeNodes) {
    const prev = nodeState.get(node);
    const currentValue = prev?.value ?? "";
    // Preserve revalidate flag: skip validation when revalidate is false
    const revalidate = prev?.revalidate ?? false;
    // Group-scoped values: config functions получают значения своей группы,
    // а не глобального корня, что позволяет писать isVisible/validate/value
    // в терминах текущего контекста независимо от глубины вложенности.
    const groupValues = valuesCache.nodeSlot.get(node)?.parent ?? valuesCache.values;
    const allValues = trackingWrap ? trackingWrap(node, groupValues) : groupValues;
    const next = computeFieldState(node, currentValue, allValues, revalidate, translate);

    // Preserve management flags that computeFieldState doesn't produce
    if (prev?.submitting !== undefined) next.submitting = prev.submitting;
    if (prev?.dirty !== undefined) next.dirty = prev.dirty;
    if (prev?.revalidate !== undefined) next.revalidate = prev.revalidate;

    // Проверяем, изменилось ли что-то
    if (prev && !fieldStateChanged(prev, next)) continue;

    nodeState.set(node, next);
    changed.add(node);
  }

  return changed;
}
