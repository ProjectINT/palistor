"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode, FilterProxyNode } from "@palistor";

import { buttonClass, SelectField, TextField } from "@/app/ssr/shared/ui";

import { PRODUCT_CATEGORIES } from "./productsBackend";
import { FILTER_PRESET } from "./productsConfig";
import { CheckboxField, NumberField } from "./productsFields";

/** The fields that get a chip while they hold a value, in display order (the derived priceRange has none). */
const CHIP_FIELDS = ["search", "category", "inStock", "minPrice", "maxPrice"] as const;

const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((category) => ({ value: category, label: category }));

/**
 * The filter panel of the products list: the controls (one field node each),
 * the chips of the active fields, the active count, a preset and a reset.
 * It gets the list's `filter` node and subscribes to it with its own useForm,
 * so a filter change re-renders the panel, not the list's parent.
 */
export function ProductFilters({ filter }: { filter: FilterProxyNode }) {
  const t = useTranslations("lists.products.filter");
  const f = useForm(filter);

  return (
    <div data-testid="lists-products-filters" className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2">
          <TextField field={f.search} testId="lists-products-filter-search" />
        </div>
        <SelectField
          field={f.category}
          testId="lists-products-filter-category"
          options={[{ value: "", label: t("allCategories") }, ...CATEGORY_OPTIONS]}
        />
        <NumberField field={f.minPrice} testId="lists-products-filter-min-price" />
        <NumberField field={f.maxPrice} testId="lists-products-filter-max-price" />
        <CheckboxField field={f.inStock} testId="lists-products-filter-in-stock" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          {t("active")}:{" "}
          <span
            data-testid="lists-products-active"
            className={`inline-flex min-w-6 justify-center rounded-full px-2 font-mono text-xs ${
              f.isActive ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
            }`}
          >
            {f.activeCount}
          </span>
        </span>
        {CHIP_FIELDS.map((key) => (
          <FilterChip key={key} name={key} field={f[key]} onClear={() => f.clear(key)} />
        ))}
        <span className="flex-1" />
        <button type="button" data-testid="lists-products-preset" className={buttonClass("neutral")} onClick={() => f.set(FILTER_PRESET)}>
          {t("preset")}
        </button>
        <button
          type="button"
          data-testid="lists-products-reset"
          className={buttonClass("neutral")}
          disabled={!f.isActive}
          onClick={() => f.reset()}
        >
          {t("reset")}
        </button>
      </div>
    </div>
  );
}

/** One active filter: its label and value, and ✕ that clears this field only. Renders nothing while the field is empty. */
function FilterChip({ name, field, onClear }: { name: string; field: FieldProxyNode<unknown>; onClear: () => void }) {
  const t = useTranslations("lists.products.filter");
  const f = useForm(field);
  const value = f.value;
  if (value === "" || value === null || value === undefined || value === false) return null;

  return (
    <span
      data-testid="lists-products-chip"
      data-field={name}
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 pl-3 pr-1 py-0.5 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
    >
      {value === true ? f.label : `${f.label}: ${String(value)}`}
      <button
        type="button"
        aria-label={t("removeChip", { label: f.label ?? name })}
        onClick={onClear}
        className="rounded-full w-5 h-5 leading-none hover:bg-blue-100 dark:hover:bg-blue-900"
      >
        ✕
      </button>
    </span>
  );
}
