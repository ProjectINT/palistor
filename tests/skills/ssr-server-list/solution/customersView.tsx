"use client";

import { defineList, useForm, usePalistor } from "palistor";
import type { PalistorRef, TranslateFn } from "palistor";
import { fetchCustomers, type Customer } from "./api";
import { useT } from "./i18n";

// Module level: the config holds no request data. The store is made per component instance.
const config = {
  customers: defineList<Customer>({
    template: { id: { value: "" }, name: { value: "" } },
    filter: {
      // A server filter field: a change re-runs the resolver, also for a list that started from initialData.
      search: { value: "", label: (t: TranslateFn) => t("customers.search") },
    },
    resolve: {
      // Browser only: the rows of the first render come from the server as initialData.
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
    translator: t, // in the constructor: the server's HTML is already translated
    initialData: { customers }, // the list starts resolved: no request on the server or after hydration
  }));
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
