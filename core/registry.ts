/**
 * Глобальный реестр форм Palistor
 * 
 * Позволяет:
 * - Регистрировать формы с уникальным ID
 * - Получать доступ к любой форме по ID из любого места
 * - Автоматически создавать store для каждой формы
 */

import type { 
  FormRegistry, 
  FormRegistryEntry, 
  CreateFormOptions, 
  FormState 
} from "./types";
import { createStore } from "./createStore";
import { materializeComputed, mergeState } from "../utils/materialize";
import { getPersistedState } from "../utils/persistence.ts";

/**
 * Создаёт начальное состояние формы
 */
function createInitialFormState<TValues extends Record<string, any>>(
  options: CreateFormOptions<TValues>
): FormState<TValues> {
  const { defaults, initial, config, persistId } = options;

  // Загружаем черновик из localStorage если есть
  const persisted = persistId ? getPersistedState<Partial<TValues>>(persistId) : {};

  // Мержим: defaults <- persisted <- initial
  const merged = mergeState(defaults, persisted, initial);

  // Материализуем computed поля
  const values = materializeComputed(merged, config);

  return {
    values,
    errors: {},
    submitting: false,
    dirty: false,
    showErrors: false,
    initialValues: values,
  };
}

/**
 * Создаёт глобальный реестр форм
 */
function createFormRegistry(): FormRegistry {
  const forms = new Map<string, FormRegistryEntry>();

  const register = <TValues extends Record<string, any>>(
    options: CreateFormOptions<TValues>
  ): FormRegistryEntry<TValues> => {
    const { id } = options;

    // Если форма уже зарегистрирована, возвращаем существующую
    if (forms.has(id)) {
      // eslint-disable-next-line no-console
      console.warn(`[Palistor] Form "${id}" already registered, returning existing instance`);
      return forms.get(id) as FormRegistryEntry<TValues>;
    }

    // Создаём начальное состояние
    const initialState = createInitialFormState(options);

    // Создаём store для формы
    const store = createStore<FormState<TValues>>(initialState);

    const entry: FormRegistryEntry<TValues> = {
      store,
      config: options.config,
      options,
    };

    forms.set(id, entry as FormRegistryEntry<any>);

    return entry;
  };

  const get = <TValues extends Record<string, any>>(
    id: string
  ): FormRegistryEntry<TValues> | undefined => {
    return forms.get(id) as FormRegistryEntry<TValues> | undefined;
  };

  const unregister = (id: string): void => {
    forms.delete(id);
  };

  const has = (id: string): boolean => {
    return forms.has(id);
  };

  return {
    forms,
    register,
    get,
    unregister,
    has,
  };
}

/**
 * Глобальный синглтон реестра форм
 */
export const formRegistry = createFormRegistry();

/**
 * Хелпер для регистрации формы
 */
export function registerForm<TValues extends Record<string, any>>(
  options: CreateFormOptions<TValues>
): FormRegistryEntry<TValues> {
  return formRegistry.register(options);
}

/**
 * Хелпер для получения формы по ID
 */
export function getForm<TValues extends Record<string, any>>(
  id: string
): FormRegistryEntry<TValues> | undefined {
  return formRegistry.get<TValues>(id);
}

/**
 * Хелпер для удаления формы
 */
export function unregisterForm(id: string): void {
  formRegistry.unregister(id);
}
