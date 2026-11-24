// The "backend" of /lists/customers. Two sides use it:
//
// - the Server Component (page.cube.tsx) reads the accounts, as it would
//   query a database: they reach the store as `initialData`;
// - the browser calls the fake endpoints from the store's resolvers. They
//   answer from the JSON files after a delay and count their calls
//   (@/app/ssr/shared/events) — nothing here touches the network.
//
// The rows are fixed (no randomness), so the specs can compute what a page
// or a search returns from the same files.

import type { PagedResult, PageRequest } from "@palistor";

import { fakeRequest, track } from "@/app/ssr/shared/events";

import accountTable from "./accounts.json";
import customerTable from "./customers.json";
import invoiceTable from "./invoices.json";

export type Role = "admin" | "manager" | "agent" | "viewer";
export type Status = "active" | "trial" | "suspended";
export type InvoiceStatus = "paid" | "open" | "overdue";

export interface Customer {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: Status;
  city: string;
}

/** An account row as the list's template sees it; `invoices` is a list nested in the row. */
export interface Account {
  id: string;
  name: string;
  city: string;
}

export interface Invoice {
  id: string;
  number: string;
  /** ISO date, `YYYY-MM-DD`. */
  issued: string;
  amount: number;
  status: InvoiceStatus;
}

/**
 * The query the customers endpoint takes. The store does not send its filter
 * values as they are: the filter block's `$toParams` builds this object
 * (customersConfig.ts). A key is present only when it filters something.
 */
export interface CustomerQuery {
  /** Case-insensitive substring of the name, the email or the city. */
  q?: string;
  role?: Role;
  status?: Status;
  /** Case-insensitive substring of the city. */
  city?: string;
}

const CUSTOMERS = customerTable as Customer[];
const ACCOUNTS = accountTable as Account[];
const INVOICES = invoiceTable as Array<Invoice & { accountId: string }>;

// ─── Queries ─────────────────────────────────────────────────────────────────

const contains = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());

/** The customers that match every key of `query`, one page by offset, with the total. */
export function queryCustomers(query: CustomerQuery, page: { offset: number; pageSize: number }): PagedResult<Customer> {
  const { q, role, status, city } = query;
  const rows = CUSTOMERS.filter(
    (c) =>
      (!q || [c.name, c.email, c.city].some((text) => contains(text, q))) &&
      (!role || c.role === role) &&
      (!status || c.status === status) &&
      (!city || contains(c.city, city)),
  );
  return { items: rows.slice(page.offset, page.offset + page.pageSize), total: rows.length };
}

/** The accounts: what the Server Component hands to the store. */
export function queryAccounts(): Account[] {
  return ACCOUNTS;
}

/** One account's invoices, newest first, one page by offset, with the total. */
export function queryInvoices(accountId: string, page: { offset: number; pageSize: number }): PagedResult<Invoice> {
  const rows = INVOICES.filter((invoice) => invoice.accountId === accountId).map(
    ({ id, number, issued, amount, status }): Invoice => ({ id, number, issued, amount, status }),
  );
  return { items: rows.slice(page.offset, page.offset + page.pageSize), total: rows.length };
}

// ─── Fake endpoints (browser only) ───────────────────────────────────────────

/** Counted under "lists.customers". Logs the request it received first (see `lastCustomerRequest`). */
export function fetchCustomers(query: CustomerQuery, page: PageRequest): Promise<PagedResult<Customer>> {
  received(query, page);
  return fakeRequest("lists.customers", () => queryCustomers(query, page), 500);
}

/** Counted under "lists.invoices" (every account) and "lists.invoices.<accountId>". */
export function fetchInvoices(accountId: string, page: PageRequest): Promise<PagedResult<Invoice>> {
  track("lists.invoices");
  return fakeRequest(`lists.invoices.${accountId}`, () => queryInvoices(accountId, page), 500);
}

// ─── The last request the customers endpoint received ────────────────────────
// Module-level for the browser tab, like the counters: shown under the filters
// (LastRequest.tsx) and read by e2e/lists-filters.spec.ts. Nothing is logged
// on the server, where a store calls no resolver.

let lastRequest: string | null = null;
const listeners = new Set<() => void>();

/** The request as a URL line: the query's keys in the order `$toParams` set them, then the page window. */
export function formatCustomerRequest(query: CustomerQuery, page: { offset: number; pageSize: number }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  params.set("offset", String(page.offset));
  params.set("limit", String(page.pageSize));
  return `GET /api/customers?${params.toString()}`;
}

function received(query: CustomerQuery, page: PageRequest): void {
  lastRequest = formatCustomerRequest(query, page);
  listeners.forEach((listener) => listener());
}

/** The last request line, or null before the first request. */
export function lastCustomerRequest(): string | null {
  return lastRequest;
}

export function subscribeCustomerRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
