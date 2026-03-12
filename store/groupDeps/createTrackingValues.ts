import { pairKey } from "./pairKey";

/**
 * Обёртка для valuesCache.values, которая перехватывает READ-доступы
 * и записывает кросс-групповые зависимости в Set.
 *
 * При чтении leaf-значения определяется группа-донор (по текущему уровню вложенности).
 * Если донор ≠ реципиент → записываем пару donor→recipient.
 *
 * @param values             — плоский объект значений из valuesCache.values
 * @param recipientGroupPath — путь группы, для которой сейчас идёт вычисление
 * @param deps               — Set для записи обнаруженных зависимостей
 * @param currentGroupPath   — текущий уровень вложенности в дереве значений (начинается с "")
 * @param subProxyCache      — WeakMap для мемоизации суб-прокси в рамках одного вызова
 */
export function createTrackingValues(
  values: Record<string, unknown>,
  recipientGroupPath: string,
  deps: Set<string>,
  currentGroupPath = "",
  subProxyCache: WeakMap<object, Record<string, unknown>> = new WeakMap(),
): Record<string, unknown> {
  return new Proxy(values, {
    get(target, key: string | symbol): unknown {
      if (typeof key === "symbol") return (target as any)[key];

      const val = (target as Record<string, unknown>)[key];

      // Вложенный объект (группа) — рекурсивный proxy с мемоизацией
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const cached = subProxyCache.get(val as object);
        if (cached) return cached;
        const childPath = currentGroupPath ? `${currentGroupPath}.${key}` : key;
        const childProxy = createTrackingValues(
          val as Record<string, unknown>,
          recipientGroupPath,
          deps,
          childPath,
          subProxyCache,
        );
        subProxyCache.set(val as object, childProxy);
        return childProxy;
      }

      // Чтение leaf-значения: донор = currentGroupPath
      if (currentGroupPath !== recipientGroupPath) {
        deps.add(pairKey(currentGroupPath, recipientGroupPath));
      }

      return val;
    },
  });
}
