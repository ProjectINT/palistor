/**
 * useField - хуки для подписки на отдельные поля формы
 *
 * Эти хуки оптимизированы для минимизации ре-рендеров:
 * - useFieldState — подписка на полное состояние поля (ComputedFieldState)
 * - useFieldValue — подписка только на value поля
 * - useFieldError — подписка только на error поля
 *
 * ВАЖНО: Эти хуки используют fields из FormState, что гарантирует
 * реактивность на изменения isVisible, isDisabled и т.д.
 */

"use client";

import { useSyncExternalStore, useCallback, useRef } from "react";
import { getForm } from "../core/registry";
import type { ComputedFieldState, FieldProps } from "../core/types";

// ============================================================================
// useFieldState — полное состояние поля
// ============================================================================

/**
 * Подписка на полное состояние поля (ComputedFieldState)
 *
 * Ре-рендерит компонент только когда изменяется ОБЪЕКТ fieldState.
 * Благодаря оптимизации в recomputeFieldStates, объект не меняется
 * если все свойства остались прежними.
 *
 * @param formId - ID формы в реестре
 * @param fieldKey - ключ поля
 * @returns ComputedFieldState поля
 *
 * @example
 * ```tsx
 * function CardNumberField() {
 *   const field = useFieldState<string>("payment", "cardNumber");
 *
 *   // Компонент НЕ перерендерится если изменится paymentType,
 *   // но cardNumber.isVisible останется true
 *
 *   if (!field.isVisible) return null;
 *
 *   return (
 *     <Input
 *       value={field.value}
 *       label={field.label}
 *       isDisabled={field.isDisabled}
 *       isRequired={field.isRequired}
 *     />
 *   );
 * }
 * ```
 */
export function useFieldState<TValue = any>(
  formId: string,
  fieldKey: string
): ComputedFieldState<TValue> {
  const entry = getForm(formId);

  if (!entry) {
    throw new Error(`[Palistor] Form "${formId}" not found in registry`);
  }

  const { store } = entry;

  // Кэш для избежания лишних ре-рендеров
  const lastFieldRef = useRef<ComputedFieldState<TValue> | null>(null);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const fieldState = state.fields[fieldKey] as ComputedFieldState<TValue> | undefined;

    if (!fieldState) {
      // Возвращаем дефолтное состояние если поле не найдено
      const defaultState: ComputedFieldState<TValue> = {
        value: undefined as TValue,
        isVisible: true,
        isDisabled: false,
        isReadOnly: false,
        isRequired: false,
      };
      return defaultState;
    }

    // Если объект тот же — возвращаем кэш
    if (lastFieldRef.current === fieldState) {
      return lastFieldRef.current;
    }

    lastFieldRef.current = fieldState;
    return fieldState;
  }, [store, fieldKey]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useFieldValue — только value
// ============================================================================

/**
 * Подписка только на значение поля
 *
 * Ещё более оптимизированный хук — ре-рендерит только при изменении value.
 * НЕ реагирует на изменения isVisible, isDisabled и т.д.
 *
 * @param formId - ID формы
 * @param fieldKey - ключ поля
 * @returns значение поля
 *
 * @example
 * ```tsx
 * const paymentType = useFieldValue<string>("payment", "paymentType");
 * // Компонент перерендерится только когда изменится paymentType
 * ```
 */
export function useFieldValue<TValue = any>(
  formId: string,
  fieldKey: string
): TValue | undefined {
  const entry = getForm(formId);

  if (!entry) {
    throw new Error(`[Palistor] Form "${formId}" not found in registry`);
  }

  const { store } = entry;
  const lastValueRef = useRef<TValue | undefined>(undefined);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const value = state.values[fieldKey] as TValue | undefined;

    // Если значение не изменилось — возвращаем кэш
    if (Object.is(lastValueRef.current, value)) {
      return lastValueRef.current;
    }

    lastValueRef.current = value;
    return value;
  }, [store, fieldKey]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useFieldError — только error
// ============================================================================

/**
 * Подписка только на ошибку поля
 *
 * @param formId - ID формы
 * @param fieldKey - ключ поля
 * @returns ошибка поля или undefined
 *
 * @example
 * ```tsx
 * const error = useFieldError("payment", "cardNumber");
 * if (error) {
 *   return <ErrorMessage>{error}</ErrorMessage>;
 * }
 * ```
 */
export function useFieldError(
  formId: string,
  fieldKey: string
): string | undefined {
  const entry = getForm(formId);

  if (!entry) {
    throw new Error(`[Palistor] Form "${formId}" not found in registry`);
  }

  const { store } = entry;
  const lastErrorRef = useRef<string | undefined>(undefined);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const fieldState = state.fields[fieldKey];
    const error = fieldState?.error;

    if (lastErrorRef.current === error) {
      return lastErrorRef.current;
    }

    lastErrorRef.current = error;
    return error;
  }, [store, fieldKey]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useFieldVisible — только isVisible
// ============================================================================

/**
 * Подписка только на видимость поля
 *
 * Удобно для условного рендеринга секций
 *
 * @param formId - ID формы
 * @param fieldKey - ключ поля
 * @returns true если поле видимо
 *
 * @example
 * ```tsx
 * const isCardVisible = useFieldVisible("payment", "cardNumber");
 * if (!isCardVisible) return null;
 *
 * return <CardNumberInput />;
 * ```
 */
export function useFieldVisible(formId: string, fieldKey: string): boolean {
  const entry = getForm(formId);

  if (!entry) {
    throw new Error(`[Palistor] Form "${formId}" not found in registry`);
  }

  const { store } = entry;
  const lastVisibleRef = useRef<boolean>(true);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const fieldState = state.fields[fieldKey];
    const isVisible = fieldState?.isVisible ?? true;

    if (lastVisibleRef.current === isVisible) {
      return lastVisibleRef.current;
    }

    lastVisibleRef.current = isVisible;
    return isVisible;
  }, [store, fieldKey]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useSetFieldValue — setter для поля
// ============================================================================

/**
 * Возвращает функцию для установки значения поля
 *
 * Удобно когда нужен только setter без подписки на значение
 *
 * @param formId - ID формы
 * @param fieldKey - ключ поля
 * @returns функция setValue
 *
 * @example
 * ```tsx
 * const setPaymentType = useSetFieldValue<string>("payment", "paymentType");
 *
 * return (
 *   <RadioGroup onChange={(value) => setPaymentType(value)}>
 *     <Radio value="card">Card</Radio>
 *     <Radio value="bank">Bank</Radio>
 *   </RadioGroup>
 * );
 * ```
 */
export function useSetFieldValue<TValue = any>(
  formId: string,
  fieldKey: string
): (value: TValue) => void {
  const entry = getForm(formId);

  if (!entry) {
    throw new Error(`[Palistor] Form "${formId}" not found in registry`);
  }

  // Возвращаем мемоизированную функцию
  // Она не меняется между рендерами
  return useCallback(
    (value: TValue) => {
      // Импортируем action здесь чтобы избежать циклических зависимостей
      // В реальном использовании лучше передавать setValue через контекст
      const currentEntry = getForm(formId);
      if (!currentEntry) return;

      const { store, config, options } = currentEntry;
      const { translate, locale } = options;

      // Используем action напрямую
      const { setFieldValue } = require("../core/actions");
      store.setState((prev: any) =>
        setFieldValue(prev, fieldKey, value, {
          config,
          translate: translate ?? ((k: string) => k),
          locale: locale ?? "en",
        })
      );
    },
    [formId, fieldKey]
  );
}
