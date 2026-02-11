"use client";

import {
  PaymentTypeSection,
  CardSection,
  BankSection,
  CryptoSection,
  AmountSection,
  ContactSection,
  AccountTypeSection,
  AddressSection,
  PassportSection,
  CalculatorSection,
  AgreementsSection,
  CommentSection,
} from "./sections";
import { FormActions } from "./FormActions";

interface PaymentFormProps {
  formId: string;
}

export function PaymentForm({ formId }: PaymentFormProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="space-y-6"
      >
        <PaymentTypeSection formId={formId} />
        <CardSection formId={formId} />
        <BankSection formId={formId} />
        <PassportSection formId={formId} />
        <CryptoSection formId={formId} />
        <AmountSection formId={formId} />
        <ContactSection formId={formId} />
        <AccountTypeSection formId={formId} />
        <AddressSection formId={formId} />
        <CalculatorSection formId={formId} />
        <AgreementsSection formId={formId} />
        <CommentSection formId={formId} />
        <FormActions formId={formId} />
      </form>
    </div>
  );
}
