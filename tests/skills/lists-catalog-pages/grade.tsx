import type { ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { Checks } from "../harness";

/** What task.md asks `catalog.tsx` to export. */
export interface CatalogModule {
  catalogStore: object;
  CatalogScreen: ComponentType;
}

interface Request {
  search: string;
  offset: number;
  limit: number;
}

/** Twelve products, three pages of five; the odd ones are in stock. */
const PRODUCTS = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Product ${i + 1}`,
  inStock: (i + 1) % 2 === 1,
}));

const page = (from: number, to: number) => PRODUCTS.slice(from - 1, to).map((product) => product.name);
const PAGE_1 = page(1, 5);
const PAGE_2 = page(6, 10);

const settle = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Server {
  requests: Request[];
  /** From now on requests wait until `release()`. */
  hold(): void;
  release(): Promise<void>;
}

/** A products API over `fetch`: answers at once, or on `release()` after `hold()`. */
async function withScreen(mod: CatalogModule, run: (server: Server) => Promise<void>, held = false): Promise<void> {
  const requests: Request[] = [];
  const waiting: Array<() => void> = [];
  let holding = held;

  vi.stubGlobal("fetch", (url: string) =>
    new Promise((resolve) => {
      const params = new URL(url, "http://catalog.test").searchParams;
      const request: Request = {
        search: params.get("search") ?? "",
        offset: Number(params.get("offset")),
        limit: Number(params.get("limit")),
      };
      requests.push(request);
      const answer = () => {
        const matching = PRODUCTS.filter((product) => product.name.toLowerCase().includes(request.search.toLowerCase()));
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ rows: matching.slice(request.offset, request.offset + request.limit), total: matching.length }),
        });
      };
      if (holding) waiting.push(answer);
      else answer();
    }),
  );

  const server: Server = {
    requests,
    hold: () => { holding = true; },
    release: () =>
      act(async () => {
        holding = false;
        for (const answer of waiting.splice(0)) answer();
        await settle();
      }),
  };

  try {
    render(<mod.CatalogScreen />);
    await run(server);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
}

const rows = () => screen.queryAllByRole("listitem").map((item) => item.textContent);
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const shows = (names: string[]) => waitFor(() => expect(rows()).toEqual(names));
/** Lets pending work finish, so "no request was sent" is a real observation. */
const quiet = () => act(() => settle(50));

export const checks: Checks<CatalogModule> = {
  "the first load shows the loading text, then five rows and the pager": (mod) =>
    withScreen(mod, async (server) => {
      await screen.findByText(/loading products/i);
      await waitFor(() => expect(server.requests).toHaveLength(1));
      expect(server.requests[0]).toEqual({ search: "", offset: 0, limit: 5 });

      await server.release();
      await shows(PAGE_1);
      expect(screen.queryByText(/loading products/i)).toBeNull();
      screen.getByText(/page 1 of 3/i);
      expect(button(/previous/i).disabled).toBe(true);
      expect(button(/next/i).disabled).toBe(false);
    }, true),

  "a page change keeps the rows on screen until the new page arrives": (mod) =>
    withScreen(mod, async (server) => {
      await shows(PAGE_1);

      server.hold();
      fireEvent.click(button(/next/i));
      await waitFor(() => expect(server.requests).toHaveLength(2));
      expect(server.requests[1]).toEqual({ search: "", offset: 5, limit: 5 });
      expect(rows()).toEqual(PAGE_1); // still the old page
      expect(screen.queryByText(/loading products/i)).toBeNull();

      await server.release();
      await shows(PAGE_2);
      screen.getByText(/page 2 of 3/i);
    }),

  "a page that was loaded before is shown again without a request": (mod) =>
    withScreen(mod, async (server) => {
      await shows(PAGE_1);
      fireEvent.click(button(/next/i));
      await shows(PAGE_2);
      expect(server.requests).toHaveLength(2);

      fireEvent.click(button(/previous/i));
      await shows(PAGE_1);
      fireEvent.click(button(/next/i));
      await shows(PAGE_2);
      await quiet();
      expect(server.requests).toHaveLength(2);
    }),

  "the last page disables Next": (mod) =>
    withScreen(mod, async () => {
      await shows(PAGE_1);
      fireEvent.click(button(/next/i));
      await shows(PAGE_2);
      fireEvent.click(button(/next/i));
      await shows(page(11, 12));
      screen.getByText(/page 3 of 3/i);
      expect(button(/next/i).disabled).toBe(true);
      expect(button(/previous/i).disabled).toBe(false);
    }),

  "a burst of keystrokes is one server search that starts at page 1": (mod) =>
    withScreen(mod, async (server) => {
      await shows(PAGE_1);
      fireEvent.click(button(/next/i));
      await shows(PAGE_2);

      const search = screen.getByRole("textbox", { name: /search/i }) as HTMLInputElement;
      for (const text of ["P", "Pro", "Product 1"]) fireEvent.change(search, { target: { value: text } });
      expect(search.value).toBe("Product 1"); // the input itself never lags

      await shows(["Product 1", "Product 10", "Product 11", "Product 12"]);
      await act(() => settle(400)); // past the debounce: nothing else may follow
      expect(server.requests.filter((request) => request.search !== "")).toEqual([
        { search: "Product 1", offset: 0, limit: 5 },
      ]);
      screen.getByText(/page 1 of 1/i);
    }),

  "In stock only filters the current page without a request": (mod) =>
    withScreen(mod, async (server) => {
      await shows(PAGE_1);
      const sent = server.requests.length;

      const inStockOnly = screen.getByRole("checkbox", { name: /in stock only/i });
      fireEvent.click(inStockOnly);
      await shows(["Product 1", "Product 3", "Product 5"]);

      fireEvent.click(inStockOnly);
      await shows(PAGE_1);
      await quiet();
      expect(server.requests).toHaveLength(sent);
    }),
};
