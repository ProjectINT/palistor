"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode, FilterProxyNode } from "@palistor";

import { INPUT_CLASS, Spinner } from "@/app/ssr/shared/ui";

import { AppliedFilters } from "./AppliedFilters";
import { FilterPanel } from "./FilterPanel";

/**
 * The filter controls of the customers list, on the `list.filter` node its
 * parent hands down: the quick search (applied as you type, after a pause),
 * the panel (a draft, applied on "Apply") and the chips of what the list is
 * filtered by. Only hands the node down: each piece calls useForm on it and
 * re-renders on its own.
 */
export function CustomerFilters({ filter }: { filter: FilterProxyNode }) {
  return (
    <div className="space-y-3">
      <QuickSearch filter={filter} />
      <FilterPanel filter={filter} />
      <AppliedFilters filter={filter} />
    </div>
  );
}

/** The quick search: an automatic field (`apply: "auto"`) in a manual block. */
function QuickSearch({ filter }: { filter: FilterProxyNode }) {
  const t = useTranslations("lists.customers.customers");
  const f = useForm(filter);
  const search: FieldProxyNode<string> = f.quick;
  // `isPending`: the debounce is running, the request has not been sent yet.
  const pending = f.isPending;

  return (
    <label className="block">
      <span className="flex items-center gap-2 mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {search.label}
        {pending && (
          <span
            data-testid="lists-customers-pending"
            className="inline-flex items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400"
          >
            <Spinner />
            {t("pending")}
          </span>
        )}
      </span>
      <input
        data-testid="lists-customers-search"
        type="search"
        value={search.value}
        onChange={(e) => search.onValueChange(e.target.value)}
        placeholder={search.placeholder}
        className={INPUT_CLASS}
      />
    </label>
  );
}
