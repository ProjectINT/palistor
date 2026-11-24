import type { ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { Checks } from "../harness";

/** What task.md asks `customers.tsx` to export. */
export interface CustomersModule {
  customersStore: object;
  CustomersScreen: ComponentType;
}

interface Request {
  search: string;
  role: string;
  offset: number;
  limit: number;
}

const ROLES = ["admin", "editor", "viewer"];
/** Twelve customers, three pages of five; roles cycle admin, editor, viewer. */
const CUSTOMERS = [
  "Alice", "Bob", "Dana", "Ellen", "Frank", "Grace", "Hana", "Ivan", "Jana", "Karl", "Lana", "Mona",
].map((name, i) => ({ id: `c${i + 1}`, name, role: ROLES[i % 3] }));

const settle = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function answer(request: Request) {
  const matching = CUSTOMERS.filter(
    (c) => (!request.role || c.role === request.role) && c.name.toLowerCase().includes(request.search.toLowerCase()),
  );
  return { rows: matching.slice(request.offset, request.offset + request.limit), total: matching.length };
}

async function withScreen(mod: CustomersModule, run: (requests: Request[]) => Promise<void>): Promise<void> {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    const params = new URL(url, "http://customers.test").searchParams;
    const request: Request = {
      search: params.get("search") ?? "",
      role: params.get("role") ?? "",
      offset: Number(params.get("offset")),
      limit: Number(params.get("limit")),
    };
    requests.push(request);
    return Promise.resolve({ ok: true, status: 200, json: async () => answer(request) });
  });
  try {
    render(<mod.CustomersScreen />);
    await run(requests);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
}

const rows = () => screen.queryAllByRole("listitem").map((item) => item.textContent);
const shows = (names: string[]) => waitFor(() => expect(rows()).toEqual(names));
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const search = () => screen.getByRole("textbox", { name: /search/i }) as HTMLInputElement;
const role = () => screen.getByRole("combobox", { name: /role/i }) as HTMLSelectElement;
const badge = () => screen.queryByText(/filters:/i);
/** Past any debounce a solution might use: what was not sent by then is not sent. */
const quiet = () => act(() => settle(400));
/** Enter in a text box as a browser does it: key events and the implicit submission of its form. */
function pressEnter(input: HTMLInputElement) {
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
  fireEvent.keyPress(input, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
  if (input.form) fireEvent.submit(input.form);
  fireEvent.keyUp(input, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
}

const PAGE_1 = ["Alice", "Bob", "Dana", "Ellen", "Frank"];
const PAGE_2 = ["Grace", "Hana", "Ivan", "Jana", "Karl"];

export const checks: Checks<CustomersModule> = {
  "the first load shows page 1 of all customers with nothing applied": (mod) =>
    withScreen(mod, async (requests) => {
      await screen.findByText(/loading customers/i);
      await shows(PAGE_1);
      expect(requests).toEqual([{ search: "", role: "", offset: 0, limit: 5 }]);
      screen.getByText(/page 1 of 3/i);
      expect(button(/apply/i).disabled).toBe(true);
      expect(badge()).toBeNull();
      expect(Array.from(role().options).map((o) => o.value)).toEqual(["", "admin", "editor", "viewer"]);
    }),

  "editing the panel changes neither the rows nor the server": (mod) =>
    withScreen(mod, async (requests) => {
      await shows(PAGE_1);
      fireEvent.change(search(), { target: { value: "a" } });
      fireEvent.change(search(), { target: { value: "an" } });
      fireEvent.change(role(), { target: { value: "editor" } });
      await quiet();
      expect(search().value).toBe("an");
      expect(role().value).toBe("editor");
      expect(requests).toHaveLength(1);
      expect(rows()).toEqual(PAGE_1);
      screen.getByText(/page 1 of 3/i);
      expect(badge()).toBeNull();
      expect(button(/apply/i).disabled).toBe(false);
    }),

  "Apply is one request for page 1 of the filtered result": (mod) =>
    withScreen(mod, async (requests) => {
      await shows(PAGE_1);
      fireEvent.click(button(/next/i));
      await shows(PAGE_2);
      expect(requests).toHaveLength(2);

      fireEvent.change(search(), { target: { value: "an" } });
      fireEvent.change(role(), { target: { value: "viewer" } });
      await quiet();
      fireEvent.click(button(/apply/i));
      await shows(["Dana", "Jana"]); // viewers whose name contains "an"
      await quiet();
      expect(requests.slice(2)).toEqual([{ search: "an", role: "viewer", offset: 0, limit: 5 }]);
      screen.getByText(/page 1 of 1/i);
      expect(badge()?.textContent).toMatch(/filters:\s*2/i);
      expect(button(/apply/i).disabled).toBe(true);
    }),

  "Enter in the search box applies": (mod) =>
    withScreen(mod, async (requests) => {
      await shows(PAGE_1);
      fireEvent.change(search(), { target: { value: "ana" } });
      pressEnter(search());
      await shows(["Dana", "Hana", "Jana", "Lana"]);
      await quiet();
      expect(requests.slice(1)).toEqual([{ search: "ana", role: "", offset: 0, limit: 5 }]);
      expect(badge()?.textContent).toMatch(/filters:\s*1/i);
    }),

  "Cancel puts the panel back to the applied values without a request": (mod) =>
    withScreen(mod, async (requests) => {
      await shows(PAGE_1);
      fireEvent.change(search(), { target: { value: "ana" } });
      fireEvent.click(button(/apply/i));
      await shows(["Dana", "Hana", "Jana", "Lana"]);
      await quiet();
      expect(requests).toHaveLength(2);

      fireEvent.change(search(), { target: { value: "bo" } });
      fireEvent.change(role(), { target: { value: "admin" } });
      expect(button(/apply/i).disabled).toBe(false);
      fireEvent.click(button(/cancel/i));
      await waitFor(() => expect(search().value).toBe("ana"));
      expect(role().value).toBe("");
      expect(button(/apply/i).disabled).toBe(true);
      await quiet();
      expect(requests).toHaveLength(2);
      expect(rows()).toEqual(["Dana", "Hana", "Jana", "Lana"]);
      expect(badge()?.textContent).toMatch(/filters:\s*1/i);
    }),
};
