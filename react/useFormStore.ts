/**
 * useFormStore - React хук для подключения к форме Palistor
 * 
 * Возвращает полный API формы с автоматической подпиской на изменения
 */

"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import type { 
  FormStoreApi, 
  FormState, 
  CreateFormOptions,
  FieldProps,
  FieldConfig,
  FormConfig,
} from "../core/types";
import { formRegistry, registerForm, unregisterForm } from "../core/registry";
import { materializeComputed } from "../utils/materialize";
import { setPersistedState, clearPersistedState } from "../utils/persistence";
import { 
  getFieldByPath, 
  setFieldByPath, 
  removeFieldByPath,
  getPathFromKey 
} from "../utils/helpers";

/**
 * Опции для useFormStore
 */
interface UseFormStoreOptions<TValues extends Record<string, any>> 
  extends Omit<CreateFormOptions<TValues>, "id"> {
  /** 
   * Автоматически удалять форму из реестра при unmount
   * По умолчанию true
   */
  autoUnregister?: boolean;
}

/**
 * Хук для работы с формой Palistor
 * 
 * @param id - уникальный идентификатор формы
 * @param options - опции создания формы (конфиг, defaults, и т.д.)
 * @returns API формы
 * 
 * @example
 * ```tsx
 * const { values, getFieldProps, submit } = useFormStore("my-form", {
 *   config: myFormConfig,
 *   defaults: { name: "", email: "" },
 *   onSubmit: async (values) => { ... }
 * });
 * ```
 */
export function useFormStore<TValues extends Record<string, any>>(
  id: string,
  options: UseFormStoreOptions<TValues>
): FormStoreApi<TValues> {
  const translate = useTranslations();
  const { autoUnregister = true, ...createOptions } = options;
  
  // Регистрируем форму при первом рендере
  const entryRef = useRef(registerForm<TValues>({ id, ...createOptions }));
  const entry = entryRef.current;
  const { store, config } = entry;

  // Подписываемся на изменения store через useSyncExternalStore
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState // SSR fallback
  );

  // Cleanup при unmount
  useEffect(() => {
    return () => {
      if (autoUnregister) {
        unregisterForm(id);
      }
    };
  }, [id, autoUnregister]);

  // Сохраняем черновик при изменении values
  useEffect(() => {
    if (options.persistId) {
      setPersistedState(options.persistId, state.values);
    }
  }, [state.values, options.persistId]);

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Установить значение поля
   */
  const setValue = useCallback(<K extends keyof TValues>(
    key: K, 
    value: TValues[K]
  ) => {
    const fieldPath = getPathFromKey(key as string);
    const cfg = getFieldByPath(config, fieldPath) as FieldConfig<any, TValues> | undefined;

    store.setState((prev) => {
      let processedValue = value;

      // Применяем formatter если есть
      if (cfg?.formatter) {
        processedValue = cfg.formatter(processedValue, prev.values);
      }

      // Если есть setter - он управляет изменением
      if (cfg?.setter) {
        // setter вызывает setValuesBulk внутри, который сам вызовет setState
        // Поэтому здесь просто возвращаем prev
        cfg.setter(processedValue, prev.values, (nextValues, fieldName) => {
          store.setState((p) => {
            let newValues = { ...p.values };
            
            for (const k of Object.keys(nextValues)) {
              const path = getPathFromKey(k);
              newValues = setFieldByPath(newValues, path, nextValues[k as keyof TValues]);
            }

            const materialized = materializeComputed(newValues, config);
            
            return {
              ...p,
              values: materialized,
              dirty: JSON.stringify(materialized) !== JSON.stringify(p.initialValues),
            };
          });
        });
        
        return prev;
      }

      const previousValue = getFieldByPath(prev.values, fieldPath);

      // No-op если значение не изменилось
      if (Object.is(previousValue, processedValue)) {
        return prev;
      }

      let newValues = setFieldByPath(prev.values, fieldPath, processedValue) as TValues;
      newValues = materializeComputed(newValues, config);

      // Live валидация после первого submit
      let newErrors = prev.errors;
      
      if (prev.showErrors) {
        newErrors = { ...prev.errors };
        const error = validateSingleField(fieldPath, newValues, config, translate);
        
        if (error) {
          newErrors = setFieldByPath(newErrors, fieldPath, error) as typeof newErrors;
        } else {
          newErrors = removeFieldByPath(newErrors, fieldPath) as typeof newErrors;
        }
      }

      // onChange callback
      if (options.onChange) {
        Promise.resolve(
          options.onChange({
            fieldKey: key,
            newValue: processedValue,
            previousValue,
            allValues: newValues,
          })
        ).then((result) => {
          if (result) {
            store.setState((p) => ({
              ...p,
              values: materializeComputed({ ...p.values, ...result }, config),
            }));
          }
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[Palistor] onChange error:", err);
        });
      }

      return {
        ...prev,
        values: newValues,
        errors: newErrors,
        dirty: JSON.stringify(newValues) !== JSON.stringify(prev.initialValues),
      };
    });
  }, [store, config, options.onChange, translate]);

  /**
   * Сбросить форму
   */
  const reset = useCallback((next?: Partial<TValues>) => {
    const merged = materializeComputed(
      { ...options.defaults, ...next } as TValues,
      config
    );

    store.setState({
      values: merged,
      errors: {},
      submitting: false,
      dirty: false,
      showErrors: false,
      initialValues: merged,
    });

    // Очищаем черновик
    if (options.persistId) {
      clearPersistedState(options.persistId);
    }
  }, [store, config, options.defaults, options.persistId]);

  /**
   * Валидация одного поля
   */
  const validateField = useCallback((key: keyof TValues) => {
    const fieldPath = getPathFromKey(key as string);

    store.setState((prev) => {
      const error = validateSingleField(fieldPath, prev.values, config, translate);
      let newErrors = { ...prev.errors };

      if (error) {
        newErrors = setFieldByPath(newErrors, fieldPath, error) as typeof newErrors;
      } else {
        newErrors = removeFieldByPath(newErrors, fieldPath) as typeof newErrors;
      }

      return { ...prev, errors: newErrors };
    });
  }, [store, config, translate]);

  /**
   * Валидация всей формы
   */
  const validateForm = useCallback((): boolean => {
    const currentState = store.getState();
    const { errors, hasErrors } = validateAllFields(currentState.values, config, translate);

    store.setState((prev) => ({
      ...prev,
      errors,
      showErrors: true,
    }));

    return !hasErrors;
  }, [store, config, translate]);

  /**
   * Отправка формы
   */
  const submit = useCallback(async () => {
    let vals = store.getState().values;

    // beforeSubmit hook
    if (options.beforeSubmit) {
      try {
        vals = await options.beforeSubmit(vals);
        vals = materializeComputed(vals, config);
      } catch {
        return;
      }
    }

    // Включаем показ ошибок
    store.setState((prev) => ({ ...prev, showErrors: true, values: vals }));

    // Валидация
    const { errors, hasErrors } = validateAllFields(vals, config, translate);
    
    store.setState((prev) => ({ ...prev, errors }));

    if (hasErrors) {
      return;
    }

    // Отправка
    store.setState((prev) => ({ ...prev, submitting: true }));

    try {
      const data = await options.onSubmit?.(vals);
      await options.afterSubmit?.(data, reset);

      // Очищаем черновик после успешной отправки
      if (options.persistId) {
        clearPersistedState(options.persistId);
      }
    } finally {
      store.setState((prev) => ({ ...prev, submitting: false }));
    }
  }, [store, config, options, translate, reset]);

  /**
   * Получить список видимых полей
   */
  const getVisibleFields = useCallback((): Array<keyof TValues & string> => {
    const visibleKeys: Array<keyof TValues & string> = [];
    const currentValues = store.getState().values;

    const processKeys = (
      cfg: FormConfig<any> | undefined, 
      vals: any, 
      prefix = ""
    ) => {
      if (!cfg) return;

      for (const k of Object.keys(cfg)) {
        const fieldCfg = cfg[k];
        const fullKey = prefix ? `${prefix}.${k}` : k;

        // Проверяем видимость
        const isVisible = fieldCfg?.isVisible === undefined
          ? true
          : typeof fieldCfg.isVisible === "function"
            ? fieldCfg.isVisible(currentValues)
            : !!fieldCfg.isVisible;

        if (!isVisible) continue;

        visibleKeys.push(fullKey as any);

        // Рекурсия для вложенных
        if (fieldCfg?.nested && typeof vals?.[k] === "object" && vals[k] !== null) {
          processKeys(fieldCfg as any, vals[k], fullKey);
        }
      }
    };

    processKeys(config, currentValues);

    return visibleKeys.length > 0 
      ? visibleKeys 
      : Object.keys(currentValues) as Array<keyof TValues & string>;
  }, [store, config]);

  /**
   * Получить пропсы для поля (HeroUI-совместимые)
   */
  const getFieldProps = useCallback(<K extends keyof TValues>(
    pathOrKey: K
  ): FieldProps<TValues[K]> => {
    const keyStr = pathOrKey as string;
    const fieldPath = getPathFromKey(keyStr);
    const currentState = store.getState();

    const currentValue = getFieldByPath(currentState.values, fieldPath) ?? "";
    const currentError = getFieldByPath(currentState.errors, fieldPath);
    const cfg = getFieldByPath(config, fieldPath) as FieldConfig<any, TValues> | undefined;

    if (!cfg) {
      throw new Error(`[Palistor] No field config found for key: ${keyStr}`);
    }

    const compute = <U>(
      rule?: U | ((vals: TValues) => U), 
      fallback?: U
    ): U | undefined => {
      if (typeof rule === "function") return (rule as any)(currentState.values);
      if (rule !== undefined) return rule as U;
      return fallback;
    };

    // Вычисляем isRequired для UI
    const computeRequiredFlag = (): boolean => {
      const r = cfg.isRequired;
      if (typeof r === "boolean") return r;
      if (typeof r === "function") {
        const res = r(currentState.values);
        return typeof res === "boolean" ? res : !!res;
      }
      if (typeof r === "string") return true;
      return false;
    };

    // Переводим label/placeholder/description
    const translateField = (
      field: string | ((t: any, s?: any) => string) | undefined
    ): string | undefined => {
      if (typeof field === "function") return field(translate, undefined);
      if (typeof field === "string") return translate(field);
      return undefined;
    };

    return {
      value: currentValue as TValues[K],
      onValueChange: (val: TValues[K]) => setValue(pathOrKey, val),
      isDisabled: 
        currentState.submitting ||
        !!compute(cfg.isReadOnly, false) ||
        !!compute(cfg.isDisabled, false),
      isReadOnly: !!compute(cfg.isReadOnly, false),
      isRequired: computeRequiredFlag(),
      isInvalid: !!(currentState.showErrors && currentError),
      errorMessage: currentState.showErrors ? (currentError as string | undefined) : undefined,
      label: translateField(cfg.label),
      placeholder: translateField(cfg.placeholder),
      description: translateField(cfg.description),
    };
  }, [store, config, translate, setValue]);

  // ============================================================================
  // Return API
  // ============================================================================

  return {
    values: state.values,
    errors: state.errors,
    submitting: state.submitting,
    dirty: state.dirty,
    setValue,
    reset,
    submit,
    validateField,
    validateForm,
    getVisibleFields,
    getFieldProps,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Валидация одного поля
 */
function validateSingleField<TValues extends Record<string, any>>(
  fieldPath: string[],
  values: TValues,
  config: FormConfig<TValues>,
  translate: (key: string) => string
): string | undefined {
  const cfg = getFieldByPath(config, fieldPath) as FieldConfig<any, TValues> | undefined;
  
  if (!cfg) return undefined;

  const fieldValue = getFieldByPath(values, fieldPath);

  // Проверка required
  const getRequiredMessage = (): string | undefined => {
    const r = cfg.isRequired;
    if (typeof r === "string") return r;
    if (typeof r === "function") {
      const res = r(values);
      return typeof res === "string" && res ? res : undefined;
    }
    return undefined;
  };

  const isEmpty = 
    fieldValue == null || 
    fieldValue === "" || 
    (Array.isArray(fieldValue) && fieldValue.length === 0);

  const requiredMessage = isEmpty ? getRequiredMessage() : undefined;

  if (requiredMessage) {
    return translate(requiredMessage);
  }

  // Custom validation
  if (cfg.validate) {
    const error = cfg.validate(fieldValue, values);
    if (error) {
      return translate(error);
    }
  }

  return undefined;
}

/**
 * Валидация всех полей формы
 */
function validateAllFields<TValues extends Record<string, any>>(
  values: TValues,
  config: FormConfig<TValues>,
  translate: (key: string) => string
): { errors: Partial<Record<keyof TValues, string>>; hasErrors: boolean } {
  const errors: Partial<Record<keyof TValues, string>> = {};
  let hasErrors = false;

  const validateLevel = (
    cfg: FormConfig<any>,
    vals: any,
    errs: any,
    path: string[] = []
  ) => {
    for (const key of Object.keys(cfg)) {
      const fieldCfg = cfg[key];
      const currentPath = [...path, key];

      // Рекурсия для вложенных
      if (fieldCfg?.nested && typeof vals[key] === "object" && vals[key] !== null) {
        if (!errs[key]) errs[key] = {};
        validateLevel(fieldCfg as any, vals[key], errs[key], currentPath);
        continue;
      }

      const error = validateSingleField(currentPath, values, config, translate);
      
      if (error) {
        errs[key] = error;
        hasErrors = true;
      }
    }
  };

  validateLevel(config, values, errors);

  return { errors, hasErrors };
}
