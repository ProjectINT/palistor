/**
 * useFormStore - React хук для подключения к форме Palistor
 *
 * Возвращает полный API формы с автоматической подпиской на изменения.
 * Использует новую архитектуру с fields и dependencies.
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
  TranslateFn,
  ComputedFieldState,
} from "../core/types";
import { formRegistry, registerForm, unregisterForm } from "../core/registry";
import { setPersistedState, clearPersistedState } from "../utils/persistence";
import {
  getFieldByPath,
  setFieldByPath,
  removeFieldByPath,
  getPathFromKey,
} from "../utils/helpers";

// Actions — чистые функции для работы с состоянием
import {
  setFieldValue as setFieldValueAction,
  setFieldValues as setFieldValuesAction,
  resetForm as resetFormAction,
  setFormLocale as setFormLocaleAction,
  enableShowErrors,
  setSubmitting,
  isFormValid,
  getVisibleFieldKeys,
  type ActionContext,
} from "../core/actions";
import { defaultTranslate } from "../core/computeFields";

// ============================================================================
// Типы
// ============================================================================

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

// ============================================================================
// Хук
// ============================================================================

/**
 * Хук для работы с формой Palistor
 *
 * @param id - уникальный идентификатор формы
 * @param options - опции создания формы (конфиг, defaults, и т.д.)
 * @returns API формы
 *
 * @example
 * ```tsx
 * const form = useFormStore("payment", {
 *   config: paymentConfig,
 *   defaults: { paymentType: "card", cardNumber: "" },
 *   onSubmit: async (values) => { await api.pay(values); }
 * });
 *
 * // Доступ к полям
 * const cardField = form.fields.cardNumber;
 * if (cardField.isVisible) {
 *   return <Input {...form.getFieldProps("cardNumber")} />;
 * }
 * ```
 */
export function useFormStore<TValues extends Record<string, any>>(
  id: string,
  options: UseFormStoreOptions<TValues>
): FormStoreApi<TValues> {
  // Получаем translate из next-intl
  const nextIntlTranslate = useTranslations();

  // Создаём TranslateFn из next-intl
  const translate: TranslateFn = useCallback(
    (key: string, params?: Record<string, any>) => {
      try {
        return nextIntlTranslate(key, params);
      } catch {
        // Если ключ не найден, возвращаем его как есть
        return key;
      }
    },
    [nextIntlTranslate]
  );

  const { autoUnregister = true, ...createOptions } = options;

  // Добавляем translate в опции
  const fullOptions: CreateFormOptions<TValues> = {
    id,
    ...createOptions,
    translate,
    locale: options.locale ?? "en",
  };

  // Регистрируем форму при первом рендере
  const entryRef = useRef(registerForm<TValues>(fullOptions));
  const entry = entryRef.current;
  const { store, config } = entry;

  // Подписываемся на изменения store через useSyncExternalStore
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState // SSR fallback
  );

  // Создаём ActionContext
  const actionCtx: ActionContext<TValues> = {
    config,
    translate,
    locale: state.locale,
  };

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
  const setValue = useCallback(
    <K extends keyof TValues>(key: K, value: TValues[K]) => {
      const fieldConfig = config[key];

      // Если есть setter — используем его (для связанных изменений)
      if (fieldConfig?.setter) {
        fieldConfig.setter(value, store.getState().values, (nextValues) => {
          store.setState((prev) =>
            setFieldValuesAction(prev, nextValues, actionCtx)
          );
        });
        return;
      }

      // Обычное обновление через чистую функцию
      store.setState((prev) => setFieldValueAction(prev, key, value, actionCtx));

      // onChange callback (async)
      if (options.onChange) {
        const currentState = store.getState();
        const previousValue = state.values[key];

        Promise.resolve(
          options.onChange({
            fieldKey: key,
            newValue: value,
            previousValue,
            allValues: currentState.values,
          })
        )
          .then((result) => {
            if (result) {
              store.setState((prev) =>
                setFieldValuesAction(prev, result, actionCtx)
              );
            }
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error("[Palistor] onChange error:", err);
          });
      }
    },
    [store, config, actionCtx, options.onChange, state.values]
  );

  /**
   * Сбросить форму
   */
  const reset = useCallback(
    (next?: Partial<TValues>) => {
      store.setState((prev) =>
        resetFormAction(prev, next, options.defaults, actionCtx)
      );

      // Очищаем черновик
      if (options.persistId) {
        clearPersistedState(options.persistId);
      }
    },
    [store, options.defaults, options.persistId, actionCtx]
  );

  /**
   * Изменить локаль
   */
  const setLocale = useCallback(
    (newLocale: string) => {
      const newCtx: ActionContext<TValues> = {
        ...actionCtx,
        locale: newLocale,
      };
      store.setState((prev) => setFormLocaleAction(prev, newLocale, newCtx));
    },
    [store, actionCtx]
  );

  /**
   * Валидация одного поля (запускает пересчёт)
   */
  const validateField = useCallback(
    (key: keyof TValues) => {
      // Просто перезаписываем значение — это запустит пересчёт с валидацией
      store.setState((prev) => {
        // Включаем показ ошибок и пересчитываем
        const withErrors = enableShowErrors(prev, actionCtx);
        return withErrors;
      });
    },
    [store, actionCtx]
  );

  /**
   * Валидация всей формы
   */
  const validateForm = useCallback((): boolean => {
    // Включаем показ ошибок — это пересчитает все fields с валидацией
    store.setState((prev) => enableShowErrors(prev, actionCtx));

    // Проверяем результат
    const currentState = store.getState();
    return isFormValid(currentState);
  }, [store, actionCtx]);

  /**
   * Отправка формы
   */
  const submit = useCallback(async () => {
    let vals = store.getState().values;

    // beforeSubmit hook
    if (options.beforeSubmit) {
      try {
        vals = await options.beforeSubmit(vals);
        // Обновляем values если они изменились
        store.setState((prev) => setFieldValuesAction(prev, vals, actionCtx));
      } catch {
        return;
      }
    }

    // Включаем показ ошибок и валидируем
    store.setState((prev) => enableShowErrors(prev, actionCtx));

    const currentState = store.getState();
    if (!isFormValid(currentState)) {
      return;
    }

    // Отправка
    store.setState((prev) => setSubmitting(prev, true));

    try {
      const data = await options.onSubmit?.(currentState.values);
      await options.afterSubmit?.(data, reset);

      // Очищаем черновик после успешной отправки
      if (options.persistId) {
        clearPersistedState(options.persistId);
      }
    } finally {
      store.setState((prev) => setSubmitting(prev, false));
    }
  }, [store, actionCtx, options, reset]);

  /**
   * Получить список видимых полей
   */
  const getVisibleFields = useCallback((): Array<keyof TValues & string> => {
    return getVisibleFieldKeys(store.getState());
  }, [store]);

  /**
   * Получить пропсы для UI компонента (HeroUI-совместимые)
   */
  const getFieldProps = useCallback(
    <K extends keyof TValues>(key: K): FieldProps<TValues[K]> => {
      const currentState = store.getState();
      const fieldState = currentState.fields[key];

      if (!fieldState) {
        throw new Error(`[Palistor] No field state found for key: ${String(key)}`);
      }

      // Расширяем ComputedFieldState до FieldProps
      return {
        ...fieldState,
        onValueChange: (val: TValues[K]) => setValue(key, val),
        isInvalid: !!(currentState.showErrors && fieldState.error),
        errorMessage: currentState.showErrors ? fieldState.error : undefined,
        // Добавляем isDisabled при submitting
        isDisabled: fieldState.isDisabled || currentState.submitting,
      };
    },
    [store, setValue]
  );

  // ============================================================================
  // Return API
  // ============================================================================

  return {
    // Данные
    values: state.values,
    fields: state.fields,
    errors: state.errors,
    submitting: state.submitting,
    dirty: state.dirty,

    // Actions
    setValue,
    reset,
    setLocale,
    submit,
    validateField,
    validateForm,
    getVisibleFields,
    getFieldProps,
  };
}
