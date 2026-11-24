"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";

import { Block, Counter } from "@/app/ssr/shared/Block";

import { ListsShell } from "../shared/ListsShell";
import type { Account } from "./backend";
import { Customers } from "./Customers";
import { customersConfig } from "./customersConfig";
import { Accounts } from "./Invoices";

/**
 * The client side of /lists/customers: a paginated customer list with a
 * server filter, and each account's invoices as a list nested in the row,
 * paginated per row. Rendered on the server into HTML and again in the
 * browser during hydration, each time with a store built from the same props.
 *
 * The root of the view: the only component that sees the store. It hands
 * each block its list as a prop; every component below calls useForm on the
 * node it got and hands its own children their nodes (`list.filter`, a row,
 * a nested list, a field).
 */
export function CustomersView({ accounts }: { accounts: Account[] }) {
  const t = useTranslations("lists");

  // One store per component instance (the page is prerendered: no module-level
  // store for it). The accounts are the server's rows; the customers and every
  // account's invoices have no server data and load in the browser.
  const store = usePalistor(() => ({ config: customersConfig, initialData: { accounts } }));
  // Only navigates: reads no state, so nothing below re-renders the view.
  const form = useForm(store);

  return (
    <ListsShell subtitle={t("customers.subtitle")}>
      <Block
        testId="lists-customers"
        title={t("customers.customers.title")}
        hint={t("customers.customers.hint")}
        footer={<Counter event="lists.customers" testId="lists-customers-requests" />}
      >
        <Customers customers={form.customers} />
      </Block>

      <Block
        testId="lists-invoices"
        title={t("customers.invoices.title")}
        hint={t("customers.invoices.hint")}
        footer={<Counter event="lists.invoices" testId="lists-invoices-requests" />}
      >
        <Accounts accounts={form.accounts} />
      </Block>
    </ListsShell>
  );
}
