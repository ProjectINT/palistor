/**
 * useFieldValue - хук для подписки на значение одного поля
 * 
 * Оптимизированный хук, который ре-рендерит компонент только 
 * при изменении конкретного поля
 */

"use client";

import { useSyncExternalStore, useCallback, useRef } from "react";
import { getForm } from "../core/registry";
import { getFieldByPath, getPathFromKey } from "../utils/helpers";

/**
 * Подписка на значение конкретного поля формы
 * 
 * @param formId - ID формы в реестре
 * @param fieldKey - ключ поля (поддерживает dot notation: 'user.email')
 * @returns значение поля
 * 
 * @example
 * ```tsx
 * const email = useFieldValue("my-form", "email");
 * const issueDate = useFieldValue("my-form", "passport.issue_date");
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
  const fieldPath = getPathFromKey(fieldKey);

  // Кэш для избежания лишних ре-рендеров
  const lastValueRef = useRef<TValue | undefined>(undefined);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fieldPathKey = fieldPath.join(".");

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const value = getFieldByPath(state.values, fieldPath) as TValue;

    // Shallow comparison
    if (Object.is(lastValueRef.current, value)) {
      return lastValueRef.current as TValue;
    }

    lastValueRef.current = value;
    return value;
  }, [store, fieldPathKey]);

  return useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot
  );
}

/**
 * Подписка на ошибку конкретного поля формы
 * 
 * @param formId - ID формы в реестре
 * @param fieldKey - ключ поля
 * @returns ошибка поля или undefined
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
  const fieldPath = getPathFromKey(fieldKey);

  const lastErrorRef = useRef<string | undefined>(undefined);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fieldPathKey = fieldPath.join(".");

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    
    // Если ошибки ещё не показываются, возвращаем undefined
    if (!state.showErrors) {
      return undefined;
    }

    const error = getFieldByPath(state.errors, fieldPath) as string | undefined;

    if (Object.is(lastErrorRef.current, error)) {
      return lastErrorRef.current;
    }

    lastErrorRef.current = error;
    return error;
  }, [store, fieldPathKey]);

  return useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot
  );
}
