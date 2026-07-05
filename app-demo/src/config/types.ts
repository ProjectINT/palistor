

export type PaymentType = "card" | "bank" | "crypto";
export type AccountType = "personal" | "business";
export type CryptoNetwork = "ethereum" | "bitcoin" | "tron";
export type Country = "ru" | "us" | "de";

export interface PaymentFormValues {
  // Payment type
  paymentType: PaymentType;
  
  // Card
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
  
  // Bank
  bankAccount: string;
  bankBik: string;
  
  // Crypto
  cryptoWallet: string;
  cryptoNetwork: CryptoNetwork;
  
  // Shared
  amount: number;
  comment: string;
  
  // Contacts
  email: string;
  phone: string;
  name: string;
  
  // Account type
  accountType: AccountType;
  companyName: string;
  
  // Shipping address
  country: Country | "";
  city: string;
  shippingCost: number;
  
  // Checkboxes
  agreeTerms: boolean;
  newsletter: boolean;
  
  // Calculator
  price: number;
  quantity: number;
  total: number;
  
  // Passport — a nested field
  passport: {
    id: string | null;
    number: string;
    issueDate: string;
    expiryDate: string;
  };

  // onChange demo
  lastModified: number;
}