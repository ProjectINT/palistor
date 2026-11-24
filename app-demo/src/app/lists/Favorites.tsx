"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorList, PalistorRef } from "@palistor";

import { buttonClass, Flag, Skeleton, Spinner } from "@/app/ssr/shared/ui";

import type { Product } from "./productsBackend";
import { PriceInput } from "./productsFields";

/**
 * The favorites: a second list over the products' entities. Its resolver
 * returns the saved favorites; ☆ in a product row adds more with add(id).
 * ↑ / ↓ reorder through setItems, ✕ takes a row out of this list only.
 * "Restore saved" is reload(): the loaded membership and order come back
 * (store.reset() would keep a root list's membership).
 */
export function Favorites({ favorites }: { favorites: PalistorList<Product> }) {
  const t = useTranslations("lists.products.favorites");
  const list = useForm(favorites);
  const count = list.length; // this read starts the load: keep it above the branches
  const ids = list.map((_row, _index, id) => id);

  function move(index: number, delta: -1 | 1) {
    const next = [...ids];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    list.setItems(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Flag name="dirty" value={list.dirty} testId="lists-favorites-dirty" />
        <span className="flex-1" />
        {list.loading && count > 0 && <Spinner testId="lists-favorites-busy" />}
        <button
          type="button"
          data-testid="lists-favorites-reset"
          className={buttonClass("neutral")}
          disabled={!list.dirty || list.loading}
          onClick={list.reload}
        >
          {t("reset")}
        </button>
      </div>

      {list.resolveStatus === "error" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {t("loadFailed")}
          <button type="button" className={buttonClass("danger")} onClick={list.reload}>
            {t("retry")}
          </button>
        </div>
      ) : list.loading && count === 0 ? (
        <Skeleton testId="lists-favorites-skeleton" rows={2} />
      ) : count === 0 ? (
        <p data-testid="lists-favorites-empty" className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
          {t("empty")}
        </p>
      ) : (
        <ol data-testid="lists-favorites-rows" className="space-y-1">
          {list.map((product, index, id) => (
            <FavoriteRow
              key={id}
              product={product}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === count - 1}
              onMove={(delta) => move(index, delta)}
              onRemove={() => list.remove(id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function FavoriteRow({
  product,
  position,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  product: PalistorRef<Product>;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("lists.products.favorites");
  const row = useForm(product);

  return (
    <li
      data-testid="lists-favorites-row"
      data-id={row.id}
      className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <span className="w-6 text-right font-mono text-xs text-zinc-400">{position}.</span>
      <span data-testid="lists-favorites-title" className="flex-1 font-medium text-zinc-900 dark:text-zinc-100">
        {row.title.value}
      </span>
      <PriceInput field={row.price} testId="lists-favorites-price" />
      <span className="flex gap-1">
        <button type="button" data-testid="lists-favorites-up" aria-label={t("up")} disabled={isFirst} className={buttonClass("neutral")} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" data-testid="lists-favorites-down" aria-label={t("down")} disabled={isLast} className={buttonClass("neutral")} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" data-testid="lists-favorites-remove" aria-label={t("remove")} className={buttonClass("danger")} onClick={onRemove}>
          ✕
        </button>
      </span>
    </li>
  );
}
