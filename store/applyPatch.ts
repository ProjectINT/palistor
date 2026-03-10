import { CONFIG_PROPS } from "./constants";
import type { AnyConfigNode } from "./collectValues";
import type { FieldState } from "./compute";

/**
 * Применить патч (результат setter) к nodeState.
 *
 * Рекурсивно обходит дерево конфига параллельно с деревом патча.
 * Для каждого ключа патча:
 *   - Листовой узел (есть "value") → обновляет value в nodeState,
 *     если оно реально изменилось (строгое !==).
 *   - Групповой узел → рекурсия вглубь.
 *
 * Возвращает Set узлов, значения которых были фактически изменены.
 * Это позволяет вызывающему коду точно знать, кого уведомить.
 */
export function applyPatch(
  configNode: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  patch: Record<string, unknown>,
  changed: Set<object>,
): Set<object> {
  for (const key of Object.keys(patch)) {
    // Пропускаем служебные ключи конфига (value, label, validate, …)
    if (CONFIG_PROPS.has(key)) continue;

    const child = configNode[key] as AnyConfigNode | undefined;

    if (!child || typeof child !== "object") continue;

    const patchValue = patch[key];

    if ("value" in child) {
      // Листовой узел — обновляем value только если оно реально изменилось
      const state = nodeState.get(child);

      if (state && state.value !== patchValue) {
        nodeState.set(child, { ...state, value: patchValue });
        changed.add(child);
      }
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      // Групповой узел — рекурсия
      applyPatch(child, nodeState, patchValue as Record<string, unknown>, changed);
    }
  }

  return changed;
}
