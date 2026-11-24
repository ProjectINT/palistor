import type { ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { Checks } from "../harness";

/** What task.md asks `products.tsx` to export. */
export interface ProductsModule {
  productsStore: { getValues(): Record<string, unknown> };
  ProductsScreen: ComponentType;
}

/**
 * Seven products in the server's order: page 1 is p1…p5, page 2 is p6 and p7. The cheapest product (Bed)
 * is on page 2, so a sort of page 1 alone is told apart from a sort of the list.
 */
const PRODUCTS = [
  { id: "p1", name: "Lamp 10", price: 30, rating: 4 },
  { id: "p2", name: "desk", price: 12, rating: null },
  { id: "p3", name: "Lamp 2", price: 25, rating: 5 },
  { id: "p4", name: "Chair", price: 45, rating: 3 },
  { id: "p5", name: "Shelf", price: 8, rating: null },
  { id: "p6", name: "Bed", price: 5, rating: 2 },
  { id: "p7", name: "armchair", price: 60, rating: 5 },
];
const SERVER_PAGE_1 = ["Lamp 10", "desk", "Lamp 2", "Chair", "Shelf"];

const settle = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Server {
  requests: number;
  /** Answers the first request (held until now when the screen was rendered with `held`). */
  release(): Promise<void>;
}

async function withScreen(mod: ProductsModule, run: (server: Server) => Promise<void>, held = false): Promise<void> {
  const waiting: Array<() => void> = [];
  let holding = held;
  const server: Server = {
    requests: 0,
    release: () =>
      act(async () => {
        holding = false;
        for (const answer of waiting.splice(0)) answer();
        await settle();
      }),
  };
  vi.stubGlobal("fetch", () =>
    new Promise((resolve) => {
      server.requests++;
      const answer = () => resolve({ ok: true, status: 200, json: async () => PRODUCTS.map((p) => ({ ...p })) });
      if (holding) waiting.push(answer);
      else answer();
    }),
  );
  try {
    render(<mod.ProductsScreen />);
    await run(server);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
}

const bodyRows = () => Array.from(document.querySelectorAll("tbody tr"));
const cell = (row: Element, i: number) => row.querySelectorAll("td")[i];
const names = () => bodyRows().map((row) => cell(row, 0)?.textContent?.trim());
const ratings = () => bodyRows().map((row) => cell(row, 2)?.textContent?.trim());
const shows = (expected: string[]) => waitFor(() => expect(names()).toEqual(expected));
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const header = (name: RegExp) => screen.getByRole("columnheader", { name });
const sortOf = (name: RegExp) => header(name).getAttribute("aria-sort");
const press = (name: RegExp) => fireEvent.click(within(header(name)).getByRole("button"));
const expectUnsorted = (name: RegExp) => expect(["none", null]).toContain(sortOf(name));
/** Lets pending work finish, so "no request was sent" is a real observation. */
const quiet = () => act(() => settle(30));

export const checks: Checks<ProductsModule> = {
  "loads the products once and shows page 1 in the API's order": (mod) =>
    withScreen(mod, async (server) => {
      await screen.findByText(/loading products/i);
      await waitFor(() => expect(server.requests).toBe(1));
      await server.release();
      await shows(SERVER_PAGE_1);
      screen.getByText(/page 1 of 2/i);
      expect(button(/previous/i).disabled).toBe(true);
      expect(button(/next/i).disabled).toBe(false);
      expectUnsorted(/price/i);
      fireEvent.click(button(/next/i));
      await shows(["Bed", "armchair"]);
      screen.getByText(/page 2 of 2/i);
      expect(button(/next/i).disabled).toBe(true);
      await quiet();
      expect(server.requests).toBe(1);
    }, true),

  "a header click sorts all products, not only the page on screen": (mod) =>
    withScreen(mod, async (server) => {
      await shows(SERVER_PAGE_1);
      press(/price/i);
      await shows(["Bed", "Shelf", "desk", "Lamp 2", "Lamp 10"]);
      expect(sortOf(/price/i)).toBe("ascending");
      expectUnsorted(/name/i);
      expectUnsorted(/rating/i);
      fireEvent.click(button(/next/i));
      await shows(["Chair", "armchair"]);
      await quiet();
      expect(server.requests).toBe(1);
    }),

  "the second click sorts descending, the third restores the API's order": (mod) =>
    withScreen(mod, async (server) => {
      await shows(SERVER_PAGE_1);
      press(/price/i);
      await shows(["Bed", "Shelf", "desk", "Lamp 2", "Lamp 10"]);
      press(/price/i);
      await shows(["armchair", "Chair", "Lamp 10", "Lamp 2", "desk"]);
      expect(sortOf(/price/i)).toBe("descending");
      press(/price/i);
      await shows(SERVER_PAGE_1);
      expectUnsorted(/price/i);
      await quiet();
      expect(server.requests).toBe(1);
    }),

  "names sort naturally, upper and lower case alike": (mod) =>
    withScreen(mod, async (server) => {
      await shows(SERVER_PAGE_1);
      press(/name/i);
      await shows(["armchair", "Bed", "Chair", "desk", "Lamp 2"]);
      press(/name/i);
      await shows(["Shelf", "Lamp 10", "Lamp 2", "desk", "Chair"]);
      await quiet();
      expect(server.requests).toBe(1);
    }),

  "products without a rating stay at the end in both directions": (mod) =>
    withScreen(mod, async (server) => {
      await shows(SERVER_PAGE_1);
      press(/rating/i);
      await waitFor(() => expect(ratings()).toEqual(["2", "3", "4", "5", "5"]));
      fireEvent.click(button(/next/i));
      await waitFor(() => expect([...names()].sort()).toEqual(["Shelf", "desk"]));
      fireEvent.click(button(/previous/i));
      press(/rating/i);
      await waitFor(() => expect(ratings()).toEqual(["5", "5", "4", "3", "2"]));
      fireEvent.click(button(/next/i));
      await waitFor(() => expect([...names()].sort()).toEqual(["Shelf", "desk"]));
      await quiet();
      expect(server.requests).toBe(1);
    }),

  "an edited price stays in place until Re-sort": (mod) =>
    withScreen(mod, async (server) => {
      await shows(SERVER_PAGE_1);
      press(/price/i);
      await shows(["Bed", "Shelf", "desk", "Lamp 2", "Lamp 10"]);

      const bed = bodyRows()[0];
      fireEvent.change(within(bed as HTMLElement).getByLabelText(/price/i), { target: { value: "100" } });
      await waitFor(() => {
        const products = mod.productsStore.getValues().products as Array<{ id: string; price: unknown }>;
        expect(products.find((p) => p.id === "p6")?.price).toBe(100);
      });
      await quiet();
      expect(names()).toEqual(["Bed", "Shelf", "desk", "Lamp 2", "Lamp 10"]); // no jump while editing
      expect((within(bodyRows()[0] as HTMLElement).getByLabelText(/price/i) as HTMLInputElement).value).toBe("100");

      fireEvent.click(button(/re-?sort/i));
      await shows(["Shelf", "desk", "Lamp 2", "Lamp 10", "Chair"]);
      fireEvent.click(button(/next/i));
      await shows(["armchair", "Bed"]);
      await quiet();
      expect(server.requests).toBe(1);
    }),
};
