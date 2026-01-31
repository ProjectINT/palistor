/**
 * Утилиты для работы с computed полями и merge состояний
 * 
 * Адаптировано из GenericFormProvider
 */

import type { FormConfig, FieldConfig } from "../core/types";

/**
 * Глубокий merge объектов: defaults <- ...sources
 * Более поздние источники перезаписывают более ранние
 */
export function mergeState<T extends Record<string, any>>(
  defaults: T,
  ...sources: Array<Partial<T> | undefined>
): T {
  const result = { ...defaults };

  for (const source of sources) {
    if (!source) continue;

    for (const key of Object.keys(source) as Array<keyof T>) {
      const sourceValue = source[key];

      if (sourceValue === undefined) continue;

      // Если оба значения - объекты (не массивы, не null), рекурсивный merge
      if (
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key]) &&
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue)
      ) {
        result[key] = mergeState(
          result[key] as Record<string, any>,
          sourceValue as Record<string, any>
        ) as T[keyof T];
      } else {
        result[key] = sourceValue as T[keyof T];
      }
    }
  }

  return result;
}

/**
 * Материализует computed поля в конфиге
 * 
 * Если value в конфиге - функция, вызывает её с текущими values
 */
export function materializeComputed<T extends Record<string, any>>(
  values: T,
  config?: FormConfig<T>
): T {
  if (!config) return values;

  const result = { ...values };
  let hasChanges = false;

  // Рекурсивная обработка вложенных объектов
  const processLevel = (
    vals: Record<string, any>,
    cfg: Record<string, FieldConfig<any, T>>,
    target: Record<string, any>
  ) => {
    for (const key of Object.keys(cfg)) {
      const fieldCfg = cfg[key];
      
      if (!fieldCfg) continue;

      // Computed value
      if (typeof fieldCfg.value === "function") {
        const computed = fieldCfg.value(result);
        
        if (!Object.is(target[key], computed)) {
          target[key] = computed;
          hasChanges = true;
        }
      }

      // Рекурсия для вложенных полей
      if (
        fieldCfg.nested &&
        typeof vals[key] === "object" &&
        vals[key] !== null
      ) {
        if (!target[key]) {
          target[key] = {};
        }
        processLevel(vals[key], fieldCfg as any, target[key]);
      }
    }
  };

  processLevel(values, config as any, result);

  // Возвращаем тот же объект если нет изменений (для оптимизации)
  return hasChanges ? result : values;
}

/**
 * Вычисляет разницу между двумя объектами
 * Возвращает поля из current, которые отличаются от initial
 */
export function difference<T extends Record<string, any>>(
  current: T,
  initial: T
): Partial<T> {
  const diff: Partial<T> = {};

  for (const key of Object.keys(current) as Array<keyof T>) {
    if (!Object.is(current[key], initial[key])) {
      diff[key] = current[key];
    }
  }

  return diff;
}
