import { test, expect, TAB_LABELS, type Page } from "./fixtures";
import {
  LISTS_NAV,
  LISTS_PATH,
  LISTS_ROUTES,
  LISTS_URL,
  badConsoleLines,
  collectConsole,
  goLists,
  listsNavLink,
  openLists,
  type ListsRoute,
} from "./lists-fixtures";

// The shell of the /lists routes (src/app/lists/shared/ListsShell.tsx): the
// link from the Lists tab, the nav between the four routes, a direct load of
// each one. The routes' own content has specs of its own (e2e/lists-*.spec.ts).
//
// The routes exist on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

/** The shell is on screen: the title, a subtitle, the four routes in the nav, one of them current. */
async function shellIsUp(page: Page, title = "Lists") {
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByTestId("lists-subtitle")).toHaveText(/\S/);
  await expect(page.getByTestId("lists-nav").getByRole("link")).toHaveCount(LISTS_ROUTES.length);
  await expect(page.getByTestId("lists-nav").locator('[aria-current="page"]')).toHaveCount(1);
  // A missing translation renders its key.
  await expect(page.getByTestId("lists-shell")).not.toContainText(/\blists\.\w+/);
}

/** The shell of `route` (en): shellIsUp, with that route's link marked current. */
async function shellOf(page: Page, route: ListsRoute) {
  await shellIsUp(page);
  await expect(listsNavLink(page, route)).toHaveAttribute("aria-current", "page");
}

test("the Lists tab links to /lists, and the back link returns to the tab", async ({ page, openTab }) => {
  await openTab("lists");
  await page.getByRole("link", { name: "Lists demo →" }).click();
  await expect(page).toHaveURL(LISTS_URL.products);
  await shellOf(page, "products");

  await page.getByRole("link", { name: "← Back to the demo" }).click();
  await expect(page.getByRole("heading", { name: "Palistor Demo", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#lists$/);
  await expect(page.getByRole("button", { name: TAB_LABELS.lists, exact: true })).toHaveClass(/border-blue-500/);
});

test("the nav reaches every route by client navigation", async ({ page, pageErrors }) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openLists(page, "products");
  await shellOf(page, "products");

  // A full page load would drop this mark: every step below is a client navigation.
  await page.evaluate(() => Object.assign(window, { __listsSamePage: true }));

  const subtitles = new Set<string>();
  for (const route of ["orders", "customers", "feeds", "products"] as const) {
    await goLists(page, route);
    await shellOf(page, route);
    subtitles.add((await page.getByTestId("lists-subtitle").textContent()) ?? "");
  }
  // Each route brings its own subtitle.
  expect(subtitles.size).toBe(LISTS_ROUTES.length);
  expect(await page.evaluate(() => "__listsSamePage" in window)).toBe(true);

  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

for (const route of LISTS_ROUTES) {
  test(`a direct load of ${LISTS_PATH[route]} renders its shell on the server and hydrates cleanly`, async ({
    page,
    pageErrors,
    request,
  }, testInfo) => {
    void pageErrors;

    // The server's HTML already has the shell, with this route marked current.
    const response = await request.get(LISTS_PATH[route]);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-testid="lists-shell"');
    const label = LISTS_NAV[route].replace(/&/g, "&amp;");
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${label}</a>`));

    const consoleLines = collectConsole(page);
    await openLists(page, route);
    await shellOf(page, route);

    await testInfo.attach("console", {
      body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
      contentType: "text/plain",
    });
    expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
  });
}

test("the shell follows the saved locale on every route", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server renders the default locale (static export); the client switches after hydration.
  await openLists(page, "products");
  await shellIsUp(page, "Списки");
  await expect(page.getByTestId("lists-nav").getByRole("link", { name: "Товары", exact: true })).toHaveAttribute("aria-current", "page");

  for (const [name, url] of [
    ["Заказы", LISTS_URL.orders],
    ["Клиенты", LISTS_URL.customers],
    ["Лента и журнал", LISTS_URL.feeds],
  ] as const) {
    const link = page.getByTestId("lists-nav").getByRole("link", { name, exact: true });
    await link.click();
    await expect(page).toHaveURL(url);
    await expect(link).toHaveAttribute("aria-current", "page");
    await shellIsUp(page, "Списки");
  }
  await expect(page.getByRole("link", { name: "← Назад к демо" })).toBeVisible();

  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});
