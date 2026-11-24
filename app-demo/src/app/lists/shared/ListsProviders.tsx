"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { PalistorProvider } from "@palistor";

const TOAST_MS = 4000;

interface Toast {
  id: number;
  message: string;
}

/**
 * Shared values for every `usePalistor` store of a /lists route, rendered by
 * each route's page (`page.cube.tsx`). The same idea as the /ssr routes'
 * SsrProviders, without its `{ workspace }` context (the lists need none) and
 * with toasts of their own (`lists-toast`). In an app it would sit in a
 * layout; here the root layout is shared with the store implementation, which
 * has no provider.
 *
 * - `translator` — next-intl's `t` (this sits below the root layout's
 *   IntlProvider): the stores get it in their constructor, so the server's
 *   HTML is translated. Config texts use full keys: `(t) => t("lists.orders.…")`.
 * - `notifier` — `ctx.notify` of resolver `onError` callbacks: shows a toast.
 */
export function ListsProviders({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Stable: a new notifier would be pushed into every store on each render.
  const notify = useCallback((message: unknown) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message: String(message) }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), TOAST_MS);
  }, []);

  return (
    <PalistorProvider translator={t} notifier={notify}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-50">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              data-testid="lists-toast"
              role="status"
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-xs"
            >
              <span className="text-red-200">✕</span>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </PalistorProvider>
  );
}
