"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";

import { Block, Counter } from "@/app/ssr/shared/Block";

import { Favorites } from "./Favorites";
import { productsConfig } from "./productsConfig";
import { ProductsTable } from "./ProductsTable";
import { ListsShell } from "./shared/ListsShell";

/**
 * The client side of /lists: Products (client filter, inline edit, local
 * add) and Favorites (the same entities in a second list).
 *
 * The root of the view and the only component that sees the store: it hands
 * each block its list node, and each block calls useForm on that node and
 * hands its children their nodes — a row, a filter, a single field.
 */
export function ProductsView() {
  const t = useTranslations("lists.products");

  // One store per page instance; both lists load in the browser, once the page has committed.
  const store = usePalistor(() => ({ config: productsConfig }));
  // Only navigates: reads no state, so it never re-renders when a block below changes.
  const form = useForm(store);

  return (
    <ListsShell subtitle={t("subtitle")}>
      <Block
        testId="lists-products"
        title={t("block.title")}
        hint={t("block.hint")}
        footer={<Counter event="lists.products" testId="lists-products-requests" />}
      >
        <ProductsTable products={form.products} favorites={form.favorites} />
      </Block>

      <Block
        testId="lists-favorites"
        title={t("favorites.title")}
        hint={t("favorites.hint")}
        footer={<Counter event="lists.favorites" testId="lists-favorites-requests" />}
      >
        <Favorites favorites={form.favorites} />
      </Block>
    </ListsShell>
  );
}
