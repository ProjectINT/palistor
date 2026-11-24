"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode, FilterProxyNode } from "@palistor";

import type { CustomerFilterValues } from "./customersConfig";

type FilterKey = keyof CustomerFilterValues;
const FIELDS: readonly FilterKey[] = ["quick", "role", "status", "city"];

/**
 * A chip for every filter the list is filtered by: `filter.applied`, not the
 * drafts in the panel. ✕ on a panel filter is `clear(field)` + `apply()` — one
 * request (`apply()` takes every draft: a change pending in the panel goes
 * with it). ✕ on the search is `clear("quick")` alone: an automatic field
 * issues by itself, and the panel's draft stays a draft.
 */
export function AppliedFilters({ filter }: { filter: FilterProxyNode }) {
  const t = useTranslations("lists.customers.customers");
  const f = useForm(filter);
  const applied = f.applied; // every field is a string here (customersConfig.ts)
  const valueOf = (key: FilterKey) => String(applied[key] ?? "");
  // Blank is empty, as for `activeCount`: the chips and the badge agree.
  const keys = FIELDS.filter((key) => valueOf(key).trim() !== "");

  if (keys.length === 0) return null;

  const text = (key: FilterKey, value: string) =>
    key === "role" ? t(`roles.${value}`) : key === "status" ? t(`statuses.${value}`) : value.trim();

  const remove = (key: FilterKey) => {
    f.clear(key);
    if (key !== "quick") f.apply();
  };

  return (
    <ul data-testid="lists-customers-chips" className="flex flex-wrap gap-2">
      {keys.map((key) => {
        const label = (f[key] as FieldProxyNode<string>).label ?? key;
        return (
          <li
            key={key}
            data-testid="lists-customers-chip"
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-xs text-blue-800 dark:text-blue-200"
          >
            <span>
              {label}: <span className="font-medium">{text(key, valueOf(key))}</span>
            </span>
            <button
              type="button"
              onClick={() => remove(key)}
              aria-label={t("panel.remove", { filter: label })}
              className="w-5 h-5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}
