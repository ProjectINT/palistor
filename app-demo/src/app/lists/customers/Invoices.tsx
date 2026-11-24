"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorEntityProxy, PalistorList, PalistorRef } from "@palistor";

import { Counter } from "@/app/ssr/shared/Block";
import { Skeleton } from "@/app/ssr/shared/ui";

import type { Account, Invoice } from "./backend";
import { INVOICES_PAGE_SIZE } from "./customersConfig";
import { Pager } from "./Pager";

/** The row type does not describe the nested list: add it by hand. */
type AccountProxy = PalistorEntityProxy<Account> & { invoices: PalistorList<Invoice> };

/**
 * Block (2): accounts, each with an `invoices` list nested in its row. The
 * nested list declares `resolve.pagination`, so every account row has its own
 * instance: its own page, its own cache, its own requests. Four levels, each
 * on the node its parent handed down: the accounts list, an account row, the
 * row's `invoices` list, an invoice row.
 */
export function Accounts({ accounts }: { accounts: PalistorList<Account> }) {
  const list = useForm(accounts);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {list.map((account, _index, id) => (
        <AccountCard key={id} account={account} />
      ))}
    </div>
  );
}

function AccountCard({ account }: { account: PalistorRef<Account> }) {
  const t = useTranslations("lists.customers.invoices");
  const row = useForm(account) as AccountProxy;

  return (
    <div
      data-testid="lists-invoices-account"
      className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 space-y-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 data-testid="lists-invoices-account-name" className="font-semibold text-zinc-900 dark:text-zinc-100">
          {row.name.value}
        </h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{row.city.value}</span>
      </div>
      <InvoiceList invoices={row.invoices} />
      <div className="text-xs text-zinc-400 dark:text-zinc-500">
        {/* This account's own resolver calls: paging another account does not move it. */}
        <Counter event={`lists.invoices.${row.id}`} testId="lists-invoices-account-requests" label={t("requests")} />
      </div>
    </div>
  );
}

/** One account's instance of the nested list: its rows and its own pager. */
function InvoiceList({ invoices }: { invoices: PalistorList<Invoice> }) {
  const t = useTranslations("lists.customers.invoices");
  const list = useForm(invoices);

  // Reading `isInitialLoading` asks for this instance: true in the server's
  // HTML and in the browser's first render; then each account loads its first
  // page once.
  if (list.isInitialLoading) return <Skeleton testId="lists-invoices-skeleton" rows={INVOICES_PAGE_SIZE} />;

  return (
    <div className="space-y-2">
      <ul data-testid="lists-invoices-rows" className={`space-y-1 ${list.isFetching ? "opacity-50" : ""}`}>
        {list.map((invoice, _index, id) => (
          <InvoiceRow key={id} invoice={invoice} />
        ))}
      </ul>
      {list.length === 0 && (
        <p data-testid="lists-invoices-empty" className="text-sm text-zinc-400 dark:text-zinc-500">
          {t("empty")}
        </p>
      )}
      <Pager testId="lists-invoices" list={invoices} total={(count) => t("total", { count })} />
    </div>
  );
}

const STATUS_TONE: Record<Invoice["status"], string> = {
  paid: "text-emerald-600 dark:text-emerald-400",
  open: "text-blue-600 dark:text-blue-400",
  overdue: "text-red-600 dark:text-red-400",
};

function InvoiceRow({ invoice }: { invoice: PalistorRef<Invoice> }) {
  const t = useTranslations("lists.customers.invoices");
  const format = useFormatter();
  const row = useForm(invoice);

  return (
    <li
      data-testid="lists-invoices-row"
      className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 px-2 py-1.5 rounded-md bg-white dark:bg-zinc-900 text-sm"
    >
      <span data-testid="lists-invoices-number" className="font-mono text-zinc-900 dark:text-zinc-100">
        {row.number.value}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {row.issued.value} · <span className={STATUS_TONE[row.status.value]}>{t(`statuses.${row.status.value}`)}</span>
      </span>
      <span className="font-mono text-zinc-700 dark:text-zinc-300">
        {format.number(row.amount.value, { style: "currency", currency: "USD" })}
      </span>
    </li>
  );
}
