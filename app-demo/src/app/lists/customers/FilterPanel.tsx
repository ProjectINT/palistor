"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FilterProxyNode } from "@palistor";

import { SelectField, TextField, buttonClass } from "@/app/ssr/shared/ui";

import type { Role, Status } from "./backend";

const ROLES: readonly Role[] = ["admin", "manager", "agent", "viewer"];
const STATUSES: readonly Status[] = ["active", "trial", "suspended"];

/**
 * The panel of manual filter fields (`$apply: "manual"`). Its inputs show the
 * drafts: choosing or typing here changes no row and sends no request. "Apply"
 * (or Enter in the text field: it submits the form) calls `filter.apply()` —
 * one request, back to page 1; "Cancel" calls `filter.revert()` — the drafts
 * go back to the applied values, no request. The badge counts what the list
 * is filtered by (`activeCount` reads the applied values).
 */
export function FilterPanel({ filter }: { filter: FilterProxyNode }) {
  const t = useTranslations("lists.customers.customers");
  const f = useForm(filter);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    f.apply();
  };

  return (
    <form
      data-testid="lists-customers-panel"
      onSubmit={onSubmit}
      className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("panel.title")}</h3>
        {f.isActive && (
          <span
            data-testid="lists-customers-badge"
            title={t("panel.badge", { count: f.activeCount })}
            className="min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold text-center"
          >
            {f.activeCount}
          </span>
        )}
        {f.isDraft && (
          <span data-testid="lists-customers-draft" className="ml-auto text-xs text-amber-600 dark:text-amber-400">
            ● {t("panel.draft")}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          field={f.role}
          testId="lists-customers-filter-role"
          options={[{ value: "", label: t("panel.anyRole") }, ...ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }))]}
        />
        <SelectField
          field={f.status}
          testId="lists-customers-filter-status"
          options={[
            { value: "", label: t("panel.anyStatus") },
            ...STATUSES.map((status) => ({ value: status, label: t(`statuses.${status}`) })),
          ]}
        />
        <TextField field={f.city} testId="lists-customers-filter-city" />
      </div>

      <div className="flex gap-2">
        {/* Disabled while nothing differs from the applied values: Enter then does nothing either. */}
        <button type="submit" data-testid="lists-customers-apply" disabled={!f.isDraft} className={buttonClass("primary")}>
          {t("panel.apply")}
        </button>
        <button
          type="button"
          data-testid="lists-customers-cancel"
          disabled={!f.isDraft}
          onClick={() => f.revert()}
          className={buttonClass("neutral")}
        >
          {t("panel.cancel")}
        </button>
      </div>
    </form>
  );
}
