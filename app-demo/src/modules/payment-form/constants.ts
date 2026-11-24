import { localStorageDriver, sessionStorageDriver } from "@palistor";
import type { AccountType, Country, CryptoNetwork, PaymentType } from "@/config/appConfig";

// Select options; each value's label is a message key: `paymentTypes.${value}`, `cities.${city}`, …
export const PAYMENT_TYPES: readonly PaymentType[] = ["card", "bank", "crypto"];
export const CRYPTO_NETWORKS: readonly CryptoNetwork[] = ["ethereum", "bitcoin", "tron"];
export const ACCOUNT_TYPES: readonly AccountType[] = ["personal", "business"];
export const COUNTRIES: readonly Country[] = ["ru", "us", "de"];
export const CITIES: Record<Country, readonly string[]> = {
  ru: ["moscow", "spb", "kazan"],
  us: ["newyork", "losangeles"],
  de: ["berlin", "munich"],
};

/** The draft of the form: its storage key and the top-level fields it keeps. */
export const DRAFT = { key: "payment-form-demo", pick: ["email", "phone", "name"] };

export const DRAFT_DRIVERS = { localStorage: localStorageDriver, sessionStorage: sessionStorageDriver };
export type DraftStorage = keyof typeof DRAFT_DRIVERS;
