export type PaymentType = "card" | "bank" | "crypto";
export type AccountType = "personal" | "business";
export type CryptoNetwork = "ethereum" | "bitcoin" | "tron";
export type Country = "ru" | "us" | "de";

/** The `passport` group: what its fields' callbacks receive as `values`. */
export interface PassportValues {
  id: string;
  number: string;
  issueDate: string;
  expiryDate: string;
}

/** The payment form: what the callbacks of its top-level fields receive as `values`. */
export interface PaymentFormValues {
  paymentType: PaymentType;
  amount: number;
  comment: string;

  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;

  bankAccount: string;
  bankBik: string;
  passport: PassportValues;

  cryptoWallet: string;
  cryptoNetwork: CryptoNetwork;

  name: string;
  email: string;
  phone: string;
  lastModified: number;

  accountType: AccountType;
  companyName: string;

  country: Country | "";
  city: string;
  shippingCost: number;

  agreeTerms: boolean;
  newsletter: boolean;

  price: number;
  quantity: number;
  total: number;
}
