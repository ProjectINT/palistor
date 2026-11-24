import { test, expect, type Page } from "./fixtures";
import { badConsoleLines, collectConsole, openLists } from "./lists-fixtures";
import customerTable from "../src/app/lists/customers/customers.json";

// /lists/customers, block "Customers" (src/app/lists/customers/): a paginated
// server list (8 rows a page) with a filter block in "Apply" mode
// (`$apply: "manual"`).
//   - the panel's fields `role`, `status` (selects) and `city` (text) are
//     drafts: the list follows them on "Apply" / Enter only; "Cancel" reverts;
//   - the quick search `quick` is the exception (`apply: "auto"`): a server
//     field with a 400 ms debounce;
//   - the block's `$toParams` builds the backend's query from the applied
//     values (trimmed, `quick` sent as `q`, an empty value left out); the line
//     `lists-customers-query` is the last request the fake endpoint received;
//   - `lists-customers-requests` counts the endpoint's calls in this tab.
// The expected rows are computed from the same JSON the fake backend answers from.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

interface Customer {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  city: string;
}

interface Query {
  q?: string;
  role?: string;
  status?: string;
  city?: string;
}

const CUSTOMERS: Customer[] = customerTable;
const PAGE_SIZE = 8;

const contains = (text: string, part: string) => text.toLowerCase().includes(part.trim().toLowerCase());

/** The backend's answer to `query`: `q` in the name, email or city; `role`, `status` exact; `city` in the city. */
function filtered({ q, role, status, city }: Query): Customer[] {
  return CUSTOMERS.filter(
    (c) =>
      (!q || [c.name, c.email, c.city].some((text) => contains(text, q))) &&
      (!role || c.role === role) &&
      (!status || c.status === status) &&
      (!city || contains(c.city, city)),
  );
}

/** The names on page `n` of `rows`. */
function pageOf(rows: Customer[], n: number): string[] {
  return rows.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE).map((c) => c.name);
}

/** The pager's total (en). */
function totalOf(rows: Customer[]): string {
  return rows.length === 0 ? "No customers" : rows.length === 1 ? "1 customer" : `${rows.length} customers`;
}

const requests = (page: Page) => page.getByTestId("lists-customers-requests");
const names = (page: Page) => page.getByTestId("lists-customers-name");
const status = (page: Page) => page.getByTestId("lists-customers-status");
const total = (page: Page) => page.getByTestId("lists-customers-total");
const lastRequest = (page: Page) => page.getByTestId("lists-customers-query");
const search = (page: Page) => page.getByTestId("lists-customers-search");

// The panel.
const roleSelect = (page: Page) => page.getByTestId("lists-customers-filter-role");
const statusSelect = (page: Page) => page.getByTestId("lists-customers-filter-status");
const cityInput = (page: Page) => page.getByTestId("lists-customers-filter-city");
const applyButton = (page: Page) => page.getByTestId("lists-customers-apply");
const cancelButton = (page: Page) => page.getByTestId("lists-customers-cancel");
const draftMark = (page: Page) => page.getByTestId("lists-customers-draft");
const badge = (page: Page) => page.getByTestId("lists-customers-badge");
const chips = (page: Page) => page.getByTestId("lists-customers-chip");

/** The rows, the pager and the counter show `rows` (page 1) after `count` requests in all. */
async function showsPage1(page: Page, rows: Customer[], count: number) {
  if (rows.length) await expect(names(page)).toHaveText(pageOf(rows, 1));
  else await expect(page.getByTestId("lists-customers-empty")).toBeVisible();
  await expect(status(page)).toHaveText(`Page 1 of ${Math.max(1, Math.ceil(rows.length / PAGE_SIZE))}`);
  await expect(total(page)).toHaveText(totalOf(rows));
  await expect(requests(page)).toHaveText(String(count));
}

/** Open the route and wait for the first page: from here on nothing of this block is in flight. */
async function openCustomers(page: Page) {
  await openLists(page, "customers");
  await expect(names(page)).toHaveText(pageOf(CUSTOMERS, 1));
  await expect(requests(page)).toHaveText("1");
}

/** Next to page `n` (a page not seen yet: one request) and wait for its rows. */
async function nextTo(page: Page, n: number, rows = CUSTOMERS) {
  await page.getByTestId("lists-customers-next").click();
  await expect(names(page)).toHaveText(pageOf(rows, n));
  await expect(page.getByTestId("lists-customers-busy")).toHaveCount(0);
}

test("the server's HTML has the search and a skeleton; the browser loads the first page with one request", async ({
  page,
  pageErrors,
  request,
}) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)

  // A store in server mode calls no resolver: a skeleton, no rows, no request logged.
  const response = await request.get("./lists/customers/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('data-testid="lists-customers-skeleton"');
  expect(html).not.toContain('data-testid="lists-customers-row"');
  expect(html).toMatch(/data-testid="lists-customers-search"[^>]*placeholder="Name, email or city"/);
  expect(html).toContain("Quick search");
  expect(html).toMatch(/data-testid="lists-customers-query"[^>]*>none yet</);
  expect(html).toMatch(/data-testid="lists-customers-requests"[^>]*>0</);
  expect(html).not.toMatch(/lists\.customers\.[\w.]+/);

  const consoleLines = collectConsole(page);
  await openCustomers(page);
  await expect(page.getByTestId("lists-customers-skeleton")).toHaveCount(0);
  await expect(status(page)).toHaveText("Page 1 of 8");
  await expect(total(page)).toHaveText("60 customers");
  await expect(page.getByTestId("lists-customers-prev")).toBeDisabled();
  // An empty search filters nothing: `$toParams` leaves `q` out.
  await expect(lastRequest(page)).toHaveText("GET /api/customers?offset=0&limit=8");

  // Give a late request time to show up, then check that there was none.
  await page.waitForTimeout(700);
  await expect(requests(page)).toHaveText("1");
  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

test("paging: a new page is one request, a page seen before comes from the cache", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCustomers(page);

  await nextTo(page, 2);
  await expect(status(page)).toHaveText("Page 2 of 8");
  await expect(requests(page)).toHaveText("2");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?offset=8&limit=8");

  await nextTo(page, 3);
  await expect(requests(page)).toHaveText("3");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?offset=16&limit=8");

  // Back to pages 2 and 1: from the cache. The backend receives nothing, so its last request stays.
  await page.getByTestId("lists-customers-prev").click();
  await expect(names(page)).toHaveText(pageOf(CUSTOMERS, 2));
  await page.getByTestId("lists-customers-prev").click();
  await expect(names(page)).toHaveText(pageOf(CUSTOMERS, 1));
  await expect(status(page)).toHaveText("Page 1 of 8");
  await expect(page.getByTestId("lists-customers-prev")).toBeDisabled();
  await page.waitForTimeout(600);
  await expect(requests(page)).toHaveText("3");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?offset=16&limit=8");
});

test("quick search: one request after the pause, from page 1 of the result", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCustomers(page);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await expect(requests(page)).toHaveText("3");

  // Four keystrokes inside the debounce: the field follows each one, the request waits.
  await search(page).pressSequentially("oslo", { delay: 40 });
  await expect(search(page)).toHaveValue("oslo");
  await expect(page.getByTestId("lists-customers-pending")).toBeVisible();
  await expect(requests(page)).toHaveText("3");

  // One request, for the first page of the new query.
  const oslo = filtered({ q: "oslo" });
  expect(oslo.length).toBe(9);
  await expect(names(page)).toHaveText(pageOf(oslo, 1));
  await expect(requests(page)).toHaveText("4");
  await expect(status(page)).toHaveText("Page 1 of 2");
  await expect(total(page)).toHaveText("9 customers");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?q=oslo&offset=0&limit=8");
  await expect(page.getByTestId("lists-customers-pending")).toHaveCount(0);
  await page.waitForTimeout(800);
  await expect(requests(page)).toHaveText("4");

  // The result pages like any query.
  await nextTo(page, 2, oslo);
  await expect(status(page)).toHaveText("Page 2 of 2");
  await expect(page.getByTestId("lists-customers-next")).toBeDisabled();
  await expect(requests(page)).toHaveText("5");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?q=oslo&offset=8&limit=8");

  // Nothing matches: the empty state, a pager without pages.
  await search(page).fill("zzz");
  await expect(page.getByTestId("lists-customers-empty")).toBeVisible();
  await expect(total(page)).toHaveText("No customers");
  await expect(page.getByTestId("lists-customers-next")).toBeDisabled();
  await expect(requests(page)).toHaveText("6");
});

test("$toParams builds the backend's query: the search trimmed and sent as q, an empty value left out", async ({
  page,
  pageErrors,
}) => {
  void pageErrors;
  await openCustomers(page);

  // The field keeps what was typed; only the request is shaped.
  await search(page).fill("  Oslo  ");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?q=Oslo&offset=0&limit=8");
  await expect(names(page)).toHaveText(pageOf(filtered({ q: "oslo" }), 1));
  await expect(search(page)).toHaveValue("  Oslo  ");
  await expect(requests(page)).toHaveText("2");

  // Cleared: no `q=` in the request, all the customers again.
  await search(page).fill("");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?offset=0&limit=8");
  await expect(names(page)).toHaveText(pageOf(CUSTOMERS, 1));
  await expect(total(page)).toHaveText("60 customers");
  await expect(requests(page)).toHaveText("3");
});

test("the block follows the saved locale after hydration", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server renders the default locale; the client switches after mount.
  await openCustomers(page);
  const block = page.getByTestId("lists-customers");
  await expect(block.getByRole("heading", { name: "Клиенты", level: 2 })).toBeVisible();
  await expect(block.getByText("Быстрый поиск", { exact: true })).toBeVisible();
  await expect(search(page)).toHaveAttribute("placeholder", "Имя, email или город");
  await expect(status(page)).toHaveText("Страница 1 из 8");
  await expect(total(page)).toHaveText("60 клиентов");
  await expect(block.getByRole("heading", { name: "Фильтры", level: 3 })).toBeVisible();
  await expect(roleSelect(page).locator("option:checked")).toHaveText("Любая роль");
  await expect(applyButton(page)).toHaveText("Применить");
  await expect(requests(page)).toHaveText("1");
  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

// ─── "Apply" mode ($apply: "manual") ─────────────────────────────────────────
// SortPlan.md, Stage 3 → demo and e2e. The panel's fields are drafts; what the
// list is filtered by is `filter.applied` (chips, badge, request line).

test("Apply mode: choosing in the panel changes neither the rows nor the request counter, and enables Apply", async ({
  page,
  pageErrors,
}) => {
  void pageErrors;
  await openCustomers(page);
  await expect(applyButton(page)).toBeDisabled();
  await expect(cancelButton(page)).toBeDisabled();

  await roleSelect(page).selectOption("admin");
  await cityInput(page).fill("oslo");

  // The inputs show the draft; "Apply" and "Cancel" wake up.
  await expect(roleSelect(page)).toHaveValue("admin");
  await expect(cityInput(page)).toHaveValue("oslo");
  await expect(applyButton(page)).toBeEnabled();
  await expect(cancelButton(page)).toBeEnabled();
  await expect(draftMark(page)).toBeVisible();

  // The list is still filtered by the applied values: nothing.
  await page.waitForTimeout(700);
  await showsPage1(page, CUSTOMERS, 1);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?offset=0&limit=8");
  await expect(badge(page)).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
});

test("Apply mode: Apply is one request from page 1, the badge and the chips show the applied filters", async ({
  page,
  pageErrors,
}) => {
  void pageErrors;
  await openCustomers(page);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await expect(requests(page)).toHaveText("3");

  await roleSelect(page).selectOption("admin");
  await statusSelect(page).selectOption("active");
  await applyButton(page).click();

  const activeAdmins = filtered({ role: "admin", status: "active" });
  expect(activeAdmins.length).toBe(9);
  await showsPage1(page, activeAdmins, 4);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?role=admin&status=active&offset=0&limit=8");
  await expect(badge(page)).toHaveText("2");
  await expect(chips(page)).toHaveText([/^Role: Admin/, /^Status: Active/]);
  // Nothing left to apply.
  await expect(applyButton(page)).toBeDisabled();
  await expect(draftMark(page)).toHaveCount(0);

  await page.waitForTimeout(700);
  await expect(requests(page)).toHaveText("4");

  // The result pages like any query.
  await nextTo(page, 2, activeAdmins);
  await expect(requests(page)).toHaveText("5");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?role=admin&status=active&offset=8&limit=8");
});

test("Apply mode: Cancel brings the fields back to the applied values without a request", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCustomers(page);
  await roleSelect(page).selectOption("admin");
  await applyButton(page).click();
  const admins = filtered({ role: "admin" });
  await showsPage1(page, admins, 2);

  await roleSelect(page).selectOption("manager");
  await statusSelect(page).selectOption("trial");
  await cityInput(page).fill("ber");
  await expect(applyButton(page)).toBeEnabled();

  await cancelButton(page).click();
  await expect(roleSelect(page)).toHaveValue("admin");
  await expect(statusSelect(page)).toHaveValue("");
  await expect(cityInput(page)).toHaveValue("");
  await expect(applyButton(page)).toBeDisabled();
  await expect(cancelButton(page)).toBeDisabled();
  await expect(draftMark(page)).toHaveCount(0);

  await page.waitForTimeout(700);
  await showsPage1(page, admins, 2);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?role=admin&offset=0&limit=8");
  await expect(badge(page)).toHaveText("1");
  await expect(chips(page)).toHaveText([/^Role: Admin/]);
});

test("Apply mode: Enter in the city field applies", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCustomers(page);

  await cityInput(page).fill("lisbon");
  await page.waitForTimeout(600);
  await expect(requests(page)).toHaveText("1");

  await cityInput(page).press("Enter");
  await showsPage1(page, filtered({ city: "lisbon" }), 2);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?city=lisbon&offset=0&limit=8");
  await expect(chips(page)).toHaveText([/^City: lisbon/]);
  await expect(badge(page)).toHaveText("1");
  await expect(applyButton(page)).toBeDisabled();
  await expect(cityInput(page)).toHaveValue("lisbon");
});

test("Apply mode: ✕ on a chip removes that filter with exactly one request", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCustomers(page);
  await roleSelect(page).selectOption("admin");
  await cityInput(page).fill("o");
  await applyButton(page).click();
  await showsPage1(page, filtered({ role: "admin", city: "o" }), 2);
  await expect(chips(page)).toHaveText([/^Role: Admin/, /^City: o/]);
  await expect(badge(page)).toHaveText("2");

  await page.getByRole("button", { name: "Remove the filter City" }).click();
  const admins = filtered({ role: "admin" });
  await showsPage1(page, admins, 3);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?role=admin&offset=0&limit=8");
  await expect(cityInput(page)).toHaveValue("");
  await expect(chips(page)).toHaveText([/^Role: Admin/]);
  await expect(badge(page)).toHaveText("1");
  await expect(applyButton(page)).toBeDisabled();

  await page.waitForTimeout(700);
  await expect(requests(page)).toHaveText("3");
});

test("Apply mode: the quick search issues by itself with the applied panel values; the draft stays a draft", async ({
  page,
  pageErrors,
}) => {
  void pageErrors;
  await openCustomers(page);
  await roleSelect(page).selectOption("admin");
  await applyButton(page).click();
  await showsPage1(page, filtered({ role: "admin" }), 2);

  // A draft in the panel, then the quick search.
  await statusSelect(page).selectOption("trial");
  await search(page).pressSequentially("sen", { delay: 40 });

  // One request after the pause: the search and the applied role, not the drafted status.
  const found = filtered({ q: "sen", role: "admin" });
  expect(found.length).toBeGreaterThan(0);
  await showsPage1(page, found, 3);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?q=sen&role=admin&offset=0&limit=8");
  await expect(statusSelect(page)).toHaveValue("trial");
  await expect(applyButton(page)).toBeEnabled();
  await expect(draftMark(page)).toBeVisible();
  await expect(chips(page)).toHaveText([/^Quick search: sen/, /^Role: Admin/]);
  await expect(badge(page)).toHaveText("2");
  await page.waitForTimeout(800);
  await expect(requests(page)).toHaveText("3");

  // The draft was kept: Apply sends it now, with the search.
  await applyButton(page).click();
  await showsPage1(page, filtered({ q: "sen", role: "admin", status: "trial" }), 4);
  await expect(lastRequest(page)).toHaveText("GET /api/customers?q=sen&role=admin&status=trial&offset=0&limit=8");

  // ✕ on the search chip clears the search alone: one request, the panel's filters stay.
  await page.getByRole("button", { name: "Remove the filter Quick search" }).click();
  await showsPage1(page, filtered({ role: "admin", status: "trial" }), 5);
  await expect(search(page)).toHaveValue("");
  await expect(lastRequest(page)).toHaveText("GET /api/customers?role=admin&status=trial&offset=0&limit=8");
  await expect(chips(page)).toHaveText([/^Role: Admin/, /^Status: Trial/]);
});
