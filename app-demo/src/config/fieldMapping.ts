/**
 * Демо fieldMapping — переименование внутренних свойств поля под конвенцию
 * конкретной UI-библиотеки.
 *
 * Palistor по умолчанию отдаёт `isRequired` / `isDisabled` / `isInvalid` /
 * `errorMessage` / `description`. Многие UI-киты (MUI, Ant Design, нативный
 * HTML) ждут другие имена: `required` / `disabled` / `error` / `helperText`.
 *
 * `fieldMapping` переименовывает свойства **на границе proxy** — GET, SET,
 * tracking и spread. Внутренний FieldState, compute и pipelines не меняются.
 * Благодаря этому `{...form.email}` можно спредить прямо в компонент чужой
 * библиотеки — без адаптеров.
 */

import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";
import { defineFieldMapping } from "@palistor/store/defineFieldMapping";

// ============================================================================
// Карта переименования (MUI / HTML-native стиль)
// ============================================================================

/**
 * `defineFieldMapping` (а не `: FieldMapping` и не `satisfies FieldMapping`) —
 * чтобы TypeScript сохранил литералы (`"required"`, …) и прокинул их в тип
 * `store.proxy`. Ключи слева — внутренние имена Palistor, значения справа —
 * имена, под которыми свойства будут видны наружу.
 */
export const uiFieldMapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

// Строки таблицы для UI (internal → external)
export const MAPPING_ROWS = Object.entries(uiFieldMapping) as Array<[string, string]>;

// ============================================================================
// Конфиг формы
// ============================================================================

export type MappingValues = {
  email: string;
  password: string;
  nickname: string;
};

export const mappingConfig = {
  email: {
    value: "",
    label: "Email",
    placeholder: "you@example.com",
    isRequired: true,
    description: "We never share your email",
    validate: (v: string) =>
      !v ? "Email is required" : !v.includes("@") ? "Invalid email address" : undefined,
  },
  password: {
    value: "",
    label: "Password",
    placeholder: "••••••••",
    isRequired: true,
    description: "At least 8 characters",
    validate: (v: string) =>
      !v ? "Password is required" : v.length < 8 ? "Too short — min 8 characters" : undefined,
  },
  nickname: {
    value: "guest_42",
    label: "Nickname",
    description: "Assigned by the server — read-only",
    isReadOnly: true,
  },
};

// ============================================================================
// Store — включаем fieldMapping
// ============================================================================

export const mappingStore = new Palistor({
  config: mappingConfig,
  fieldMapping: uiFieldMapping,
  initialValues: { email: "", password: "", nickname: "guest_42" },
});

/**
 * Хук подключения к mappingStore. Возвращает proxy, где поля отдают
 * external-имена: `form.email.required`, `form.email.error`, `form.email.helperText`.
 */
export const useMappingForm = () => useForm(mappingStore) as any;
