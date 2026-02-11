/**
 * Утилиты для работы с computed полями и merge состояний
 * 
 * Адаптировано из GenericFormProvider
 */

import type { FormConfig } from "../core/types";

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
 * Материализует вычисляемые значения в форме на основе предоставленной конфигурации.
 *
 * Рекурсивно обрабатывает конфигурацию формы:
 * - Для вычисляемых полей (value как функция) вызывает функцию с полным состоянием формы
 * - Для вложенных полей (nested: true) рекурсивно обрабатывает их дочерние поля
 * - Игнорирует ошибки вычисления, чтобы валидация могла обработать их позже
 *
 * @param form - Исходное состояние формы.
 * @param config - Конфигурация формы, определяющая поля и их значения (включая функции для вычисления).
 * @returns Новое состояние формы с материализованными вычисляемыми значениями.
 */
export function materializeComputed<T extends Record<string, any>>(
  form: T,
  config?: FormConfig<T>
): T {
  if (!config) return form;
  const next = { ...form } as T;

  /**
   * Рекурсивно обрабатывает конфигурацию и материализует вычисляемые поля.
   * @param cf - Конфигурация текущего уровня
   * @param target - Объект, который обновляется
   * @param rootForm - Корневой объект формы (для computed функций)
   */
  const processConfig = (cf: FormConfig<any>, target: any, rootForm: T) => {
    for (const key of Object.keys(cf)) {
      const cfg = (cf as any)[key];

      // Обрабатываем вложенные поля
      if (cfg?.nested && typeof target[key] === "object" && target[key] !== null) {
        // Создаем копию вложенного объекта для иммутабельности
        target[key] = { ...target[key] };
        // Рекурсивно обрабатываем дочерние поля, передавая корневую форму
        processConfig(cfg, target[key], rootForm);
      }
      // Вычисляемые поля: value - функция
      else if (typeof cfg?.value === "function") {
        try {
          // Вызываем с полным состоянием формы (rootForm), а не с текущим уровнем
          const computedResult = cfg.value(rootForm);

          if (!computedResult?.multiValues) {
            target[key] = computedResult;
          } else {
            /*
              Добавляем возможность добавлять несколько значений сразу.
              Существуют функции которые вычисляют сразу несколько полей формы
              и нужно иметь возможность сразу засетить несколько полей формы,
              для этого добавим multiValues в возвращаемый объект.
            */
            const { _multiValues, ...rest } = computedResult;
            Object.assign(target, rest);
          }
        } catch {
          // ignore compute errors; validation can handle later
        }
      }
    }
  };

  processConfig(config, next, next);

  return next;
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
