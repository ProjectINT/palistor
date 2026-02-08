import type { Country } from "@/config/paymentForm";

export const PAYMENT_TYPE_OPTIONS = [
  { value: "card", label: "paymentTypes.card" },
  { value: "bank", label: "paymentTypes.bank" },
  { value: "crypto", label: "paymentTypes.crypto" },
] as const;

export const CRYPTO_NETWORK_OPTIONS = [
  { value: "ethereum", label: "networks.ethereum" },
  { value: "bitcoin", label: "networks.bitcoin" },
  { value: "tron", label: "networks.tron" },
] as const;

export const ACCOUNT_TYPE_OPTIONS = [
  { value: "personal", label: "accountTypes.personal" },
  { value: "business", label: "accountTypes.business" },
] as const;

export const COUNTRY_OPTIONS = [
  { value: "ru", label: "countries.ru" },
  { value: "us", label: "countries.us" },
  { value: "de", label: "countries.de" },
] as const;

export const CITIES_BY_COUNTRY: Record<Country, { value: string; label: string }[]> = {
  ru: [
    { value: "moscow", label: "cities.moscow" },
    { value: "spb", label: "cities.spb" },
    { value: "kazan", label: "cities.kazan" },
  ],
  us: [
    { value: "newyork", label: "cities.newyork" },
    { value: "losangeles", label: "cities.losangeles" },
  ],
  de: [
    { value: "berlin", label: "cities.berlin" },
    { value: "munich", label: "cities.munich" },
  ],
};
