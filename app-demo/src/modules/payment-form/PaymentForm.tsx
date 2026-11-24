"use client";

import { useState } from "react";
import { useForm, usePersist } from "@palistor";

import { paymentStore } from "@/config/appConfig";
import { DRAFT, DRAFT_DRIVERS, type DraftStorage } from "./constants";
import { FormActions } from "./FormActions";
import { PersistControls } from "./PersistControls";
import {
  AccountTypeSection,
  AddressSection,
  AgreementsSection,
  AmountSection,
  BankSection,
  CalculatorSection,
  CardSection,
  CommentSection,
  ContactSection,
  CryptoSection,
  PassportSection,
  PaymentTypeSection,
} from "./sections";

/**
 * The "Payment Form" tab: the only component that sees `paymentStore`. It
 * reads no state, it hands each section the nodes it renders (the config is
 * flat, so mostly single fields; `passport` is a group), so an edit
 * re-renders the input it happened in, not the form.
 */
export function PaymentForm() {
  const form = useForm(paymentStore);

  // A draft of the contact fields, saved while the tab is open; the panel switches its storage.
  const [storage, setStorage] = useState<DraftStorage>("localStorage");
  usePersist(paymentStore, { key: DRAFT.key, pick: DRAFT.pick, driver: DRAFT_DRIVERS[storage], debounce: 300 });

  return (
    <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <PaymentTypeSection paymentType={form.paymentType} />
      <CardSection cardNumber={form.cardNumber} cardExpiry={form.cardExpiry} cardCvv={form.cardCvv} />
      <BankSection bankAccount={form.bankAccount} bankBik={form.bankBik} />
      <PassportSection passport={form.passport} />
      <CryptoSection cryptoWallet={form.cryptoWallet} cryptoNetwork={form.cryptoNetwork} />
      <AmountSection amount={form.amount} />
      <ContactSection name={form.name} email={form.email} phone={form.phone} lastModified={form.lastModified} />
      <AccountTypeSection accountType={form.accountType} companyName={form.companyName} />
      <AddressSection country={form.country} city={form.city} shippingCost={form.shippingCost} />
      <CalculatorSection price={form.price} quantity={form.quantity} total={form.total} />
      <AgreementsSection agreeTerms={form.agreeTerms} newsletter={form.newsletter} />
      <CommentSection comment={form.comment} />
      <PersistControls
        storage={storage}
        onStorageChange={setStorage}
        onSave={() => paymentStore.persist.flush()}
        onClear={() => paymentStore.persist.clear()}
      />
      <FormActions form={form} />
    </div>
  );
}
