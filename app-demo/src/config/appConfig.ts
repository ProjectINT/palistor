/**
 * Глобальная конфигурация приложения — единый Palistor store
 *
 * Демонстрирует комплексное глобальное состояние:
 * - Форма оплаты: условная видимость, обязательность, валидация, форматтеры,
 *   setter-зависимости, i18n, computed values, nested-поля
 * - Каталог: списки (ListNode), async resolve с retry, фильтры, редактирование сущностей
 */

import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";
import type { FormConfig, TranslateFn } from "@palistor";

import { payment } from "./payment";
import { card } from "./card";
import { bank } from "./bank";
import { crypto } from "./crypto";
import { contacts } from "./contacts";
import { accountType } from "./accountType";
import { address } from "./address";
import { passport } from "./passport";
import { checkboxes } from "./checkboxes";
import { computed } from "./computed";
import { catalog } from "./catalog/catalog";

// ============================================================================
// Типы
// ============================================================================

import type { Country, PaymentFormValues, PaymentType, AccountType, CryptoNetwork } from "./types";
import type { CatalogValues } from "./catalog/types";

export type { PaymentFormValues, PaymentType, AccountType, CryptoNetwork, Country };
export type { CatalogValues };
export type AppValues = PaymentFormValues & CatalogValues;

// ============================================================================
// Конфигурация
// ============================================================================

export const appConfig = {
  // --------------------------------------------------------------------------
  // Тип оплаты — главный триггер для условной видимости
  // --------------------------------------------------------------------------
  ...payment,

  // --------------------------------------------------------------------------
  // Поля карты — видны только при paymentType === "card"
  // --------------------------------------------------------------------------
  ...card,

  // --------------------------------------------------------------------------
  // Поля банковского перевода
  // --------------------------------------------------------------------------
  ...bank,

  // --------------------------------------------------------------------------
  // Поля криптовалюты
  // --------------------------------------------------------------------------
  ...crypto,

  // --------------------------------------------------------------------------
  // Контактные данные
  // --------------------------------------------------------------------------
  ...contacts,

  // --------------------------------------------------------------------------
  // Тип аккаунта — демонстрация условной обязательности
  // --------------------------------------------------------------------------
  ...accountType,

  // --------------------------------------------------------------------------
  // Адрес — демонстрация каскадных зависимостей
  // --------------------------------------------------------------------------
  ...address,

  // --------------------------------------------------------------------------
  // Паспорт — демонстрация ВЛОЖЕННЫХ ПОЛЕЙ (nested)
  // --------------------------------------------------------------------------
  ...passport,

  // --------------------------------------------------------------------------
  // Чекбоксы
  // --------------------------------------------------------------------------
  ...checkboxes,

  // --------------------------------------------------------------------------
  // Калькулятор — демонстрация computed values
  // --------------------------------------------------------------------------
  ...computed,

  // --------------------------------------------------------------------------
  // Комментарий — статическое поле без зависимостей
  // --------------------------------------------------------------------------
  comment: {
    types: {
      dataType: "String" as const,
      type: "string",
    },
    value: "",
    label: (t: TranslateFn) => t("form.comment"),
    placeholder: (t: TranslateFn) => t("form.commentPlaceholder"),
    dependencies: [],
  },

  // --------------------------------------------------------------------------
  // Каталог — фильтры, списки, редактирование сущностей
  // --------------------------------------------------------------------------
  ...catalog,
};

// ============================================================================
// Значения по умолчанию
// ============================================================================

export const appDefaults: PaymentFormValues = {
  paymentType: "card",
  cardNumber: "",
  cardExpiry: "",
  cardCvv: "",
  bankAccount: "",
  bankBik: "",
  cryptoWallet: "",
  cryptoNetwork: "ethereum",
  amount: 0,
  comment: "",
  email: "",
  phone: "",
  name: "",
  accountType: "personal",
  companyName: "",
  country: "",
  city: "",
  shippingCost: 0,
  agreeTerms: false,
  newsletter: false,
  price: 100,
  quantity: 1,
  total: 100,
  passport: {
    id: null,
    number: "",
    issueDate: "",
    expiryDate: "",
  },
};

// ============================================================================
// Store
// ============================================================================

export const appStore = new Palistor({
  config: appConfig,
  initialValues: appDefaults,
});

/**
 * Хук для подключения компонентов к appStore.
 * Возвращает реактивный прокси — чтение поля = подписка на него.
 *
 * @example
 * const app = useAppForm();
 * app.email.value          // читаем
 * app.email.value = "x"    // пишем
 */
export const useAppForm = () => useForm(appStore) as any;

// ============================================================================
// Обратная совместимость
// ============================================================================

export const paymentStore = appStore;
export const paymentFormConfig = appConfig;
export const paymentFormDefaults = appDefaults;
export const usePaymentForm = useAppForm;

export const catalogStore = appStore;
export const useCatalogForm = useAppForm;
