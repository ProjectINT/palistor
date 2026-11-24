"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorList, PalistorRef } from "@palistor";

import { Skeleton, buttonClass } from "@/app/ssr/shared/ui";

import type { Customer } from "./backend";
import { CUSTOMERS_PAGE_SIZE } from "./customersConfig";
import { CustomerFilters } from "./CustomerFilters";
import { LastRequest } from "./LastRequest";
import { Pager } from "./Pager";

const CELL = "px-3 py-2 text-left";

/**
 * Block (1): a paginated server list. Only hands nodes down, so it reads no
 * state: the filter controls follow `list.filter`, the table and the pager
 * follow the list, each row follows its row.
 */
export function Customers({ customers }: { customers: PalistorList<Customer> }) {
  const list = useForm(customers);

  return (
    <div className="space-y-4">
      {/* typed optional; present because the config declares the block */}
      <CustomerFilters filter={list.filter!} />
      <LastRequest />
      <CustomerTable customers={customers} />
    </div>
  );
}

/** The rows and the pager, or what stands for them while there is nothing to show. */
function CustomerTable({ customers }: { customers: PalistorList<Customer> }) {
  const t = useTranslations("lists.customers.customers");
  const list = useForm(customers);

  // Reading `isInitialLoading` asks for the list: it is true in the server's
  // HTML (the store there runs no resolver) and in the browser's first render,
  // and again while the first page of a new search loads.
  if (list.isInitialLoading) return <Skeleton testId="lists-customers-skeleton" rows={CUSTOMERS_PAGE_SIZE} />;

  if (list.resolveStatus === "error") {
    return (
      <p data-testid="lists-customers-error" className="text-sm text-red-600 dark:text-red-400">
        {t("error")}{" "}
        <button onClick={list.reload} className={buttonClass("neutral")}>
          {t("retry")}
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        <p data-testid="lists-customers-empty" className="py-6 text-center text-zinc-400 dark:text-zinc-500">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          {/* While another page loads, the table keeps the rows it shows. */}
          <table className={`w-full text-sm ${list.isFetching ? "opacity-50" : ""}`}>
            <thead className="bg-zinc-50 dark:bg-zinc-800 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className={CELL}>{t("columns.name")}</th>
                <th className={CELL}>{t("columns.email")}</th>
                <th className={CELL}>{t("columns.role")}</th>
                <th className={CELL}>{t("columns.status")}</th>
                <th className={CELL}>{t("columns.city")}</th>
              </tr>
            </thead>
            <tbody data-testid="lists-customers-rows" className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {list.map((customer, _index, id) => (
                <CustomerRow key={id} customer={customer} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager testId="lists-customers" list={customers} total={(count) => t("total", { count })} />
    </div>
  );
}

const STATUS_TONE: Record<Customer["status"], string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  trial: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  suspended: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function CustomerRow({ customer }: { customer: PalistorRef<Customer> }) {
  const t = useTranslations("lists.customers.customers");
  const row = useForm(customer);

  return (
    <tr data-testid="lists-customers-row" className="text-zinc-800 dark:text-zinc-200">
      <td data-testid="lists-customers-name" className={`${CELL} font-medium`}>
        {row.name.value}
      </td>
      <td className={`${CELL} text-zinc-500 dark:text-zinc-400`}>{row.email.value}</td>
      <td className={CELL}>{t(`roles.${row.role.value}`)}</td>
      <td className={CELL}>
        <span className={`px-2 py-0.5 rounded-md text-xs ${STATUS_TONE[row.status.value]}`}>
          {t(`statuses.${row.status.value}`)}
        </span>
      </td>
      <td className={CELL}>{row.city.value}</td>
    </tr>
  );
}
