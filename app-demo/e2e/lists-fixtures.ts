import { expect, type Page } from "./fixtures";

// Helpers for the specs of the /lists routes (src/app/lists/, Cube only).
// Every lists spec starts with
//   test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");
// and opens its route with openLists() (a direct load) or goLists() (a click
// in the nav, a client navigation).

/** The /lists routes, keyed as in ListsShell (LISTS_ROUTES) and the `lists.<key>` messages. */
export type ListsRoute = "products" | "orders" | "customers" | "feeds";

export const LISTS_ROUTES: readonly ListsRoute[] = ["products", "orders", "customers", "feeds"];

/** Where each route lives, relative to the baseURL (`/palistor/`), as page.goto and request.get take it. */
export const LISTS_PATH: Record<ListsRoute, string> = {
  products: "./lists/",
  orders: "./lists/orders/",
  customers: "./lists/customers/",
  feeds: "./lists/feeds/",
};

/** The URL once the route is open. */
export const LISTS_URL: Record<ListsRoute, RegExp> = {
  products: /\/lists\/?$/,
  orders: /\/lists\/orders\/?$/,
  customers: /\/lists\/customers\/?$/,
  feeds: /\/lists\/feeds\/?$/,
};

/** The nav label of each route (en, `lists.nav.*`). */
export const LISTS_NAV: Record<ListsRoute, string> = {
  products: "Products",
  orders: "Orders",
  customers: "Customers",
  feeds: "Feed & journal",
};

/** The nav link of a route, in the shell's nav. */
export function listsNavLink(page: Page, route: ListsRoute) {
  return page.getByTestId("lists-nav").getByRole("link", { name: LISTS_NAV[route], exact: true });
}

/**
 * Open a route directly: the server's HTML, then hydration. Resolves once the
 * shell is hydrated (React tags hydrated DOM nodes with `__reactProps$…`; the
 * shared waitForHydration looks for the demo header, which these routes do not
 * render). Content behind a <Suspense> boundary hydrates on its own: wait for
 * it separately before typing into it.
 */
export async function openLists(page: Page, route: ListsRoute) {
  await page.goto(LISTS_PATH[route]);
  await page.waitForFunction(() => {
    const link = document.querySelector('[data-testid="lists-nav"] a');
    return !!link && Object.keys(link).some((k) => k.startsWith("__reactProps"));
  });
}

/** Go to a route through the shell's nav (a client navigation) and wait until it is the current one. */
export async function goLists(page: Page, route: ListsRoute) {
  await listsNavLink(page, route).click();
  await expect(page).toHaveURL(LISTS_URL[route]);
  await expect(listsNavLink(page, route)).toHaveAttribute("aria-current", "page");
}

export type ConsoleLine = { type: string; text: string };

/** What React and Next print when the client's first render is not the server's. */
export const HYDRATION = /hydrat|did(?:n't| not) match|does not match|recoverable|switched to client rendering/i;

/** What next-intl prints for a key that is not in the messages. */
export const MISSING_MESSAGE = /MISSING_MESSAGE/;

/** Every console message and uncaught error of the page; install before the navigation. */
export function collectConsole(page: Page): ConsoleLine[] {
  const lines: ConsoleLine[] = [];
  page.on("console", (msg) => lines.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => lines.push({ type: "pageerror", text: err.message }));
  return lines;
}

/** The console lines that must not be there: hydration mismatches and missing translations. */
export function badConsoleLines(lines: ConsoleLine[]): ConsoleLine[] {
  return lines.filter((line) => HYDRATION.test(line.text) || MISSING_MESSAGE.test(line.text));
}
