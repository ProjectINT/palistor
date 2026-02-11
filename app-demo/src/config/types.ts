

export type PaymentType = "card" | "bank" | "crypto";
export type AccountType = "personal" | "business";
export type CryptoNetwork = "ethereum" | "bitcoin" | "tron";
export type Country = "ru" | "us" | "de";

export interface PaymentFormValues {
  // Тип оплаты
  paymentType: PaymentType;
  
  // Карта
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
  
  // Банк
  bankAccount: string;
  bankBik: string;
  
  // Крипто
  cryptoWallet: string;
  cryptoNetwork: CryptoNetwork;
  
  // Общие
  amount: number;
  comment: string;
  
  // Контакты
  email: string;
  phone: string;
  name: string;
  
  // Тип аккаунта
  accountType: AccountType;
  companyName: string;
  
  // Адрес доставки
  country: Country | "";
  city: string;
  shippingCost: number;
  
  // Чекбоксы
  agreeTerms: boolean;
  newsletter: boolean;
  
  // Калькулятор
  price: number;
  quantity: number;
  total: number;
  
  // Паспорт — вложенное поле (nested)
  passport: {
    id: string | null;
    number: string;
    issueDate: string;
    expiryDate: string;
  };
}