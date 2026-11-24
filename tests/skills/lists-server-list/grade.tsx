import type { ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { Checks } from "../harness";

/** What task.md asks `members.tsx` to export. */
export interface MembersModule {
  membersStore: { getValues(): Record<string, unknown> };
  MembersScreen: ComponentType;
}

interface Call {
  method: string;
  /** The query of a GET: `sort` and `dir` (null when absent). */
  sort: { sort: string | null; dir: string | null };
  body: unknown;
  /** Answer this request (inside act, so the screen settles before the next assertion). */
  respond(status: number, json: unknown): Promise<void>;
}

const ADA_AND_LINUS = [
  { id: "m1", name: "Ada" },
  { id: "m2", name: "Linus" },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A server the check answers by hand: every `fetch` waits for `respond`. */
async function withScreen(mod: MembersModule, run: (calls: Call[]) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    new Promise((resolve) => {
      const query = new URL(url, "http://members.test").searchParams;
      calls.push({
        method: init?.method ?? "GET",
        sort: { sort: query.get("sort"), dir: query.get("dir") },
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        respond: (status, json) =>
          act(async () => {
            resolve({ ok: status < 400, status, json: async () => json });
            await settle();
          }),
      });
    }),
  );
  try {
    render(<mod.MembersScreen />);
    await run(calls);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
}

const nameInputs = () => screen.queryAllByRole("textbox", { name: /member name/i }) as HTMLInputElement[];
const names = () => nameInputs().map((input) => input.value);
const storeMembers = (mod: MembersModule) => mod.membersStore.getValues().members as Array<{ id: string; name: string }>;

/** Renders, waits for the first request and answers it with two members. */
async function loaded(calls: Call[]): Promise<void> {
  await waitFor(() => expect(calls).toHaveLength(1));
  await calls[0].respond(200, ADA_AND_LINUS);
  await waitFor(() => expect(names()).toEqual(["Ada", "Linus"]));
}

export const checks: Checks<MembersModule> = {
  "loads the members; the empty state never shows before the load finished": (mod) =>
    withScreen(mod, async (calls) => {
      expect(screen.queryByText(/no members yet/i)).toBeNull(); // the very first render
      await screen.findByText(/loading members/i);
      expect(screen.queryByText(/no members yet/i)).toBeNull();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("GET");

      await calls[0].respond(200, ADA_AND_LINUS);
      await waitFor(() => expect(names()).toEqual(["Ada", "Linus"]));
      expect(screen.queryByText(/loading members/i)).toBeNull();
      expect(storeMembers(mod)).toEqual(ADA_AND_LINUS);
    }),

  "an empty answer shows the empty state": (mod) =>
    withScreen(mod, async (calls) => {
      await waitFor(() => expect(calls).toHaveLength(1));
      await calls[0].respond(200, []);
      await screen.findByText(/no members yet/i);
      expect(nameInputs()).toHaveLength(0);
    }),

  "a failed load shows the error, not the empty state, and Retry loads again": (mod) =>
    withScreen(mod, async (calls) => {
      await waitFor(() => expect(calls).toHaveLength(1));
      await calls[0].respond(500, { message: "boom" });

      await screen.findByText(/could not load members/i);
      expect(screen.queryByText(/no members yet/i)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await waitFor(() => expect(calls).toHaveLength(2));
      await calls[1].respond(200, ADA_AND_LINUS);

      await waitFor(() => expect(names()).toEqual(["Ada", "Linus"]));
      expect(screen.queryByText(/could not load members/i)).toBeNull();
    }),

  "Add member shows the row at once and it takes the server id": (mod) =>
    withScreen(mod, async (calls) => {
      await loaded(calls);

      fireEvent.click(screen.getByRole("button", { name: /add member/i }));
      // Optimistic: on screen and in the store before the server answered.
      await waitFor(() => expect(names()).toEqual(["Ada", "Linus", "New member"]));
      expect(storeMembers(mod)).toHaveLength(3);
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].method).toBe("POST");
      expect(calls[1].body).toEqual({ name: "New member" });

      await calls[1].respond(201, { id: "m3", name: "New member" });
      await waitFor(() => expect(storeMembers(mod).map((member) => member.id)).toEqual(["m1", "m2", "m3"]));
      expect(names()).toEqual(["Ada", "Linus", "New member"]); // the same row, no duplicate
      expect(calls).toHaveLength(2); // confirming the row does not reload the list
    }),

  "a failed Add member removes the row again": (mod) =>
    withScreen(mod, async (calls) => {
      await loaded(calls);

      fireEvent.click(screen.getByRole("button", { name: /add member/i }));
      await waitFor(() => expect(names()).toHaveLength(3));
      await waitFor(() => expect(calls).toHaveLength(2));
      await calls[1].respond(500, { message: "boom" });

      await waitFor(() => expect(names()).toEqual(["Ada", "Linus"]));
      expect(storeMembers(mod)).toEqual(ADA_AND_LINUS);
    }),

  "the Name button asks the API to sort: one request per click, rows in the API's order": (mod) =>
    withScreen(mod, async (calls) => {
      await loaded(calls);
      expect(calls[0].sort).toEqual({ sort: null, dir: null });
      const nameButton = () => screen.getByRole("button", { name: /^name/i });

      fireEvent.click(nameButton());
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toMatchObject({ method: "GET", sort: { sort: "name", dir: "asc" } });
      await calls[1].respond(200, ADA_AND_LINUS);
      await waitFor(() => expect(names()).toEqual(["Ada", "Linus"]));

      fireEvent.click(nameButton());
      await waitFor(() => expect(calls).toHaveLength(3));
      expect(calls[2].sort).toEqual({ sort: "name", dir: "desc" });
      await calls[2].respond(200, [ADA_AND_LINUS[1], ADA_AND_LINUS[0]]);
      await waitFor(() => expect(names()).toEqual(["Linus", "Ada"]));

      fireEvent.click(nameButton());
      await waitFor(() => expect(calls).toHaveLength(4));
      expect(calls[3].sort).toEqual({ sort: null, dir: null }); // the server's own order again
      await calls[3].respond(200, [ADA_AND_LINUS[1], ADA_AND_LINUS[0]]);
      await waitFor(() => expect(names()).toEqual(["Linus", "Ada"])); // as the server sent them
      await act(() => settle());
      expect(calls).toHaveLength(4);
    }),

  "typing in a row changes that member in the store": (mod) =>
    withScreen(mod, async (calls) => {
      await loaded(calls);

      fireEvent.change(nameInputs()[0], { target: { value: "Ada Lovelace" } });
      await waitFor(() => expect(names()).toEqual(["Ada Lovelace", "Linus"]));
      expect(storeMembers(mod)).toEqual([
        { id: "m1", name: "Ada Lovelace" },
        { id: "m2", name: "Linus" },
      ]);
    }),
};
