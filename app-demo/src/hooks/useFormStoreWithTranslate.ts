"use client";

/**
 * useFormStoreWithTranslate - версия useFormStore с явной передачей translate
 * 
 * Используется когда translate функция передаётся извне (не через next-intl внутри хука)
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type {
  FormStoreApi,
  CreateFormOptions,
  FieldProps,
  TranslateFn,
} from "@palistor/core/types";
import { registerForm, unregisterForm } from "@palistor/core/registry";
import { setPersistedState, clearPersistedState } from "@palistor/utils/persistence";

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
} from "@palistor/core/actions";

// ============================================================================
// Типы
// ============================================================================

interface UseFormStoreOptions<TValues extends Record<string, any>>
  extends Omit<CreateFormOptions<TValues>, "id"> {
  /**
   * Функция перевода (обязательна)
   */
  translate: TranslateFn;
  /**
   * Автоматически удалять форму из реестра при unmount
   */
  autoUnregister?: boolean;
}

// ============================================================================
// Хук
// ============================================================================

export function useFormStoreWithTranslate<TValues extends Record<string, any>>(
  id: string,
  options: UseFormStoreOptions<TValues>
): FormStoreApi<TValues> {
  const { autoUnregister = true, translate, ...createOptions } = options;

  // Добавляем translate в опции
  const fullOptions: CreateFormOptions<TValues> = {
    id,
    ...createOptions,
    translate,
    locale: options.locale ?? "ru",
  };

  // Регистрируем форму при первом рендере
  const entryRef = useRef(registerForm<TValues>(fullOptions));
  const entry = entryRef.current;
  const { store, config } = entry;

  // Подписываемся на изменения store через useSyncExternalStore
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
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

  const setValue = useCallback(
    <K extends keyof TValues>(key: K, value: TValues[K]) => {
      const fieldConfig = config[key];

      if (fieldConfig?.setter) {
        fieldConfig.setter(value, store.getState().values, (nextValues) => {
          store.setState((prev) =>
            setFieldValuesAction(prev, nextValues, actionCtx)
          );
        });
        return;
      }

      store.setState((prev) => setFieldValueAction(prev, key, value, actionCtx));

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
            console.error("[Palistor] onChange error:", err);
          });
      }
    },
    [store, config, actionCtx, options.onChange, state.values]
  );

  const reset = useCallback(
    (next?: Partial<TValues>) => {
      store.setState((prev) =>
        resetFormAction(prev, next, options.defaults, actionCtx)
      );

      if (options.persistId) {
        clearPersistedState(options.persistId);
      }
    },
    [store, options.defaults, options.persistId, actionCtx]
  );

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

  const validateField = useCallback(
    (key: keyof TValues) => {
      store.setState((prev) => enableShowErrors(prev, actionCtx));
    },
    [store, actionCtx]
  );

  const validateForm = useCallback((): boolean => {
    store.setState((prev) => enableShowErrors(prev, actionCtx));
    const currentState = store.getState();
    return isFormValid(currentState);
  }, [store, actionCtx]);

  const submit = useCallback(async () => {
    let vals = store.getState().values;

    if (options.beforeSubmit) {
      try {
        vals = await options.beforeSubmit(vals);
        store.setState((prev) => setFieldValuesAction(prev, vals, actionCtx));
      } catch {
        return;
      }
    }

    store.setState((prev) => enableShowErrors(prev, actionCtx));

    const currentState = store.getState();
    if (!isFormValid(currentState)) {
      return;
    }

    store.setState((prev) => setSubmitting(prev, true));

    try {
      const data = await options.onSubmit?.(currentState.values);
      await options.afterSubmit?.(data, reset);

      if (options.persistId) {
        clearPersistedState(options.persistId);
      }
    } finally {
      store.setState((prev) => setSubmitting(prev, false));
    }
  }, [store, actionCtx, options, reset]);

  const getVisibleFields = useCallback((): Array<keyof TValues & string> => {
    return getVisibleFieldKeys(store.getState());
  }, [store]);

  const getFieldProps = useCallback(
    <K extends keyof TValues>(key: K): FieldProps<TValues[K]> => {
      const currentState = store.getState();
      const fieldState = currentState.fields[key];

      if (!fieldState) {
        throw new Error(`[Palistor] No field state found for key: ${String(key)}`);
      }

      return {
        ...fieldState,
        onValueChange: (val: TValues[K]) => setValue(key, val),
        isInvalid: !!(currentState.showErrors && fieldState.error),
        errorMessage: currentState.showErrors ? fieldState.error : undefined,
        isDisabled: fieldState.isDisabled || currentState.submitting,
      };
    },
    [store, setValue]
  );

  return {
    values: state.values,
    fields: state.fields,
    errors: state.errors,
    submitting: state.submitting,
    dirty: state.dirty,
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
