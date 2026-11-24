import { test, expect, type Page } from "./fixtures";
import { badConsoleLines, collectConsole, openLists } from "./lists-fixtures";
import ORDERS from "../src/app/lists/orders/orders.json";

// Route /lists/orders (src/app/lists/orders/): a paginated list of 108 orders
// in a HeroUI Table, 10 rows a page, with a server sort on the column headers
// (`$default: "-createdAt"`, sent as `sort=-created_at`), a server filter — a
// debounced search (`q`, sent as `search`) and a status (`status`, sent as
// `status_eq`) — and the pagination features: prefetch on hover, page size,
// refreshing one page, keepPreviousData, maxCachedQueries: 3, staleTime: 30 s.
//
// Every test checks what is on screen AND the counter of calls to the fake
// endpoint (`lists-orders-requests`). The endpoint answers after 700 ms.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

type Order = (typeof ORDERS)[number];

const PAGE_SIZE = 10;
const STALE_TIME = 30_000;
/** Longer than the endpoint's delay: a request that was going to come has come. */
const QUIET_MS = 900;

/** The orders the endpoint matches, in its order (the table is stored newest first). */
function matching({ search = "", status = "" }: { search?: string; status?: string } = {}): Order[] {
  const q = search.toLowerCase();
  return ORDERS.filter(
    (order) => (!q || `${order.number} ${order.customer}`.toLowerCase().includes(q)) && (!status || order.status === status),
  );
}

type SortColumn = "number" | "customer" | "amount" | "status" | "createdAt";

/**
 * `rows` sorted by one column, as the endpoint sorts them: numbers as numbers
 * (`#1001` by its number), strings with an English collation, ties in the
 * table's own order (Array#sort is stable).
 */
function sortedBy(rows: Order[], column: SortColumn, dir: "asc" | "desc"): Order[] {
  const read = (order: Order) => (column === "number" ? Number(order.number.slice(1)) : order[column]);
  return [...rows].sort((a, b) => {
    const x = read(a);
    const y = read(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en");
    return dir === "asc" ? order : -order;
  });
}

/** The order numbers of page `page` (from 1) of `rows`. */
function pageOf(rows: Order[], page: number, size = PAGE_SIZE): string[] {
  return rows.slice((page - 1) * size, page * size).map((order) => order.number);
}

const ALL = matching();

const requests = (page: Page) => page.getByTestId("lists-orders-requests");
const rowNumbers = (page: Page) => page.getByTestId("lists-orders-row").getByTestId("lists-orders-number");
const pageStatus = (page: Page) => page.getByTestId("lists-orders-page-status");
const total = (page: Page) => page.getByTestId("lists-orders-total");
const lastRequest = (page: Page) => page.getByTestId("lists-orders-last-request");
const nextButton = (page: Page) => page.getByTestId("lists-orders-next");
const prevButton = (page: Page) => page.getByTestId("lists-orders-prev");
const statusFilter = (page: Page) => page.getByTestId("lists-orders-status-filter");
const header = (page: Page, name: string) => page.getByRole("columnheader", { name, exact: true });

/** A direct load: the skeleton, then page 1 after exactly one request. */
async function openOrders(page: Page) {
  await openLists(page, "orders");
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await expect(requests(page)).toHaveText("1");
}

/** Nothing in flight, nothing waiting for a debounce, and no request came late: the counter reads `count`. */
async function settled(page: Page, count: number) {
  await expect(page.getByTestId("lists-orders-fetching")).toHaveText("false");
  await expect(page.getByTestId("lists-orders-pending")).toHaveText("false");
  await page.waitForTimeout(QUIET_MS);
  await expect(requests(page)).toHaveText(String(count));
}

/** Go one page forward through a page that is not cached: one request (the hover's prefetch, joined by the click). */
async function nextUncached(page: Page, rows: string[], count: number) {
  await nextButton(page).click();
  await expect(rowNumbers(page)).toHaveText(rows);
  await expect(requests(page)).toHaveText(String(count));
}

// ─── Load and hydration ──────────────────────────────────────────────────────

test("server HTML: the skeleton and the translated controls, no request", async ({ request }) => {
  const response = await request.get("./lists/orders/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // The store runs no resolver on the server: the list reads isInitialLoading, so the skeleton.
  expect(html).toContain('data-testid="lists-orders-skeleton"');
  expect(html).not.toContain('data-testid="lists-orders-row"');
  // The column headers and the labels the store computes through the provider's translator.
  for (const text of ["Order", "Customer", "Created", "Amount", "Search", "All statuses", "Rows per page", "Refresh page"]) {
    expect(html).toContain(text);
  }
  expect(html).toMatch(/placeholder="Order number or customer"/);
  expect(html).not.toMatch(/lists\.orders\.[\w.]+/);
  // Nothing was requested.
  expect(html).toMatch(/data-testid="lists-orders-requests"[^>]*>0</);
  expect(html).toMatch(/data-testid="lists-orders-last-request"[^>]*>—</);
});

test("a direct load hydrates cleanly and shows page 1 after one request", async ({ page, pageErrors }, testInfo) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openOrders(page);

  await expect(page.getByTestId("lists-orders-skeleton")).toHaveCount(0);
  await expect(pageStatus(page)).toHaveText("Page 1 of 11");
  await expect(total(page)).toHaveText("108 orders");
  await expect(rowNumbers(page).first()).toHaveText("#1108");
  await expect(lastRequest(page)).toHaveText("/api/orders?sort=-created_at&offset=0&limit=10");
  await expect(prevButton(page)).toBeDisabled();
  await settled(page, 1);

  await testInfo.attach("console", {
    body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
    contentType: "text/plain",
  });
  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

test("the page follows the saved locale after hydration, without another request", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  await openOrders(page);
  await expect(page.getByRole("columnheader", { name: "Клиент" })).toBeVisible();
  await expect(pageStatus(page)).toHaveText("Страница 1 из 11");
  await expect(total(page)).toHaveText("108 заказов");
  await expect(page.getByTestId("lists-orders-search")).toHaveAttribute("placeholder", "Номер заказа или клиент");
  await settled(page, 1);

  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

// ─── Pages ───────────────────────────────────────────────────────────────────

test("pages: a new page is one request, a page seen before comes from the cache", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);

  await nextUncached(page, pageOf(ALL, 2), 2);
  await expect(pageStatus(page)).toHaveText("Page 2 of 11");
  await expect(lastRequest(page)).toHaveText("/api/orders?sort=-created_at&offset=10&limit=10");

  // Back to page 1 and forward to page 2 again: both cached, no request.
  await prevButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await expect(pageStatus(page)).toHaveText("Page 1 of 11");
  await nextButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 2));
  await settled(page, 2);
});

test("prefetch: hovering Next loads the next page in advance, the click shows it without a request", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);

  // The hover alone: one request for page 2, the table still shows page 1.
  await nextButton(page).hover();
  await expect(requests(page)).toHaveText("2");
  await expect(lastRequest(page)).toHaveText("/api/orders?sort=-created_at&offset=10&limit=10");
  await settled(page, 2);
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await expect(pageStatus(page)).toHaveText("Page 1 of 11");

  // The click: page 2 at once, from the cache.
  await nextButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 2), { timeout: 300 });
  await expect(pageStatus(page)).toHaveText("Page 2 of 11");
  await expect(page.getByTestId("lists-orders-busy")).toHaveCount(0);
  await settled(page, 2);
});

test("page size: setPageSize clears the cached pages and loads page 1 once", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);
  await nextUncached(page, pageOf(ALL, 2), 2);

  // 20 rows a page: back to page 1, one request.
  await page.getByTestId("lists-orders-page-size").selectOption("20");
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1, 20));
  await expect(pageStatus(page)).toHaveText("Page 1 of 6");
  await expect(lastRequest(page)).toHaveText("/api/orders?sort=-created_at&offset=0&limit=20");
  await settled(page, 3);

  // Page 2 of 20 rows is new: one request.
  await nextUncached(page, pageOf(ALL, 2, 20), 4);
  await expect(pageStatus(page)).toHaveText("Page 2 of 6");

  // Back to 10 rows: the pages of 10 were cleared, so page 1 is requested again.
  await page.getByTestId("lists-orders-page-size").selectOption("10");
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await expect(pageStatus(page)).toHaveText("Page 1 of 11");
  await settled(page, 5);
});

test("Refresh page: invalidate(page) fetches the page on screen again with exactly one request", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);
  await nextUncached(page, pageOf(ALL, 2), 2);
  await settled(page, 2);

  await page.getByTestId("lists-orders-refresh").click();
  await expect(requests(page)).toHaveText("3");
  await expect(lastRequest(page)).toHaveText("/api/orders?sort=-created_at&offset=10&limit=10");
  // The rows stay on screen while the page is fetched again.
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 2));
  await expect(pageStatus(page)).toHaveText("Page 2 of 11");
  await settled(page, 3);
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 2));

  // Only that page went stale: page 1 still comes from the cache.
  await prevButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await settled(page, 3);
});

// ─── Server filter ───────────────────────────────────────────────────────────

test("search: one request after the pause, isPending meanwhile, back to page 1; clearing it comes from the cache", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);
  await nextUncached(page, pageOf(ALL, 2), 2);
  await settled(page, 2);

  const search = page.getByTestId("lists-orders-search");
  const pending = page.getByTestId("lists-orders-pending");
  await search.pressSequentially("ali", { delay: 80 });
  // Typed, not sent yet: the value is there at once, the request waits for the pause.
  await expect(search).toHaveValue("ali");
  await expect(pending).toHaveText("true");
  await expect(requests(page)).toHaveText("2");

  // After the pause: one request with the `param` name, for page 1.
  const ali = matching({ search: "ali" });
  expect(ali).toHaveLength(14);
  await expect(rowNumbers(page)).toHaveText(pageOf(ali, 1));
  await expect(requests(page)).toHaveText("3");
  await expect(lastRequest(page)).toHaveText("/api/orders?search=ali&sort=-created_at&offset=0&limit=10");
  await expect(pageStatus(page)).toHaveText("Page 1 of 2");
  await expect(total(page)).toHaveText("14 orders");
  await expect(pending).toHaveText("false");
  await settled(page, 3);

  // Back to the empty search: the query before is still cached, page 1 comes back without a request.
  await search.fill("");
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await expect(pageStatus(page)).toHaveText("Page 1 of 11");
  await settled(page, 3);
});

test("status: applies at once, without a debounce, and goes back to page 1", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);
  await nextUncached(page, pageOf(ALL, 2), 2);
  await settled(page, 2);

  await statusFilter(page).selectOption("paid");
  await expect(requests(page)).toHaveText("3");
  await expect(page.getByTestId("lists-orders-pending")).toHaveText("false");
  await expect(lastRequest(page)).toHaveText("/api/orders?status_eq=paid&sort=-created_at&offset=0&limit=10");

  const paid = matching({ status: "paid" });
  await expect(rowNumbers(page)).toHaveText(pageOf(paid, 1));
  await expect(page.getByTestId("lists-orders-row-status")).toHaveText(Array(PAGE_SIZE).fill("Paid"));
  await expect(pageStatus(page)).toHaveText(`Page 1 of ${Math.ceil(paid.length / PAGE_SIZE)}`);
  await expect(total(page)).toHaveText(`${paid.length} orders`);
  await settled(page, 3);

  // The search and the status go out together.
  await page.getByTestId("lists-orders-search").fill("ali");
  const both = matching({ search: "ali", status: "paid" });
  await expect(rowNumbers(page)).toHaveText(pageOf(both, 1));
  await expect(lastRequest(page)).toHaveText("/api/orders?search=ali&status_eq=paid&sort=-created_at&offset=0&limit=10");
  await settled(page, 4);
});

test("keepPreviousData: the old rows stay, dimmed, while the first page of a new query loads", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);
  const table = page.getByTestId("lists-orders-table");
  await expect(table).toHaveAttribute("data-previous-data", "false");

  await statusFilter(page).selectOption("cancelled");
  // In flight: the rows of the previous query, marked as such; no skeleton.
  await expect(table).toHaveAttribute("data-previous-data", "true");
  await expect(page.getByTestId("lists-orders-previous")).toHaveText("true");
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await expect(page.getByTestId("lists-orders-skeleton")).toHaveCount(0);
  await expect(requests(page)).toHaveText("2");

  // Landed: the new rows, no longer dimmed.
  const cancelled = matching({ status: "cancelled" });
  await expect(rowNumbers(page)).toHaveText(pageOf(cancelled, 1));
  await expect(table).toHaveAttribute("data-previous-data", "false");
  await expect(page.getByTestId("lists-orders-previous")).toHaveText("false");
  await expect(pageStatus(page)).toHaveText("Page 1 of 1");
  await settled(page, 2);
});

test("maxCachedQueries: 3 — a previous filter comes back from the cache, the fourth one evicts the oldest", async ({ page, pageErrors }) => {
  void pageErrors;
  await openOrders(page);
  const pick = async (status: string, count: number) => {
    await statusFilter(page).selectOption(status);
    await expect(rowNumbers(page)).toHaveText(pageOf(matching({ status }), 1));
    await expect(page.getByTestId("lists-orders-previous")).toHaveText("false");
    await settled(page, count);
  };

  await pick("paid", 2); //      new query
  await pick("", 2); //          cached: [all, paid]
  await pick("paid", 2); //      cached
  await pick("shipped", 3); //   new: [all, paid, shipped]
  await pick("delivered", 4); // new: the fourth query evicts the least recently used one, "all"
  await pick("", 5); //          evicted: requested again (and "paid" goes in its turn)
  await pick("delivered", 5); // still cached
});

test("staleTime: a page older than 30 s still shows at once and is refetched in the background", async ({ page, pageErrors }) => {
  void pageErrors;
  // Date.now() is frozen (the timers keep running): the test moves it forward instead of waiting.
  const start = new Date("2026-11-24T10:00:00Z").getTime();
  await page.clock.setFixedTime(start);
  await openOrders(page);
  await expect(page.getByTestId("lists-orders-stale-time")).toContainText("30 s");
  await nextUncached(page, pageOf(ALL, 2), 2);
  await prevButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await settled(page, 2);

  // 29 s later both pages are still fresh: no request.
  await page.clock.setFixedTime(start + STALE_TIME - 1_000);
  await nextButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 2));
  await settled(page, 2);

  // 31 s later page 1 is stale: it shows at once from the cache, and is fetched again behind it.
  await page.clock.setFixedTime(start + STALE_TIME + 1_000);
  await prevButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1), { timeout: 300 });
  await expect(pageStatus(page)).toHaveText("Page 1 of 11");
  await expect(requests(page)).toHaveText("3");
  await expect(lastRequest(page)).toHaveText("/api/orders?sort=-created_at&offset=0&limit=10");
  await settled(page, 3);
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));

  // Page 2, fetched at the start, is stale too: one more request. (Here the hover's prefetch starts
  // that refetch, and the click then waits for it instead of showing the cached rows first.)
  await nextButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 2));
  await settled(page, 4);
  // Page 1 was refetched 31 s in: fresh again, going back to it is free.
  await prevButton(page).click();
  await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
  await settled(page, 4);
});

// ─── Server sort ─────────────────────────────────────────────────────────────
// experiments/SortPlan.md, «Этап 2 → Демо и e2e». The `sort` block on a
// paginated list: the table's `sortDescriptor` / `onSortChange` come from
// `list.sort`, the resolver passes `ctx.sort.by` to the endpoint, a sort
// change is a new query (one request for page 1). React Aria asks for the
// opposite direction on a press of the sorted column and for "ascending" on
// any other; on the sorted column `onSortChange` runs toggle's cycle.

test.describe("server sort", () => {
  test("a header click is one request for page 1 in the server's order; the next click reverses it", async ({ page, pageErrors }) => {
    void pageErrors;
    await openOrders(page);
    // The table starts in the `$default` order: newest first, the Created column marked.
    await expect(header(page, "Created")).toHaveAttribute("aria-sort", "descending");
    await expect(header(page, "Amount")).toHaveAttribute("aria-sort", "none");

    await header(page, "Amount").click();
    await expect(requests(page)).toHaveText("2");
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "asc"), 1));
    await expect(header(page, "Amount")).toHaveAttribute("aria-sort", "ascending");
    await expect(header(page, "Created")).toHaveAttribute("aria-sort", "none");
    await expect(lastRequest(page)).toHaveText("/api/orders?sort=amount&offset=0&limit=10");
    await expect(pageStatus(page)).toHaveText("Page 1 of 11");
    await settled(page, 2);

    await header(page, "Amount").click();
    await expect(requests(page)).toHaveText("3");
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "desc"), 1));
    await expect(header(page, "Amount")).toHaveAttribute("aria-sort", "descending");
    await expect(lastRequest(page)).toHaveText("/api/orders?sort=-amount&offset=0&limit=10");
    await settled(page, 3);
  });

  test("back to a previous sort: no request (the third click returns to newest first, from the cache)", async ({ page, pageErrors }) => {
    void pageErrors;
    await openOrders(page);
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "asc"), 1));
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "desc"), 1));
    await settled(page, 3);

    // The third click: back to `$default`, a query still cached — the rows at once, no request.
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
    await expect(header(page, "Created")).toHaveAttribute("aria-sort", "descending");
    await expect(header(page, "Amount")).toHaveAttribute("aria-sort", "none");
    await expect(page.getByTestId("lists-orders-previous")).toHaveText("false");
    await settled(page, 3);

    // Amount ascending is cached too.
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "asc"), 1));
    await expect(header(page, "Amount")).toHaveAttribute("aria-sort", "ascending");
    await settled(page, 3);
  });

  test("the default column: a press flips it to ascending (one request), the next one back to newest first (cached)", async ({ page, pageErrors }) => {
    void pageErrors;
    await openOrders(page);

    // Sorted descending by `$default`, so React Aria asks for ascending: one request.
    await header(page, "Created").click();
    await expect(requests(page)).toHaveText("2");
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "createdAt", "asc"), 1));
    await expect(rowNumbers(page).first()).toHaveText("#1001");
    await expect(header(page, "Created")).toHaveAttribute("aria-sort", "ascending");
    await expect(lastRequest(page)).toHaveText("/api/orders?sort=created_at&offset=0&limit=10");
    await settled(page, 2);

    // Descending again is the `$default` state, still cached: this column never goes unsorted.
    await header(page, "Created").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(ALL, 1));
    await expect(header(page, "Created")).toHaveAttribute("aria-sort", "descending");
    await settled(page, 2);
  });

  test("on page 3, a sort change goes back to page 1", async ({ page, pageErrors }) => {
    void pageErrors;
    await openOrders(page);
    await nextUncached(page, pageOf(ALL, 2), 2);
    await nextUncached(page, pageOf(ALL, 3), 3);
    await expect(pageStatus(page)).toHaveText("Page 3 of 11");
    await settled(page, 3);

    await header(page, "Customer").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "customer", "asc"), 1));
    await expect(pageStatus(page)).toHaveText("Page 1 of 11");
    await expect(prevButton(page)).toBeDisabled();
    await expect(requests(page)).toHaveText("4");
    await expect(lastRequest(page)).toHaveText("/api/orders?sort=customer&offset=0&limit=10");
    await expect(header(page, "Customer")).toHaveAttribute("aria-sort", "ascending");
    await settled(page, 4);
  });

  test("typing in the search: one request after the pause, and the sort is kept", async ({ page, pageErrors }) => {
    void pageErrors;
    await openOrders(page);
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "asc"), 1));
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(ALL, "amount", "desc"), 1));
    await settled(page, 3);

    const search = page.getByTestId("lists-orders-search");
    await search.pressSequentially("ali", { delay: 80 });
    await expect(page.getByTestId("lists-orders-pending")).toHaveText("true");
    await expect(requests(page)).toHaveText("3");

    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(matching({ search: "ali" }), "amount", "desc"), 1));
    await expect(requests(page)).toHaveText("4");
    await expect(lastRequest(page)).toHaveText("/api/orders?search=ali&sort=-amount&offset=0&limit=10");
    await expect(header(page, "Amount")).toHaveAttribute("aria-sort", "descending");
    await expect(pageStatus(page)).toHaveText("Page 1 of 2");
    await settled(page, 4);
  });

  test("a header click during the search's pause: one request carries both", async ({ page, pageErrors }) => {
    void pageErrors;
    await openOrders(page);

    // The click lands inside the 500 ms pause: the sort's request carries the pending search,
    // and the pause running out sends nothing more.
    await page.getByTestId("lists-orders-search").fill("ali");
    await header(page, "Amount").click();
    await expect(rowNumbers(page)).toHaveText(pageOf(sortedBy(matching({ search: "ali" }), "amount", "asc"), 1));
    await expect(lastRequest(page)).toHaveText("/api/orders?search=ali&sort=amount&offset=0&limit=10");
    await expect(requests(page)).toHaveText("2");
    await settled(page, 2);
  });
});
