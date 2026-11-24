// The store config of /lists/customers: module level, it holds no request
// data (the store itself is per component instance, CustomersView.tsx). No
// "use client": `defineList` from the package root is evaluated on the server
// as well as in the browser.

import { defineList } from "@palistor";
import type { ListResolveContext, TemplateConfig, TranslateFn } from "@palistor";

import { fetchCustomers, fetchInvoices } from "./backend";
import type { Account, Customer, CustomerQuery, Invoice, Role, Status } from "./backend";

export const CUSTOMERS_PAGE_SIZE = 8;
export const INVOICES_PAGE_SIZE = 4;

/** The filter values `$toParams` receives: every field of the block, as applied. */
export interface CustomerFilterValues {
  quick: string;
  role: Role | "";
  status: Status | "";
  city: string;
}

/**
 * Filter values → the backend's query. The store calls it for every request
 * with the values the list is filtered by — the applied ones of the panel's
 * fields, never their drafts — and hands the result to the resolver as
 * `ctx.filter.params`, in place of the default `{ quick, role, status, city }`:
 *
 * - the search is trimmed and sent as `q` (the backend's name for it), the
 *   city is trimmed;
 * - a value that filters nothing is left out, so the request carries no `q=`
 *   or `role=` for "any".
 */
export function toCustomerQuery(values: CustomerFilterValues): CustomerQuery {
  const query: CustomerQuery = {};
  const q = values.quick.trim();
  if (q) query.q = q;
  if (values.role) query.role = values.role;
  if (values.status) query.status = values.status;
  const city = values.city.trim();
  if (city) query.city = city;
  return query;
}

export const customersConfig = {
  // (1) A paginated server list with a server filter.
  customers: defineList<Customer>({
    template: {
      id: { value: "" },
      name: { value: "" },
      email: { value: "" },
      role: { value: "viewer" },
      status: { value: "active" },
      city: { value: "" },
    },
    filter: {
      // Every field of the block is a draft: the list and its requests follow it on
      // filter.apply() only (the panel's Apply button, Enter in its text field).
      $apply: "manual",
      // The exception: the quick search applies itself, 400 ms after the last keystroke.
      quick: {
        value: "",
        apply: "auto",
        debounce: 400,
        label: (t: TranslateFn) => t("lists.customers.customers.quick.label"),
        placeholder: (t: TranslateFn) => t("lists.customers.customers.quick.placeholder"),
      },
      // Manual server fields: "" means any.
      role: { value: "" as Role | "", label: (t: TranslateFn) => t("lists.customers.customers.columns.role") },
      status: { value: "" as Status | "", label: (t: TranslateFn) => t("lists.customers.customers.columns.status") },
      city: {
        value: "",
        label: (t: TranslateFn) => t("lists.customers.customers.columns.city"),
        placeholder: (t: TranslateFn) => t("lists.customers.customers.panel.cityPlaceholder"),
      },
      $toParams: (values: Record<string, unknown>): CustomerQuery => toCustomerQuery(values as unknown as CustomerFilterValues),
    },
    resolve: {
      pagination: { pageSize: CUSTOMERS_PAGE_SIZE },
      // The page comes in ctx.page, the query in ctx.filter.params (what $toParams built).
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) =>
        fetchCustomers(ctx.filter.params as CustomerQuery, ctx.page!),
    },
  }),

  // (2) Rows that each own a paginated list.
  accounts: defineList<Account>({
    // No resolver: the accounts are data the Server Component already has (`initialData`).
    // The typed template does not accept a nested list yet (TS2559): cast the template.
    template: {
      id: { value: "" },
      name: { value: "" },
      city: { value: "" },
      invoices: defineList<Invoice>({
        template: {
          id: { value: "" },
          number: { value: "" },
          issued: { value: "" },
          amount: { value: 0 },
          status: { value: "open" },
        },
        resolve: {
          // Every account row gets its own instance: its own pages, cache and request state.
          pagination: { pageSize: INVOICES_PAGE_SIZE },
          // The first argument is the owner row's values, not the form's.
          resolver: async (account: Account, _store: unknown, ctx: ListResolveContext) =>
            fetchInvoices(account.id, ctx.page!),
        },
      }),
    } as unknown as TemplateConfig<Account>,
  }),
};
