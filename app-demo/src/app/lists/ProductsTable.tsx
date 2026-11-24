"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode, PalistorList, PalistorRef, SortKey, SortProxyNode } from "@palistor";

import { buttonClass, Skeleton } from "@/app/ssr/shared/ui";

import { ProductFilters } from "./ProductFilters";
import type { Product } from "./productsBackend";
import { PriceInput } from "./productsFields";

type Align = "left" | "right" | "center";

/** What the products list sorts by: every field of a product (`sort: true`). */
type ProductKey = SortKey<Product>;

/** One column per field, in display order; each header sorts by its field. */
const COLUMNS = [
  { key: "title", align: "left" },
  { key: "price", align: "right" },
  { key: "category", align: "left" },
  { key: "inStock", align: "center" },
  { key: "createdAt", align: "left" },
  { key: "rating", align: "right" },
] as const satisfies ReadonlyArray<{ key: ProductKey; align: Align }>;

const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };
const JUSTIFY: Record<Align, string> = { left: "justify-start", right: "justify-end", center: "justify-center" };

/**
 * The products list: the filter panel, the "N of M" line, "Re-sort", "Add
 * row" and the table. It gets the list node (and the favorites list for the ☆
 * of each row) and hands the header cells the list's sort node and each row
 * its own node.
 */
export function ProductsTable({
  products,
  favorites,
}: {
  products: PalistorList<Product>;
  favorites: PalistorList<Product>;
}) {
  const t = useTranslations("lists.products");
  const list = useForm(products);
  const filter = list.filter!; // typed optional; present because the config declares the block
  const sort = list.sort!; // the same for the sort block
  const shown = list.length; // this read starts the load: keep it above the branches

  function addRow() {
    // The tmp-id format add() would generate itself; a server would hand back the real id (store.rekey).
    list.add({
      id: `_tmp_${crypto.randomUUID()}`,
      title: t("newTitle"),
      price: 0,
      category: "",
      inStock: true,
      createdAt: new Date().toISOString(),
      rating: null,
    });
  }

  return (
    <div className="space-y-4">
      <ProductFilters filter={filter} />

      {list.resolveStatus === "error" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {t("loadFailed")}
          <button type="button" className={buttonClass("danger")} onClick={list.reload}>
            {t("retry")}
          </button>
        </div>
      ) : list.resolveStatus !== "resolved" ? (
        // "idle" in the server's HTML and the hydrating render, then "pending".
        <Skeleton testId="lists-products-skeleton" rows={6} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p data-testid="lists-products-summary" className="text-zinc-600 dark:text-zinc-400">
              <span data-testid="lists-products-shown">{t("shown", { shown, total: list.fullLength ?? shown })}</span>
              <PriceRangeNote field={filter.priceRange} />
            </p>
            <span className="flex gap-2">
              <ResortButton sort={sort} />
              <button type="button" data-testid="lists-products-add" className={buttonClass("primary")} onClick={addRow}>
                {t("add")}
              </button>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table data-testid="lists-products-table" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  {COLUMNS.map((column) => (
                    <SortHeader key={column.key} sort={sort} column={column.key} align={column.align}>
                      {t(`columns.${column.key}`)}
                    </SortHeader>
                  ))}
                  <th scope="col" className="w-10">
                    <span className="sr-only">{t("favorite")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((product, _index, id) => (
                  <ProductRow key={id} product={product} favorites={favorites} />
                ))}
                {shown === 0 && (
                  <tr>
                    <td data-testid="lists-products-empty" colSpan={COLUMNS.length + 1} className="py-6 text-center text-zinc-400 dark:text-zinc-500">
                      {t("empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The header cell of one column: a button that steps its field through the
 * sort cycle (none → ascending → descending → none). It gets the list's sort
 * node and subscribes to it with its own useForm, so a sort change re-renders
 * the headers; a row re-renders only when its own values change.
 */
function SortHeader({
  sort,
  column,
  align,
  children,
}: {
  sort: SortProxyNode<ProductKey>;
  column: ProductKey;
  align: Align;
  children: React.ReactNode;
}) {
  const s = useForm(sort);
  const dir = s.dirOf(column);

  return (
    <th
      scope="col"
      data-testid={`lists-products-col-${column}`}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      className={`px-2 py-2 font-medium ${ALIGN[align]}`}
    >
      <button
        type="button"
        onClick={() => s.toggle(column)}
        className={`inline-flex w-full items-center gap-1 ${JUSTIFY[align]} ${
          dir ? "text-blue-600 dark:text-blue-400" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        {children}
        <span aria-hidden="true" className="w-3 text-xs">
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}
        </span>
      </button>
    </th>
  );
}

/**
 * Orders the rows again by their current values (`sort.refresh()`): the order
 * is a snapshot, so an edited value or an added row waits for this, or for the
 * next header click. Disabled while nothing is sorted.
 */
function ResortButton({ sort }: { sort: SortProxyNode<ProductKey> }) {
  const t = useTranslations("lists.products");
  const s = useForm(sort);

  return (
    <button
      type="button"
      data-testid="lists-products-resort"
      className={buttonClass("neutral")}
      disabled={s.key === null}
      onClick={() => s.refresh()}
    >
      {t("resort")}
    </button>
  );
}

function ProductRow({ product, favorites }: { product: PalistorRef<Product>; favorites: PalistorList<Product> }) {
  const row = useForm(product); // the row's own subscription: an edit re-renders this row only
  const rating = row.rating.value;

  return (
    <tr data-testid="lists-products-row" data-id={row.id} className="border-b border-zinc-100 dark:border-zinc-800">
      <td data-testid="lists-products-title" className="px-2 py-1.5 text-zinc-900 dark:text-zinc-100">
        {row.title.value}
      </td>
      <td className="px-2 py-1.5 text-right">
        <PriceInput field={row.price} testId="lists-products-price" />
      </td>
      <td data-testid="lists-products-category" className="px-2 py-1.5 text-zinc-600 dark:text-zinc-300">
        {row.category.value}
      </td>
      <td data-testid="lists-products-in-stock" className="px-2 py-1.5 text-center">
        {row.inStock.value ? "✓" : "—"}
      </td>
      <td data-testid="lists-products-created" className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-300">
        {row.createdAt.value.slice(0, 10)}
      </td>
      <td data-testid="lists-products-rating" className="px-2 py-1.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
        {rating === null ? "—" : rating.toFixed(1)}
      </td>
      <td className="px-2 py-1.5 text-center">
        <FavoriteToggle favorites={favorites} id={row.id} />
      </td>
    </tr>
  );
}

/** ☆ / ★: whether this entity is in the favorites list; a click adds it there (add(id)) or takes it out (remove(id)). */
function FavoriteToggle({ favorites, id }: { favorites: PalistorList<Product>; id: string }) {
  const t = useTranslations("lists.products");
  const list = useForm(favorites);
  const on = list.getById(id) !== undefined;

  return (
    <button
      type="button"
      data-testid="lists-products-favorite"
      aria-pressed={on}
      aria-label={on ? t("unfavorite") : t("favorite")}
      title={on ? t("unfavorite") : t("favorite")}
      onClick={() => (on ? list.remove(id) : list.add(id))}
      className={`text-lg leading-none ${on ? "text-amber-500" : "text-zinc-400 hover:text-amber-500"}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/** " · Price: 10–50" while the derived `priceRange` filter field has a value. */
function PriceRangeNote({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  if (!f.value) return null;

  return (
    <>
      {" · "}
      {f.label}: <span data-testid="lists-products-range" className="font-mono">{f.value}</span>
    </>
  );
}
