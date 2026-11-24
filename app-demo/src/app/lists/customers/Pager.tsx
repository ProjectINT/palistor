"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorList } from "@palistor";

import { Spinner, buttonClass } from "@/app/ssr/shared/ui";

import type { Customer, Invoice } from "./backend";

/**
 * Prev / Next, "Page x of y" and the total for the paginated list it is
 * handed; a spinner while a page is being fetched. A page seen before is in
 * the list's cache: going back to it is synchronous and sends no request.
 * Navigation waits while a page is loading.
 *
 * `testId` prefixes the controls: `<testId>-prev`, `-next`, `-status`,
 * `-total`, `-busy`.
 */
export function Pager<Row extends Customer | Invoice>({
  testId,
  list: node,
  total,
}: {
  testId: string;
  list: PalistorList<Row>;
  /** The total in words (`count` is the server's total). */
  total: (count: number) => string;
}) {
  const t = useTranslations("lists.customers.pager");
  // The paging members are typed optional: present because the list declares `resolve.pagination`.
  const list = useForm(node);
  const page = list.page!;
  const pageCount = Math.max(1, list.pageCount!);
  const busy = list.isFetching!;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <button
        data-testid={`${testId}-prev`}
        disabled={!list.hasPrevPage || busy}
        onClick={list.prevPage}
        className={buttonClass("neutral")}
      >
        ← {t("prev")}
      </button>
      <button
        data-testid={`${testId}-next`}
        disabled={!list.hasNextPage || busy}
        onClick={list.nextPage}
        className={buttonClass("neutral")}
      >
        {t("next")} →
      </button>
      <span data-testid={`${testId}-status`}>{t("pageOf", { page, count: pageCount })}</span>
      {busy && <Spinner testId={`${testId}-busy`} />}
      <span data-testid={`${testId}-total`} className="ml-auto">
        {total(list.total ?? 0)}
      </span>
    </div>
  );
}
