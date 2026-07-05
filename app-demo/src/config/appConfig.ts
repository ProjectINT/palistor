/**
 * Global app configuration — a single Palistor store
 *
 * Demonstrates complex global state:
 * - Payment form: conditional visibility, requiredness, validation, formatters,
 *   setter dependencies, i18n, computed values, nested fields
 * - Catalog: lists (ListNode), async resolve with retry, filters, entity editing
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
// Types
// ============================================================================

import type { Country, PaymentFormValues, PaymentType, AccountType, CryptoNetwork } from "./types";
import type { CatalogValues } from "./catalog/types";

export type { PaymentFormValues, PaymentType, AccountType, CryptoNetwork, Country };
export type { CatalogValues };
export type AppValues = PaymentFormValues & CatalogValues;

// ============================================================================
// Configuration
// ============================================================================

export const appConfig = {
  // --------------------------------------------------------------------------
  // Payment type — the main trigger for conditional visibility
  // --------------------------------------------------------------------------
  ...payment,

  // --------------------------------------------------------------------------
  // Card fields — visible only when paymentType === "card"
  // --------------------------------------------------------------------------
  ...card,

  // --------------------------------------------------------------------------
  // Bank transfer fields
  // --------------------------------------------------------------------------
  ...bank,

  // --------------------------------------------------------------------------
  // Cryptocurrency fields
  // --------------------------------------------------------------------------
  ...crypto,

  // --------------------------------------------------------------------------
  // Contact details
  // --------------------------------------------------------------------------
  ...contacts,

  // --------------------------------------------------------------------------
  // Account type — demonstrates conditional requiredness
  // --------------------------------------------------------------------------
  ...accountType,

  // --------------------------------------------------------------------------
  // Address — demonstrates cascading dependencies
  // --------------------------------------------------------------------------
  ...address,

  // --------------------------------------------------------------------------
  // Passport — demonstrates NESTED fields
  // --------------------------------------------------------------------------
  ...passport,

  // --------------------------------------------------------------------------
  // Checkboxes
  // --------------------------------------------------------------------------
  ...checkboxes,

  // --------------------------------------------------------------------------
  // Calculator — demonstrates computed values
  // --------------------------------------------------------------------------
  ...computed,

  // --------------------------------------------------------------------------
  // Comment — a static field with no dependencies
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
  // onChange demo — updates when email changes (via the onChange handler)
  // --------------------------------------------------------------------------
  lastModified: {
    value: 0,
  },

  // --------------------------------------------------------------------------
  // Catalog — filters, lists, entity editing
  // --------------------------------------------------------------------------
  ...catalog,
};

// ============================================================================
// Default values
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
  lastModified: 0,
};

// ============================================================================
// Store
// ============================================================================

export const appStore = new Palistor({
  config: appConfig,
  initialValues: appDefaults,
});

/**
 * Hook connecting components to the appStore.
 * Returns a reactive proxy — reading a field = subscribing to it.
 *
 * @example
 * const app = useAppForm();
 * app.email.value          // read
 * app.email.value = "x"    // write
 */
export const useAppForm = () => useForm(appStore) as any;

// ============================================================================
// Backward compatibility
// ============================================================================

export const paymentStore = appStore;
export const paymentFormConfig = appConfig;
export const paymentFormDefaults = appDefaults;
export const usePaymentForm = useAppForm;

export const catalogStore = appStore;
export const useCatalogForm = useAppForm;
