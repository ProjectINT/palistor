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
import { PersistControls } from "./PersistControls";

export function PaymentForm() {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="space-y-6"
      >
        <PaymentTypeSection />
        <CardSection />
        <BankSection />
        <PassportSection />
        <CryptoSection />
        <AmountSection />
        <ContactSection />
        <AccountTypeSection />
        <AddressSection />
        <CalculatorSection />
        <AgreementsSection />
        <CommentSection />
        <PersistControls />
        <FormActions />
      </form>
    </div>
  );
}

