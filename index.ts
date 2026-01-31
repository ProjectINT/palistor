/**
 * Palistor - State Manager для форм
 * 
 * Особенности:
 * - Внешний store (не React state) для лучшего перформанса
 * - Глобальный реестр форм с доступом по ID
 * - Каждая форма - независимый модуль со своим конфигом
 * - Совместимость с текущим GenericFormProvider API
 * - Селекторы для минимизации ре-рендеров
 * - Поддержка localStorage persistence
 * 
 * @example
 * ```tsx
 * // Использование в компоненте
 * import { useFormStore } from "@/modules/palistor";
 * 
 * const { values, getFieldProps, submit } = useFormStore("order-form", {
 *   config: orderFormConfig,
 *   defaults: { amount: 0, customer: "" },
 *   onSubmit: async (values) => {
 *     await api.createOrder(values);
 *   }
 * });
 * 
 * return (
 *   <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
 *     <Input {...getFieldProps("amount")} />
 *     <Input {...getFieldProps("customer")} />
 *     <button type="submit">Create Order</button>
 *   </form>
 * );
 * ```
 * 
 * @example
 * ```tsx
 * // Доступ к форме из другого места по ID
 * import { getForm } from "@/modules/palistor";
 * 
 * const orderForm = getForm("order-form");
 * const currentValues = orderForm?.store.getState().values;
 * ```
 */

// Core
export { createStore } from "./core/createStore";
export { 
  formRegistry, 
  registerForm, 
  getForm, 
  unregisterForm 
} from "./core/registry";

// Types
export type {
  // Store types
  Store,
  Listener,
  
  // Form types
  FieldConfig,
  FormConfig,
  FormState,
  CreateFormOptions,
  FormStoreApi,
  FieldProps,
  
  // Registry types
  FormRegistryEntry,
  FormRegistry,
} from "./core/types";

// React hooks
export { useFormStore } from "./react/useFormStore";
export { useSelector, shallowEqual } from "./react/useSelector";
export { useFieldValue, useFieldError } from "./react/useFieldValue";

// Utils
export { 
  mergeState, 
  materializeComputed, 
  difference 
} from "./utils/materialize";
export { 
  getPersistedState, 
  setPersistedState, 
  clearPersistedState 
} from "./utils/persistence";
