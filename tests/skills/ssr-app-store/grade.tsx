import type { ComponentType, ReactElement, ReactNode } from "react";
import { act, fireEvent, render, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, vi } from "vitest";
import type { FieldProxyNode } from "palistor";
import type { Checks } from "../harness";

interface Account {
  id: string;
  name: string;
}

/** What task.md asks `appStore.tsx` to export. */
export interface AppStoreModule {
  AppStoreProvider: ComponentType<{ account: Account | null; children: ReactNode }>;
  /** The entry of the header's client subtree: the layout, a Server Component, renders it. */
  Header: ComponentType;
  /** The entry of the settings page. */
  SettingsView: ComponentType;
  /** The shared input: on the field it is given, whichever store that field belongs to. */
  TextField: ComponentType<{ label: string; field: FieldProxyNode<string> }>;
}

const ADA: Account = { id: "u1", name: "Ada" };
const GRACE: Account = { id: "u2", name: "Grace" };

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Renders the way a request's server pass does: `window` is not defined while
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

/** The app as the root layout builds it: the provider around the header and the current page. */
const app = (mod: AppStoreModule, account: Account | null, page: ReactNode): ReactElement => (
  <mod.AppStoreProvider account={account}>
    <mod.Header />
    <main>{page}</main>
  </mod.AppStoreProvider>
);

const badge = (scope: HTMLElement) => within(scope).getByTestId("account-badge").textContent;

const nameInput = (scope: HTMLElement) =>
  within(scope).getByRole("textbox", { name: /display name/i }) as HTMLInputElement;

interface Session {
  /** The document's container: holds the server's HTML until `hydrate()`, the live app after it. */
  container: HTMLElement;
  /** Renders one more request on the server and returns its HTML ("view source"). */
  request(account: Account | null, page: ReactNode): string;
  /** Puts a request's HTML into the document and hydrates it; returns what React reported. */
  hydrate(account: Account | null, page: ReactNode): Promise<{ mismatches: unknown[] }>;
  /** A client navigation: the layout (and its provider) stays mounted, the page inside it changes. */
  navigate(account: Account | null, page: ReactNode): Promise<void>;
}

async function withApp(mod: AppStoreModule, run: (session: Session) => Promise<void>): Promise<void> {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | undefined;
  try {
    await run({
      container,
      request: (account, page) => renderOnServer(app(mod, account, page)),
      hydrate: async (account, page) => {
        const mismatches: unknown[] = [];
        container.innerHTML = renderOnServer(app(mod, account, page));
        await act(async () => {
          root = hydrateRoot(container, app(mod, account, page), {
            onRecoverableError: (error) => mismatches.push(error),
          });
          await settle();
        });
        for (const [message] of consoleError.mock.calls) {
          if (/hydrat/i.test(String(message))) mismatches.push(message);
        }
        return { mismatches };
      },
      navigate: async (account, page) => {
        await act(async () => {
          root!.render(app(mod, account, page));
          await settle();
        });
      },
    });
  } finally {
    act(() => root?.unmount());
    container.remove();
    consoleError.mockRestore();
  }
}

export const checks: Checks<AppStoreModule> = {
  "the server's HTML has the account's name in the header and in the settings input": (mod) =>
    withApp(mod, async ({ container, request }) => {
      container.innerHTML = request(ADA, <mod.SettingsView />);
      expect(badge(container)).toBe("Ada");
      expect(nameInput(container).value).toBe("Ada");
    }),

  "the browser hydrates the server's HTML without a mismatch": (mod) =>
    withApp(mod, async ({ container, hydrate }) => {
      const { mismatches } = await hydrate(ADA, <mod.SettingsView />);
      expect(mismatches).toEqual([]);
      expect(badge(container)).toBe("Ada");
      expect(nameInput(container).value).toBe("Ada");
    }),

  "typing in the settings input changes the badge in the header": (mod) =>
    withApp(mod, async ({ container, hydrate }) => {
      await hydrate(ADA, <mod.SettingsView />);

      fireEvent.change(nameInput(container), { target: { value: "Ada Lovelace" } });

      expect(nameInput(container).value).toBe("Ada Lovelace");
      expect(badge(container)).toBe("Ada Lovelace");
    }),

  "what was typed is still there after navigating to another page and back": (mod) =>
    withApp(mod, async ({ container, hydrate, navigate }) => {
      await hydrate(ADA, <mod.SettingsView />);
      fireEvent.change(nameInput(container), { target: { value: "Ada Lovelace" } });

      await navigate(ADA, <p>Orders</p>);
      expect(within(container).queryByRole("textbox")).toBeNull();
      expect(badge(container)).toBe("Ada Lovelace");

      await navigate(ADA, <mod.SettingsView />);
      expect(nameInput(container).value).toBe("Ada Lovelace");
      expect(badge(container)).toBe("Ada Lovelace");
    }),

  "requests share nothing: a signed-out visitor's HTML shows Guest after another user's page": (mod) =>
    withApp(mod, async ({ container, request }) => {
      const first = request(ADA, <mod.SettingsView />);
      expect(first).toContain("Ada");

      const signedOut = request(null, <mod.SettingsView />);
      expect(signedOut).not.toContain("Ada");
      container.innerHTML = signedOut;
      expect(badge(container)).toBe("Guest");

      const second = request(GRACE, <mod.SettingsView />);
      expect(second).not.toContain("Ada");
      container.innerHTML = second;
      expect(badge(container)).toBe("Grace");
      expect(nameInput(container).value).toBe("Grace");
    }),

  "TextField edits the field it is given: a field of another store, outside the provider": async (mod) => {
    // The same module instance the solution imported (every check gets a fresh module graph).
    const { Palistor, useForm } = await import("palistor");
    const other = new Palistor({ config: { ticket: { title: { value: "Draft" } }, note: { value: "untouched" } } });
    function Host() {
      return <mod.TextField label="Title" field={useForm(other).ticket.title} />;
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { getByRole, unmount } = render(<Host />);
      const input = getByRole("textbox", { name: /title/i }) as HTMLInputElement;
      expect(input.value).toBe("Draft");

      fireEvent.change(input, { target: { value: "Final" } });

      expect(input.value).toBe("Final");
      expect(other.getValues()).toEqual({ ticket: { title: "Final" }, note: "untouched" });
      unmount();
    } finally {
      consoleError.mockRestore();
    }
  },
};
