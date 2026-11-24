import { test, expect, type Locator, type Page } from "./fixtures";
import { badConsoleLines, collectConsole, openLists } from "./lists-fixtures";
import accountTable from "../src/app/lists/customers/accounts.json";
import invoiceTable from "../src/app/lists/customers/invoices.json";

// /lists/customers, block "Customer invoices" (src/app/lists/customers/):
// pagination of a list nested in a row. The accounts come from the server
// (`initialData`); each account row owns an `invoices` list with its own
// `resolve.pagination` (4 a page), so every account has its own pager, its own
// page cache and its own requests.
//   - `lists-invoices-account-requests` (in each card) counts that account's
//     calls of the fake endpoint, `lists-invoices-requests` (the footer) all of them.
// The expected rows are computed from the same JSON the fake backend answers from.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

const PAGE_SIZE = 4;

const ACCOUNTS = {
  northwind: { id: "acc-northwind", name: "Northwind Traders", pages: 3, total: "10 invoices" },
  contoso: { id: "acc-contoso", name: "Contoso Ltd", pages: 2, total: "7 invoices" },
  fabrikam: { id: "acc-fabrikam", name: "Fabrikam Inc", pages: 4, total: "13 invoices" },
  tailspin: { id: "acc-tailspin", name: "Tailspin Toys", pages: 1, total: "3 invoices" },
} as const;

type AccountKey = keyof typeof ACCOUNTS;
const KEYS = Object.keys(ACCOUNTS) as AccountKey[];

/** The invoice numbers on page `n` of an account, newest first. */
function numbers(key: AccountKey, n: number): string[] {
  return invoiceTable
    .filter((invoice) => invoice.accountId === ACCOUNTS[key].id)
    .slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE)
    .map((invoice) => invoice.number);
}

function card(page: Page, key: AccountKey): Locator {
  return page.getByTestId("lists-invoices-account").filter({ hasText: ACCOUNTS[key].name });
}

const rows = (page: Page, key: AccountKey) => card(page, key).getByTestId("lists-invoices-number");
const status = (page: Page, key: AccountKey) => card(page, key).getByTestId("lists-invoices-status");
const requests = (page: Page, key: AccountKey) => card(page, key).getByTestId("lists-invoices-account-requests");
const allRequests = (page: Page) => page.getByTestId("lists-invoices-requests");

/** Open the route and wait until every account shows its first page. */
async function openInvoices(page: Page) {
  await openLists(page, "customers");
  for (const key of KEYS) await expect(rows(page, key)).toHaveText(numbers(key, 1));
  await expect(allRequests(page)).toHaveText("4");
}

/** Click an account's Prev or Next and wait for page `n` of it. */
async function go(page: Page, key: AccountKey, button: "prev" | "next", n: number) {
  await card(page, key).getByTestId(`lists-invoices-${button}`).click();
  await expect(rows(page, key)).toHaveText(numbers(key, n));
  await expect(status(page, key)).toHaveText(`Page ${n} of ${ACCOUNTS[key].pages}`);
  await expect(card(page, key).getByTestId("lists-invoices-busy")).toHaveCount(0);
}

test("the server's HTML has the accounts and a skeleton for each account's invoices; no request", async ({ request }) => {
  const response = await request.get("./lists/customers/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  expect(accountTable.map((account) => account.name)).toEqual(KEYS.map((key) => ACCOUNTS[key].name));
  for (const key of KEYS) {
    expect(html).toMatch(new RegExp(`data-testid="lists-invoices-account-name"[^>]*>${ACCOUNTS[key].name}<`));
  }
  expect(html.match(/data-testid="lists-invoices-skeleton"/g)).toHaveLength(4);
  expect(html).not.toContain('data-testid="lists-invoices-row"');
  expect(html.match(/data-testid="lists-invoices-account-requests"[^>]*>0</g)).toHaveLength(4);
  expect(html).toMatch(/data-testid="lists-invoices-requests"[^>]*>0</);
});

test("each account loads its first page once, with a pager of its own", async ({ page, pageErrors }) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openInvoices(page);

  for (const key of KEYS) {
    await expect(status(page, key)).toHaveText(`Page 1 of ${ACCOUNTS[key].pages}`);
    await expect(card(page, key).getByTestId("lists-invoices-total")).toHaveText(ACCOUNTS[key].total);
    await expect(card(page, key).getByTestId("lists-invoices-prev")).toBeDisabled();
    await expect(requests(page, key)).toHaveText("1");
  }
  // One page in all: nowhere to go.
  await expect(card(page, "tailspin").getByTestId("lists-invoices-next")).toBeDisabled();
  await expect(card(page, "northwind").getByTestId("lists-invoices-next")).toBeEnabled();

  // Give a late request time to show up, then check that there was none.
  await page.waitForTimeout(700);
  for (const key of KEYS) await expect(requests(page, key)).toHaveText("1");
  await expect(allRequests(page)).toHaveText("4");
  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

test("paging one account leaves the others where they are", async ({ page, pageErrors }) => {
  void pageErrors;
  await openInvoices(page);

  await go(page, "northwind", "next", 2);
  await expect(requests(page, "northwind")).toHaveText("2");
  for (const key of ["contoso", "fabrikam", "tailspin"] as const) {
    await expect(rows(page, key)).toHaveText(numbers(key, 1));
    await expect(status(page, key)).toHaveText(`Page 1 of ${ACCOUNTS[key].pages}`);
    await expect(requests(page, key)).toHaveText("1");
  }

  // Another account pages on its own; Northwind stays on its page 2.
  await go(page, "fabrikam", "next", 2);
  await go(page, "fabrikam", "next", 3);
  await expect(requests(page, "fabrikam")).toHaveText("3");
  await expect(rows(page, "northwind")).toHaveText(numbers("northwind", 2));
  await expect(status(page, "northwind")).toHaveText("Page 2 of 3");
  await expect(requests(page, "northwind")).toHaveText("2");
  await expect(rows(page, "contoso")).toHaveText(numbers("contoso", 1));
  await expect(requests(page, "contoso")).toHaveText("1");

  await page.waitForTimeout(600);
  await expect(allRequests(page)).toHaveText("7"); // 4 first pages + 1 (Northwind) + 2 (Fabrikam)
});

test("a page seen before comes from that account's cache; the counters add up", async ({ page, pageErrors }) => {
  void pageErrors;
  await openInvoices(page);

  // Page 2 is new: one request. Back to page 1 and to page 2 again: none.
  await go(page, "northwind", "next", 2);
  await expect(requests(page, "northwind")).toHaveText("2");
  await go(page, "northwind", "prev", 1);
  await go(page, "northwind", "next", 2);
  await expect(requests(page, "northwind")).toHaveText("2");

  // The last page is new and short (10 = 4 + 4 + 2); there is no next one.
  await go(page, "northwind", "next", 3);
  await expect(rows(page, "northwind")).toHaveCount(2);
  await expect(card(page, "northwind").getByTestId("lists-invoices-next")).toBeDisabled();
  await expect(requests(page, "northwind")).toHaveText("3");

  // All the way back: every page from the cache.
  await go(page, "northwind", "prev", 2);
  await go(page, "northwind", "prev", 1);

  // Contoso's cache is its own: its page 2 is a request even though Northwind has one cached.
  await go(page, "contoso", "next", 2);
  await go(page, "contoso", "prev", 1);
  await expect(requests(page, "contoso")).toHaveText("2");

  await page.waitForTimeout(600);
  await expect(requests(page, "northwind")).toHaveText("3");
  await expect(requests(page, "contoso")).toHaveText("2");
  await expect(requests(page, "fabrikam")).toHaveText("1");
  await expect(requests(page, "tailspin")).toHaveText("1");
  await expect(allRequests(page)).toHaveText("7");
});
