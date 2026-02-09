/**
 * createForm — фабрика для создания типизированных форм
 *
 * Вызывается на уровне модуля — задаёт **статическую конфигурацию** формы
 * (поля, дефолты, валидации, зависимости). Возвращает типизированный `useForm` хук.
 *
 * @example
 * ```ts
 * // config/orderForm.ts
 * import { createForm } from 'palistor';
 * import { useTranslations } from 'next-intl';
 *
 * export const { useForm } = createForm<OrderValues>({
 *   config: orderConfig,
 *   defaults: orderDefaults,
 *   translateFunction: useTranslations,
 *   type: "Order",
 * });
 * ```
 *
 * ```tsx
 * // Корневой компонент
 * const { getFieldProps, submit } = useForm(order?.id ?? "NewOrder", {
 *   initial: order,
 *   onSubmit: async (values) => { ... },
 * });
 *
 * // Вложенный компонент
 * const { getFieldProps } = useForm(orderId);
 * ```
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import type {
  FormConfig,
  FormState,
  FieldProps,
  TranslateFn,
  InputValueType,
  ComputedFieldState,
} from "./types";
import { createStore } from "./createStore";
import type { Store } from "./types";
import { mergeState } from "../utils/materialize";
import {
  getPersistedState,
  setPersistedState,
  clearPersistedState,
} from "../utils/persistence";
import { parseValue } from "../utils/parser";


import { createInitialState, type ActionContext } from "./actions/createInitialState";
// import { createComputeContext } from "./actions/createComputeContext";
import { enableShowErrors } from "./actions/enableShowErrors";
import { resetForm } from "./actions/resetForm";
import { setFieldValue } from "./actions/setFieldValue";
import { setFieldValues } from "./actions/setFieldValues";
import { setFormLocale } from "./actions/setFormLocale";
import { setSubmitting } from "./actions/setSubmitting";
import { isFormValid } from "./actions/isFormValid";
import { getVisibleFieldKeys } from "./actions/getVisibleFieldKeys";

import { defaultTranslate } from "./computeFields";


// ============================================================================
// Типы
// ============================================================================

/**
 * Конфигурация для createForm (модульный уровень)
 */
export interface CreateFormConfig<TValues extends Record<string, any>> {
  /** Конфигурация полей */
  config: FormConfig<TValues>;

  /** Значения по умолчанию */
  defaults: TValues;

  /**
   * Ссылка на хук i18n (например useTranslations).
   * Вызывается внутри useForm, в React-контексте.
   * Если не указан — используется defaultTranslate (key => key).
   */
  translateFunction?: () => TranslateFn | ((key: string, params?: Record<string, any>) => string);

  /**
   * Тип формы — для уникального ключа в registry.
   * Registry key = "type:id", например "Order:NewOrder"
   */
  type: string;
}

/**
 * Опции для useForm (React-уровень)
 */
export interface UseFormOptions<TValues extends Record<string, any>> {
  /** Данные с сервера — мержатся в store при каждом изменении ссылки */
  initial?: Partial<TValues>;

  /** Отправка формы */
  onSubmit?: (values: TValues) => Promise<any> | void;

  /** Трансформация перед валидацией и отправкой */
  beforeSubmit?: (values: TValues) => Promise<TValues> | TValues;

  /** Сайд-эффекты после успешного submit */
  afterSubmit?: (result: any, reset: () => void) => Promise<void> | void;

  /**
   * Вызывается при изменении любого поля ПОСЛЕ пересчёта computed.
   * Можно вернуть Partial для мержа в values.
   */
  onChange?: (params: {
    fieldKey: keyof TValues;
    newValue: any;
    previousValue: any;
    allValues: TValues;
  }) => Partial<TValues> | void | Promise<Partial<TValues> | void>;

  /** Переопределить авто-persist key (по умолчанию type:id) */
  persistId?: string;
}

/**
 * API возвращаемый useForm
 */
export interface UseFormReturn<TValues extends Record<string, any>> {
  /** Получить пропсы поля (хук — вызывает useSyncExternalStore) */
  getFieldProps: <K extends keyof TValues>(key: K) => FieldProps<TValues[K]>;

  /** Установить значение поля */
  setValue: <K extends keyof TValues>(key: K, value: TValues[K]) => void;

  /** Установить несколько значений */
  setValues: (values: Partial<TValues>) => void;

  /** Сбросить форму */
  reset: (next?: Partial<TValues>) => void;

  /** Отправить форму */
  submit: () => Promise<void>;

  /** Форма изменена */
  dirty: boolean;

  /** Форма отправляется */
  submitting: boolean;

  /** Форма валидна (нет ошибок в видимых полях) */
  isValid: boolean;

  /** Получить список видимых полей */
  getVisibleFields: () => Array<keyof TValues & string>;

  /** Текущие значения (для отладки / превью) */
  values: TValues;

  /** Текущие ошибки */
  errors: Partial<Record<keyof TValues, string>>;

  /** Computed поля */
  fields: { [K in keyof TValues]: ComputedFieldState<TValues[K]> };
}

// ============================================================================
// Registry — хранение stores по type:id
// ============================================================================

const storeRegistry = new Map<
  string,
  {
    store: Store<FormState<any>>;
    config: FormConfig<any>;
    defaults: any;
    refCount: number;
  }
>();

function getRegistryKey(type: string, id: string): string {
  return `${type}:${id}`;
}

// ============================================================================
// createForm
// ============================================================================

/**
 * Создаёт типизированную форму с хуком useForm.
 *
 * Вызывается на уровне модуля (config/orderForm.ts).
 * Возвращает `{ useForm }` — хук для React-компонентов.
 */
export function createForm<TValues extends Record<string, any>>(
  formConfig: CreateFormConfig<TValues>
): { useForm: (id: string, options?: UseFormOptions<TValues>) => UseFormReturn<TValues> } {
  const { config, defaults, translateFunction, type } = formConfig;

  /**
   * useForm — React-хук для работы с формой
   *
   * @param id — ID экземпляра ("NewOrder", order.id, и т.д.)
   * @param options — опции (initial, onSubmit, onChange, ...). Корневой компонент передаёт options, вложенные — нет.
   */
  function useForm(
    id: string,
    options?: UseFormOptions<TValues>
  ): UseFormReturn<TValues> {
    const registryKey = getRegistryKey(type, id);
    const persistKey = options?.persistId ?? registryKey;

    // ====================================================================
    // Получаем translate через translateFunction (вызываем хук i18n)
    // ====================================================================
    let translate: TranslateFn = defaultTranslate;
    if (translateFunction) {
      try {
        const t = translateFunction();
        translate = (key: string, params?: Record<string, any>) => {
          try {
            return (t as any)(key, params);
          } catch {
            return key;
          }
        };
      } catch {
        // translateFunction может быть недоступен (SSR без провайдера)
      }
    }

    // ====================================================================
    // Refs для колбэков (всегда актуальная версия)
    // ====================================================================
    const onSubmitRef = useRef(options?.onSubmit);
    onSubmitRef.current = options?.onSubmit;

    const beforeSubmitRef = useRef(options?.beforeSubmit);
    beforeSubmitRef.current = options?.beforeSubmit;

    const afterSubmitRef = useRef(options?.afterSubmit);
    afterSubmitRef.current = options?.afterSubmit;

    const onChangeRef = useRef(options?.onChange);
    onChangeRef.current = options?.onChange;

    const translateRef = useRef(translate);
    translateRef.current = translate;

    // ====================================================================
    // Создаём или находим store в registry
    // ====================================================================
    const entryRef = useRef<{
      store: Store<FormState<TValues>>;
      key: string;
    } | null>(null);

    if (!entryRef.current || entryRef.current.key !== registryKey) {
      let existing = storeRegistry.get(registryKey);

      if (existing) {
        existing.refCount++;
      } else {
        // Создаём store из defaults
        const persisted = getPersistedState<Partial<TValues>>(persistKey);
        const mergedValues = mergeState(defaults, persisted as Partial<TValues>);

        const ctx: ActionContext<TValues> = {
          config,
          translate,
          locale: "auto",
        };

        const initialState = createInitialState(mergedValues, undefined, ctx);

        const store = createStore<FormState<TValues>>(initialState);

        existing = {
          store,
          config,
          defaults,
          refCount: 1,
        };

        storeRegistry.set(registryKey, existing);
      }

      entryRef.current = { store: existing.store as Store<FormState<TValues>>, key: registryKey };
    }

    const store = entryRef.current.store;

    // ====================================================================
    // Мерж initial данных (при изменении ссылки)
    // ====================================================================
    const prevInitialRef = useRef<Partial<TValues> | undefined>(undefined);

    if (options?.initial && !Object.is(prevInitialRef.current, options.initial)) {
      prevInitialRef.current = options.initial;

      // Мержим initial в store, не перезаписывая dirty-поля
      const currentState = store.getState();
      const initial = options.initial;
      const newValues = { ...currentState.values };
      let hasChanges = false;

      for (const key of Object.keys(initial) as Array<keyof TValues>) {
        if (initial[key] === undefined) continue;

        // Поле dirty, если отличается от initialValues
        const isDirty = !Object.is(
          currentState.values[key],
          currentState.initialValues[key]
        );

        if (!isDirty) {
          // Поле не трогали → берём из initial
          if (!Object.is(newValues[key], initial[key])) {
            newValues[key] = initial[key] as TValues[keyof TValues];
            hasChanges = true;
          }
        }
        // Поле dirty → оставляем как есть
      }

      if (hasChanges) {
        const ctx: ActionContext<TValues> = {
          config,
          translate: translateRef.current,
          locale: "auto",
        };
        store.setState((prev) =>
          setFieldValues(
            { ...prev, initialValues: { ...prev.initialValues, ...initial } as TValues },
            newValues,
            ctx
          )
        );
      }
    }

    // ====================================================================
    // ActionContext (всегда актуальный)
    // ====================================================================
    const getActionCtx = useCallback(
      (): ActionContext<TValues> => ({
        config,
        translate: translateRef.current,
        locale: "auto",
      }),
      [config]
    );

    // ====================================================================
    // Подписка на весь state (для dirty, submitting, isValid, values и т.д.)
    // ====================================================================
    const state = useSyncExternalStore(
      store.subscribe,
      store.getState,
      store.getState
    );

    // ====================================================================
    // Пересчёт при смене translate (другая локаль)
    // ====================================================================
    const prevTranslateRef = useRef(translate);
    useEffect(() => {
      if (prevTranslateRef.current !== translate) {
        prevTranslateRef.current = translate;
        const ctx = getActionCtx();
        store.setState((prev) => setFormLocale(prev, "auto", ctx));
      }
    }, [translate, store, getActionCtx]);

    // ====================================================================
    // Persist
    // ====================================================================
    useEffect(() => {
      if (persistKey) {
        setPersistedState(persistKey, state.values);
      }
    }, [state.values, persistKey]);

    // ====================================================================
    // Cleanup при unmount (decrement refCount)
    // ====================================================================
    useEffect(() => {
      const key = registryKey;
      return () => {
        const entry = storeRegistry.get(key);
        if (entry) {
          entry.refCount--;
          // Не удаляем сразу — store остаётся для persist / возврата
          // Можно добавить cleanup по таймеру в будущем
        }
      };
    }, [registryKey]);

    // ====================================================================
    // Actions
    // ====================================================================

    const setValue = useCallback(
      <K extends keyof TValues>(key: K, value: TValues[K]) => {
        const ctx = getActionCtx();
        const fieldConfig = config[key];

        // Если есть setter — используем его (для связанных изменений)
        if (fieldConfig?.setter) {
          const currentValues = store.getState().values;
          fieldConfig.setter(value, currentValues, (nextValues) => {
            store.setState((prev) =>
              setFieldValues(prev, nextValues, ctx)
            );
          });
          return;
        }

        const previousValue = store.getState().values[key];

        // Обычное обновление
        store.setState((prev) => setFieldValue(prev, key, value, ctx));

        // onChange callback
        if (onChangeRef.current) {
          const currentState = store.getState();
          Promise.resolve(
            onChangeRef.current({
              fieldKey: key,
              newValue: value,
              previousValue,
              allValues: currentState.values,
            })
          )
            .then((result) => {
              if (result) {
                store.setState((prev) =>
                  setFieldValues(prev, result, ctx)
                );
              }
            })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.error("[Palistor] onChange error:", err);
            });
        }
      },
      [store, config, getActionCtx]
    );

    const setValues = useCallback(
      (values: Partial<TValues>) => {
        const ctx = getActionCtx();
        store.setState((prev) => setFieldValues(prev, values, ctx));
      },
      [store, getActionCtx]
    );

    const reset = useCallback(
      (next?: Partial<TValues>) => {
        const ctx = getActionCtx();
        store.setState((prev) => resetForm(prev, next, defaults, ctx));

        // Очищаем черновик
        if (persistKey) {
          clearPersistedState(persistKey);
        }
      },
      [store, getActionCtx, persistKey]
    );

    const submit = useCallback(async () => {
      const ctx = getActionCtx();
      let vals = store.getState().values;

      // beforeSubmit
      if (beforeSubmitRef.current) {
        try {
          vals = await beforeSubmitRef.current(vals);
          store.setState((prev) => setFieldValues(prev, vals, ctx));
        } catch {
          return;
        }
      }

      // Включаем показ ошибок и валидируем
      store.setState((prev) => enableShowErrors(prev, ctx));

      const currentState = store.getState();
      if (!isFormValid(currentState)) {
        return;
      }

      // Отправка
      store.setState((prev) => setSubmitting(prev, true));

      try {
        const data = await onSubmitRef.current?.(currentState.values);
        await afterSubmitRef.current?.(data, reset);

        // Очищаем черновик после успешной отправки
        if (persistKey) {
          clearPersistedState(persistKey);
        }
      } finally {
        store.setState((prev) => setSubmitting(prev, false));
      }
    }, [store, getActionCtx, reset, persistKey]);

    const getVisibleFields = useCallback((): Array<keyof TValues & string> => {
      return getVisibleFieldKeys(store.getState());
    }, [store]);

    // ====================================================================
    // getFieldProps — хук для получения пропсов поля с подпиской
    // ====================================================================
    // ВАЖНО: getFieldProps использует useSyncExternalStore внутри,
    // но так как это вызывается из useForm (который сам хук),
    // и количество вызовов getFieldProps стабильно — это безопасно.
    // Однако для максимальной корректности, getFieldProps не вызывает
    // дополнительный useSyncExternalStore. Подписка идёт через state выше.

    const getFieldProps = useCallback(
      <K extends keyof TValues>(key: K): FieldProps<TValues[K]> => {
        const currentState = store.getState();
        const fieldState = currentState.fields[key];

        if (!fieldState) {
          throw new Error(
            `[Palistor] No field state found for key: ${String(key)}`
          );
        }

        return {
          ...fieldState,
          onValueChange: (val: InputValueType<TValues[K]>) => {
            const fieldCfg = config[key];

            if (fieldCfg?.types?.dataType) {
              const parsedValue = parseValue(val, fieldCfg.types.dataType);
              setValue(key, parsedValue as TValues[K]);
            } else {
              setValue(key, val as TValues[K]);
            }
          },
          isInvalid: !!(currentState.showErrors && fieldState.error),
          errorMessage: currentState.showErrors ? fieldState.error : undefined,
          isDisabled: fieldState.isDisabled || currentState.submitting,
        };
      },
      [store, config, setValue]
    );

    // ====================================================================
    // Return API
    // ====================================================================
    return {
      getFieldProps,
      setValue,
      setValues,
      reset,
      submit,
      dirty: state.dirty,
      submitting: state.submitting,
      isValid: isFormValid(state),
      getVisibleFields,
      values: state.values,
      errors: state.errors,
      fields: state.fields,
    };
  }

  return { useForm };
}

// ============================================================================
// Утилиты для работы с registry
// ============================================================================

/**
 * Получить store напрямую по type:id (для escape hatch)
 */
export function getFormStore<TValues extends Record<string, any>>(
  type: string,
  id: string
): Store<FormState<TValues>> | undefined {
  const entry = storeRegistry.get(getRegistryKey(type, id));
  return entry?.store as Store<FormState<TValues>> | undefined;
}

/**
 * Проверить наличие store в registry
 */
export function hasFormStore(type: string, id: string): boolean {
  return storeRegistry.has(getRegistryKey(type, id));
}

/**
 * Удалить store из registry
 */
export function removeFormStore(type: string, id: string): void {
  storeRegistry.delete(getRegistryKey(type, id));
}

/**
 * Получить все ключи из registry (для отладки)
 */
export function getRegistryKeys(): string[] {
  return Array.from(storeRegistry.keys());
}
