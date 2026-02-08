/**
 * Демо конфигурация формы оплаты
 * 
 * Демонстрирует все возможности Palistor:
 * - Условная видимость (isVisible)
 * - Условная обязательность (isRequired)
 * - Условная блокировка (isDisabled, isReadOnly)
 * - Валидация (validate)
 * - Форматтеры (formatter)
 * - Связанные изменения (setter)
 * - Зависимости (dependencies)
 * - i18n (label, placeholder, description)
 * - Computed values (value as function)
 */

import { createForm } from "@palistor";
import type { FormConfig, TranslateFn } from "@palistor";
import { useTranslations } from "next-intl";
import { computed } from "./computed";
import { card } from "./card";

// ============================================================================
// Типы формы
// ============================================================================

import type { Country, PaymentFormValues, PaymentType, AccountType, CryptoNetwork } from "./types";
import { contacts } from "./contacts";

// Экспортируем типы для использования в компонентах
export type { PaymentFormValues, PaymentType, AccountType, CryptoNetwork, Country };
import { accountType } from "./accountType";
import { address } from "./address";
import { checkboxes } from "./checkboxes";
import { bank } from "./bank";
import { payment } from "./payment";
import { crypto } from "./crypto";

// ============================================================================
// Конфигурация
// ============================================================================

export const paymentFormConfig: FormConfig<PaymentFormValues> = {
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
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.comment"),
    placeholder: (t: TranslateFn) => t("form.commentPlaceholder"),
    dependencies: [], // Пересчёт только при изменении себя
  },
};

// ============================================================================
// Значения по умолчанию
// ============================================================================

export const paymentFormDefaults: PaymentFormValues = {
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
};

// ============================================================================
// createForm — новый API
// ============================================================================

export const { useForm: usePaymentForm } = createForm<PaymentFormValues>({
  config: paymentFormConfig,
  defaults: paymentFormDefaults,
  translateFunction: useTranslations,
  type: "PaymentDemo",
});
