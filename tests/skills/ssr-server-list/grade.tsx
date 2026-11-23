import type { ComponentType, ReactElement } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, vi } from "vitest";
import type { Checks } from "../harness";

interface Customer {
  id: string;
  name: string;
}

/** What task.md asks `customersView.tsx` to export. */
export interface CustomersModule {
  CustomersView: ComponentType<{ accountId: string; customers: Customer[] }>;
}

interface Call {
  url: string;
  /** Answer this request (inside act, so the screen settles before the next assertion). */
  respond(json: unknown): Promise<void>;
}

const ADA_AND_LINUS: Customer[] = [
  { id: "c1", name: "Ada" },
  { id: "c2", name: "Linus" },
];
const GRACE: Customer[] = [{ id: "c7", name: "Grace" }];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Renders the way the route's server pass does: `window` is not defined while
 * the HTML is produced (the test environment is jsdom, the browser's side).
 */
function renderOnServer(page: ReactElement): string {
  const browserWindow = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Object.defineProperty(globalThis, "window", { value: undefined, configurable: true, writable: true });
  try {
    return renderToString(page);
  } finally {
    Object.defineProperty(globalThis, "window", browserWindow);
  }
}

interface Session {
  /** Every `fetch` so far, on either side. The check answers them by hand. */
  calls: Call[];
  /** The server's HTML for the page. */
  html: string;
  /** Puts the server's HTML into the document and hydrates it; returns what React reported. */
  hydrate(): Promise<{ mismatches: unknown[] }>;
}

/** One request to the route: the server pass, then (on demand) the browser pass over its HTML. */
async function withPage(page: () => ReactElement, run: (session: Session) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string) =>
    new Promise((resolve) => {
      calls.push({
        url: String(url),
        respond: (json) =>
          act(async () => {
            resolve({ ok: true, status: 200, json: async () => json });
            await settle();
          }),
      });
    }),
  );
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | undefined;
  try {
    const html = renderOnServer(page());
    await settle();
    await run({
      calls,
      html,
      hydrate: async () => {
        const mismatches: unknown[] = [];
        container.innerHTML = html;
        await act(async () => {
          root = hydrateRoot(container, page(), { onRecoverableError: (error) => mismatches.push(error) });
          await settle();
        });
        for (const [message] of consoleError.mock.calls) {
          if (/hydrat/i.test(String(message))) mismatches.push(message);
        }
        return { mismatches };
      },
    });
  } finally {
    act(() => root?.unmount());
    container.remove();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  }
}

const names = (scope: HTMLElement = document.body) =>
  within(scope).queryAllByRole("listitem").map((item) => item.textContent);

const searchBox = (scope: HTMLElement = document.body) =>
  within(scope).getByRole("textbox", { name: /search customers/i }) as HTMLInputElement;

export const checks: Checks<CustomersModule> = {
  "the server's HTML has the customers and the translated label, and the server calls no API": (mod) =>
    withPage(
      () => <mod.CustomersView accountId="acc-1" customers={ADA_AND_LINUS} />,
      async ({ html, calls }) => {
        expect(html).toContain("Ada");
        expect(html).toContain("Linus");
        expect(html).toContain("Search customers");
        expect(html).not.toContain("customers.search");
        expect(calls).toHaveLength(0);
      },
    ),

  "the browser hydrates the server's HTML without a mismatch and does not request the list again": (mod) =>
    withPage(
      () => <mod.CustomersView accountId="acc-1" customers={ADA_AND_LINUS} />,
      async ({ calls, hydrate }) => {
        const { mismatches } = await hydrate();
        expect(mismatches).toEqual([]);
        await act(async () => { await settle(); });
        expect(calls).toHaveLength(0);
        expect(names()).toEqual(["Ada", "Linus"]);
        expect(searchBox().value).toBe("");
      },
    ),

  "typing in the search box loads the list for the account and the search text": (mod) =>
    withPage(
      () => <mod.CustomersView accountId="acc-1" customers={ADA_AND_LINUS} />,
      async ({ calls, hydrate }) => {
        await hydrate();
        const before = calls.length;

        fireEvent.change(searchBox(), { target: { value: "gra" } });
        await waitFor(() => expect(calls).toHaveLength(before + 1));
        const request = new URL(calls[before].url, "http://app.test");
        expect(request.pathname).toBe("/api/accounts/acc-1/customers");
        expect(request.searchParams.get("search")).toBe("gra");

        await calls[before].respond(GRACE);
        await waitFor(() => expect(names()).toEqual(["Grace"]));
        expect(searchBox().value).toBe("gra");
        expect(calls).toHaveLength(before + 1);
      },
    ),

  "two screens on one page keep their own customers and their own search": (mod) =>
    withPage(
      () => (
        <>
          <div data-testid="first"><mod.CustomersView accountId="acc-1" customers={ADA_AND_LINUS} /></div>
          <div data-testid="second"><mod.CustomersView accountId="acc-2" customers={GRACE} /></div>
        </>
      ),
      async ({ calls, hydrate }) => {
        await hydrate();
        const first = screen.getByTestId("first");
        const second = screen.getByTestId("second");
        expect(names(first)).toEqual(["Ada", "Linus"]);
        expect(names(second)).toEqual(["Grace"]);
        const before = calls.length;

        fireEvent.change(searchBox(second), { target: { value: "x" } });
        await waitFor(() => expect(calls).toHaveLength(before + 1));
        expect(new URL(calls[before].url, "http://app.test").pathname).toBe("/api/accounts/acc-2/customers");
        await calls[before].respond([]);

        await waitFor(() => expect(names(second)).toEqual([]));
        expect(names(first)).toEqual(["Ada", "Linus"]);
        expect(searchBox(first).value).toBe("");
      },
    ),
};
