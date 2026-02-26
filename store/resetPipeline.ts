import { CONFIG_PROPS } from "./constants";
import type { AnyConfigNode } from "./collectValues";
import type { FieldState } from "./compute";
import { applyPatch } from "./applyPatch";
import { setGroupRevalidate, captureInitialValues } from "./dirtyTracking";

export interface ResetDeps {
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  /** Optional: used to update initial snapshot after reset (for dirty tracking). */
  initialValueMap?: WeakMap<object, unknown>;
}

/**
 * Рекурсивно собирает значения по умолчанию из конфига.
 *
 * Для листовых узлов берёт `value`:
 * - если не функция — значение целиком
 * - если функция (computed) — пустая строка как fallback
 *
 * Останавливается на вложенных группах, у которых есть свой `reset`
 * (граница сброса — reset boundary).
 */
function collectDefaults(node: AnyConfigNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue; // Пропускаем служебные ключи

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Листовой узел: значение по умолчанию из конфига
      const raw = child.value;
      result[key] = typeof raw === "function" ? "" : raw;
    } else {
      // Групповой узел: останавливаемся, если есть свой reset (reset boundary)
      if (typeof child.reset === "function") continue;
      result[key] = collectDefaults(child);
    }
  }

  return result;
}

/**
 * Сбросить группу (поддерево) к значениям по умолчанию.
 *
 * - Если `values` передан явно — применяется как патч.
 * - Иначе собираются defaults из конфига (до reset-boundary),
 *   и если у группы есть `reset`-трансформер, он применяется к defaults.
 *
 * After reset:
 * - revalidate = false (clear validation mode)
 * - initial snapshot updated (dirty = false)
 * - Full recompute + notify
 */
export function executeReset(
  groupNode: AnyConfigNode,
  deps: ResetDeps,
  values?: Record<string, unknown>,
): void {
  const { nodeState, recomputeAll, notifyChanged, initialValueMap } = deps;

  let patch: Record<string, unknown>;

  if (values) {
    patch = values;
  } else {
    // Собираем defaults из конфига (до reset-boundary)
    let defaults = collectDefaults(groupNode);

    // Трансформация через reset-функцию конфига (если задана)
    if (typeof groupNode.reset === "function") {
      defaults = (groupNode.reset as (v: Record<string, unknown>) => Record<string, unknown>)(
        defaults,
      );
    }

    patch = defaults;
  }

  // Применяем патч к nodeState
  const patchChanged = applyPatch(groupNode, nodeState, patch);

  // Reset revalidate to false — clear validation mode
  const revalidateChanged = setGroupRevalidate(groupNode, false, nodeState);
  for (const n of revalidateChanged) patchChanged.add(n);

  // Полный пересчёт всех вычисляемых свойств
  const recomputed = recomputeAll();
  for (const n of patchChanged) recomputed.add(n);
  notifyChanged(recomputed);

  // Update initial snapshot — after reset, dirty = false
  if (initialValueMap) {
    captureInitialValues(groupNode, nodeState, initialValueMap);
  }
}
