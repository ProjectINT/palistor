// The mistake: "Translator, notifier or context applied through an effect"
// (skills/palistor-ssr/SKILL.md, Common Mistakes). `useTranslator` registers
// the translation function after the first render, and effects never run on
// the server: the server's HTML carries the key `customers.search` instead of
// the translated label.
"use client";

import { defineList, useForm, usePalistor, useTranslator } from "palistor";
import type { PalistorRef, TranslateFn } from "palistor";
import { fetchCustomers, type Customer } from "./api";
import { useT } from "./i18n";

const config = {
  customers: defineList<Customer>({
    template: { id: { value: "" }, name: { value: "" } },
    filter: {
      search: { value: "", label: (t: TranslateFn) => t("customers.search") },
    },
    resolve: {
      resolver: async (values, store, ctx) =>
        fetchCustomers(String(store.context.accountId), String(ctx.filter.values.search)),
    },
  }),
};

export function CustomersView({ accountId, customers }: { accountId: string; customers: Customer[] }) {
  const t = useT();
  const store = usePalistor(() => ({
    config,
    context: { accountId },
    initialData: { customers },
  }));
  useTranslator(store, t);
  const list = useForm(store).customers;
  const search = list.filter!.search;

  return (
    <section>
      <label>
        {search.label}
        <input value={search.value} onChange={(event) => search.onValueChange(event.target.value)} />
      </label>
      <ul>
        {list.map((customer, index, id) => (
          <CustomerRow key={id} customer={customer} />
        ))}
      </ul>
    </section>
  );
}

function CustomerRow({ customer }: { customer: PalistorRef<Customer> }) {
  const row = useForm(customer);
  return <li>{row.name.value}</li>;
}
