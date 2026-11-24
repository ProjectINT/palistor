import { test, expect, type Page } from "./fixtures";
import { LISTS_PATH, badConsoleLines, collectConsole, openLists } from "./lists-fixtures";

// /lists, block "Products" (src/app/lists/ProductsTable.tsx, ProductFilters.tsx,
// productsConfig.ts): one list loaded once by its resolver, a filter block of
// client fields only (where, $all, a derived field), inline price edit and a
// local add. Every test ends with the products request counter at 1: nothing
// here calls the resolver again.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

/** products.json in the server's order: it follows no column. */
const SERVER_ORDER = [
  "Walnut table",
  "Desk lamp 10",
  "Spice rack",
  "apple crate",
  "Desk lamp 2",
  "Cushion cover 20",
  "string lights",
  "Chef knife",
  "Linen napkins",
  "Desk lamp 1",
  "Bar stool 12",
  "Zebra rug",
  "Pendant light",
  "Kettle",
  "oak Shelf",
  "Wool blanket",
  "Ceramic mug",
  "Floor lamp",
  "Jute rug",
  "Bar stool 3",
  "Teapot 2",
  "Oak shelf",
  "Cushion cover 4",
  "Cast iron pan",
];

const titles = (page: Page) => page.getByTestId("lists-products-title");
const requests = (page: Page) => page.getByTestId("lists-products-requests");
const shown = (page: Page) => page.getByTestId("lists-products-shown");
const active = (page: Page) => page.getByTestId("lists-products-active");
const chips = (page: Page) => page.getByTestId("lists-products-chip");
const range = (page: Page) => page.getByTestId("lists-products-range");

/** The table row of a product, by its exact title. */
function productRow(page: Page, title: string) {
  return page
    .getByTestId("lists-products-row")
    .filter({ has: page.getByTestId("lists-products-title").getByText(title, { exact: true }) });
}

/** Open /lists and wait for the products' first (and only) load. */
async function openProducts(page: Page) {
  await openLists(page, "products");
  await expect(titles(page)).toHaveCount(SERVER_ORDER.length);
  await expect(requests(page)).toHaveText("1");
}

/** The request counter is still 1, also after a moment for anything late. */
async function stillOneRequest(page: Page) {
  await page.waitForTimeout(300);
  await expect(requests(page)).toHaveText("1");
}

test("the server's HTML has the filters and a skeleton; the rows come with one request", async ({
  page,
  pageErrors,
  request,
}) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const html = await (await request.get(LISTS_PATH.products)).text();
  // Labels from the store's translator are in the HTML; the rows load in the browser.
  expect(html).toContain('data-testid="lists-products-skeleton"');
  expect(html).toContain("Price from");
  expect(html).not.toContain('data-testid="lists-products-row"');

  const consoleLines = collectConsole(page);
  await openProducts(page);
  await expect(titles(page)).toHaveText(SERVER_ORDER);
  await expect(shown(page)).toHaveText("Shown: 24 of 24");
  await expect(active(page)).toHaveText("0");
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByTestId("lists-products-reset")).toBeDisabled();
  // Text, number, boolean, date and nullable number columns.
  const lamp = productRow(page, "Desk lamp 1");
  await expect(lamp.getByTestId("lists-products-price")).toHaveValue("40");
  await expect(lamp.getByTestId("lists-products-category")).toHaveText("Lighting");
  await expect(lamp.getByTestId("lists-products-in-stock")).toHaveText("✓");
  await expect(lamp.getByTestId("lists-products-created")).toHaveText("2026-01-20");
  await expect(lamp.getByTestId("lists-products-rating")).toHaveText("—");
  await expect(productRow(page, "Desk lamp 10").getByTestId("lists-products-in-stock")).toHaveText("—");
  await expect(productRow(page, "Desk lamp 10").getByTestId("lists-products-rating")).toHaveText("4.1");

  await stillOneRequest(page);
  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

test("the search narrows the rows in the server's order; clearing it brings them all back", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);
  const search = page.getByTestId("lists-products-filter-search");

  await search.fill("lamp");
  await expect(titles(page)).toHaveText(["Desk lamp 10", "Desk lamp 2", "Desk lamp 1", "Floor lamp"]);
  await expect(shown(page)).toHaveText("Shown: 4 of 24");
  await expect(active(page)).toHaveText("1");
  await expect(chips(page)).toHaveText(["Search: lamp✕"]);

  // Case does not matter; surrounding blanks are trimmed.
  await search.fill("  LAMP ");
  await expect(titles(page)).toHaveCount(4);

  await search.fill("no such product");
  await expect(titles(page)).toHaveCount(0);
  await expect(page.getByTestId("lists-products-empty")).toBeVisible();
  await expect(shown(page)).toHaveText("Shown: 0 of 24");

  await search.fill("");
  await expect(titles(page)).toHaveText(SERVER_ORDER);
  await expect(active(page)).toHaveText("0");
  await expect(chips(page)).toHaveCount(0);
  await stillOneRequest(page);
});

test("category, in stock and the price range narrow the rows together", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await page.getByTestId("lists-products-filter-category").selectOption("Kitchen");
  await expect(titles(page)).toHaveText(["Spice rack", "Chef knife", "Kettle", "Ceramic mug", "Teapot 2", "Cast iron pan"]);

  await page.getByTestId("lists-products-filter-in-stock").check();
  await expect(titles(page)).toHaveText(["Spice rack", "Chef knife", "Kettle", "Ceramic mug"]);

  await page.getByTestId("lists-products-filter-min-price").fill("30");
  await expect(titles(page)).toHaveText(["Spice rack", "Chef knife", "Kettle"]);

  await page.getByTestId("lists-products-filter-max-price").fill("50");
  await expect(titles(page)).toHaveText(["Spice rack", "Kettle"]);
  await expect(shown(page)).toHaveText("Shown: 2 of 24");
  await expect(range(page)).toHaveText("30–50");
  await expect(active(page)).toHaveText("4");
  await expect(chips(page)).toHaveText(["Category: Kitchen✕", "In stock only✕", "Price from: 30✕", "Price to: 50✕"]);
  await stillOneRequest(page);
});

test("the price range is one $all rule over both bounds, and the derived range follows it", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);
  const min = page.getByTestId("lists-products-filter-min-price");
  const max = page.getByTestId("lists-products-filter-max-price");
  const fiftyToHundred = ["Desk lamp 10", "Chef knife", "Bar stool 12", "Pendant light", "Wool blanket", "Bar stool 3", "Cast iron pan"];

  await min.fill("50");
  await max.fill("100");
  await expect(titles(page)).toHaveText(fiftyToHundred);
  await expect(range(page)).toHaveText("50–100");

  // A reversed range is read the other way round: the rule sees both bounds at once.
  await min.fill("100");
  await max.fill("50");
  await expect(titles(page)).toHaveText(fiftyToHundred);
  await expect(range(page)).toHaveText("50–100");

  // One bound only.
  await min.fill("");
  await max.fill("25");
  await expect(titles(page)).toHaveText(["apple crate", "Cushion cover 20", "string lights", "Linen napkins", "Ceramic mug", "Cushion cover 4"]);
  await expect(range(page)).toHaveText("≤ 25");
  await max.fill("");
  await min.fill("200");
  await expect(titles(page)).toHaveText(["Walnut table", "Zebra rug"]);
  await expect(range(page)).toHaveText("≥ 200");

  // The derived field is neither a chip nor counted as active.
  await expect(active(page)).toHaveText("1");
  await expect(chips(page)).toHaveText(["Price from: 200✕"]);

  await min.fill("");
  await expect(range(page)).toHaveCount(0);
  await expect(titles(page)).toHaveCount(SERVER_ORDER.length);
  await stillOneRequest(page);
});

test("a chip's ✕ clears that field only", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await page.getByTestId("lists-products-filter-search").fill("lamp");
  await page.getByTestId("lists-products-filter-category").selectOption("Lighting");
  await page.getByTestId("lists-products-filter-in-stock").check();
  await expect(titles(page)).toHaveText(["Desk lamp 2", "Desk lamp 1", "Floor lamp"]);
  await expect(chips(page)).toHaveText(["Search: lamp✕", "Category: Lighting✕", "In stock only✕"]);
  await expect(active(page)).toHaveText("3");

  await page.getByRole("button", { name: "Remove the filter: In stock only" }).click();
  await expect(page.getByTestId("lists-products-filter-in-stock")).not.toBeChecked();
  await expect(titles(page)).toHaveText(["Desk lamp 10", "Desk lamp 2", "Desk lamp 1", "Floor lamp"]);
  await expect(chips(page)).toHaveText(["Search: lamp✕", "Category: Lighting✕"]);

  await page.getByRole("button", { name: "Remove the filter: Search" }).click();
  await expect(page.getByTestId("lists-products-filter-search")).toHaveValue("");
  await expect(titles(page)).toHaveText(["Desk lamp 10", "Desk lamp 2", "string lights", "Desk lamp 1", "Pendant light", "Floor lamp"]);
  await expect(active(page)).toHaveText("1");

  await page.getByRole("button", { name: "Remove the filter: Category" }).click();
  await expect(page.getByTestId("lists-products-filter-category")).toHaveValue("");
  await expect(titles(page)).toHaveText(SERVER_ORDER);
  await expect(active(page)).toHaveText("0");
  await stillOneRequest(page);
});

test("the preset sets several fields at once; Reset clears every field", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await page.getByTestId("lists-products-filter-search").fill("s");
  await page.getByTestId("lists-products-preset").click();
  // filter.set writes the named fields and leaves the search as it was.
  await expect(page.getByTestId("lists-products-filter-category")).toHaveValue("Lighting");
  await expect(page.getByTestId("lists-products-filter-in-stock")).toBeChecked();
  await expect(page.getByTestId("lists-products-filter-max-price")).toHaveValue("100");
  await expect(titles(page)).toHaveText(["Desk lamp 2", "string lights", "Desk lamp 1"]);
  await expect(range(page)).toHaveText("≤ 100");
  await expect(active(page)).toHaveText("4");

  await page.getByTestId("lists-products-reset").click();
  await expect(page.getByTestId("lists-products-filter-search")).toHaveValue("");
  await expect(page.getByTestId("lists-products-filter-category")).toHaveValue("");
  await expect(page.getByTestId("lists-products-filter-in-stock")).not.toBeChecked();
  await expect(page.getByTestId("lists-products-filter-max-price")).toHaveValue("");
  await expect(titles(page)).toHaveText(SERVER_ORDER);
  await expect(active(page)).toHaveText("0");
  await expect(chips(page)).toHaveCount(0);
  await expect(range(page)).toHaveCount(0);
  await expect(page.getByTestId("lists-products-reset")).toBeDisabled();
  await stillOneRequest(page);
});

test("an added row appears at the bottom and stays visible whatever the filters say", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await page.getByTestId("lists-products-filter-search").fill("lamp");
  await expect(titles(page)).toHaveCount(4);
  await page.getByTestId("lists-products-add").click();
  // "New product" does not match "lamp": a locally added row is shown until the next load.
  await expect(titles(page)).toHaveText(["Desk lamp 10", "Desk lamp 2", "Desk lamp 1", "Floor lamp", "New product"]);
  await expect(shown(page)).toHaveText("Shown: 5 of 25");
  await expect(productRow(page, "New product").getByTestId("lists-products-price")).toHaveValue("0");

  await page.getByTestId("lists-products-filter-search").fill("");
  await expect(titles(page)).toHaveText([...SERVER_ORDER, "New product"]);
  await expect(shown(page)).toHaveText("Shown: 25 of 25");
  await stillOneRequest(page);
});

test("a price edited in its row stays in the entity, and the filters see it", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);
  const price = productRow(page, "Desk lamp 1").getByTestId("lists-products-price");

  await price.fill("150");
  await expect(price).toHaveValue("150");
  // The row keeps its place: an edit changes a value, not the order.
  await expect(titles(page)).toHaveText(SERVER_ORDER);

  await page.getByTestId("lists-products-filter-min-price").fill("140");
  await expect(titles(page)).toHaveText(["Walnut table", "Desk lamp 1", "Zebra rug", "oak Shelf", "Jute rug", "Oak shelf"]);

  await page.getByTestId("lists-products-filter-min-price").fill("");
  await expect(titles(page)).toHaveCount(SERVER_ORDER.length);
  await expect(price).toHaveValue("150");
  await stillOneRequest(page);
});

// ─── Sorting (experiments/SortPlan.md, Stage 1 → "Демо и e2e") ───────────────
// `sort: true` on the products list, one SortHeader per column
// (ProductsTable.tsx). The list holds all its rows and sorts them itself: no
// sort here calls the resolver. The order is a snapshot taken when the sort
// changes or on "Re-sort" (sort.refresh()); an added row and an edited value
// wait for it. Equal values keep the server's order in both directions.

const COLUMN_KEYS = ["title", "price", "category", "inStock", "createdAt", "rating"] as const;
type Column = (typeof COLUMN_KEYS)[number];

/** Numbers inside text compare as numbers ("Desk lamp 2" before "Desk lamp 10"), case is ignored ("apple crate" first). */
const TITLE_ASC = [
  "apple crate", "Bar stool 3", "Bar stool 12", "Cast iron pan", "Ceramic mug", "Chef knife", "Cushion cover 4",
  "Cushion cover 20", "Desk lamp 1", "Desk lamp 2", "Desk lamp 10", "Floor lamp", "Jute rug", "Kettle", "Linen napkins",
  // Equal when case is ignored: the server's order, in both directions.
  "oak Shelf", "Oak shelf",
  "Pendant light", "Spice rack", "string lights", "Teapot 2", "Walnut table", "Wool blanket", "Zebra rug",
];
const TITLE_DESC = [
  "Zebra rug", "Wool blanket", "Walnut table", "Teapot 2", "string lights", "Spice rack", "Pendant light",
  "oak Shelf", "Oak shelf",
  "Linen napkins", "Kettle", "Jute rug", "Floor lamp", "Desk lamp 10", "Desk lamp 2", "Desk lamp 1", "Cushion cover 20",
  "Cushion cover 4", "Chef knife", "Ceramic mug", "Cast iron pan", "Bar stool 12", "Bar stool 3", "apple crate",
];
/** Equal prices (22, 25, 40, 60, 95, 150) keep the server's order both ways: descending is not the ascending order reversed. */
const PRICE_ASC = [
  "Ceramic mug", "Linen napkins", "Cushion cover 20", "Cushion cover 4", "apple crate", "string lights", "Teapot 2",
  "Spice rack", "Desk lamp 1", "Kettle", "Desk lamp 2", "Desk lamp 10", "Cast iron pan", "Chef knife", "Pendant light",
  "Wool blanket", "Bar stool 12", "Bar stool 3", "Floor lamp", "Jute rug", "oak Shelf", "Oak shelf", "Zebra rug", "Walnut table",
];
const PRICE_DESC = [
  "Walnut table", "Zebra rug", "oak Shelf", "Oak shelf", "Jute rug", "Floor lamp", "Bar stool 12", "Bar stool 3",
  "Wool blanket", "Pendant light", "Chef knife", "Desk lamp 10", "Cast iron pan", "Desk lamp 2", "Desk lamp 1", "Kettle",
  "Spice rack", "Teapot 2", "apple crate", "string lights", "Cushion cover 20", "Cushion cover 4", "Linen napkins", "Ceramic mug",
];
/** The five products without a rating come last both ways, in the server's order. */
const UNRATED = ["Desk lamp 1", "oak Shelf", "Jute rug", "Teapot 2", "Cast iron pan"];
const RATING_ASC = [
  "apple crate", "Cushion cover 20", "Bar stool 3", "Spice rack", "Pendant light", "Bar stool 12", "Cushion cover 4",
  "Desk lamp 10", "Kettle", "string lights", "Zebra rug", "Linen napkins", "Ceramic mug", "Desk lamp 2", "Wool blanket",
  "Oak shelf", "Chef knife", "Floor lamp", "Walnut table", ...UNRATED,
];
const RATING_DESC = [
  "Walnut table", "Floor lamp", "Chef knife", "Wool blanket", "Oak shelf", "Desk lamp 2", "Ceramic mug", "Linen napkins",
  "string lights", "Zebra rug", "Desk lamp 10", "Kettle", "Bar stool 12", "Cushion cover 4", "Pendant light", "Spice rack",
  "Bar stool 3", "Cushion cover 20", "apple crate", ...UNRATED,
];
/** Out of stock, in the server's order: `false` sorts before `true`. */
const OUT_OF_STOCK = ["Desk lamp 10", "Bar stool 12", "Zebra rug", "Pendant light", "oak Shelf", "Teapot 2", "Cushion cover 4", "Cast iron pan"];

const header = (page: Page, column: Column) => page.getByTestId(`lists-products-col-${column}`);
const resort = (page: Page) => page.getByTestId("lists-products-resort");

/** Click a column's header button: one step of none → ascending → descending → none. */
async function sortBy(page: Page, column: Column) {
  await header(page, column).getByRole("button").click();
}

/** `column` has this aria-sort, every other header "none". */
async function sortedBy(page: Page, column: Column | null, dir: "ascending" | "descending" = "ascending") {
  for (const key of COLUMN_KEYS) {
    await expect(header(page, key)).toHaveAttribute("aria-sort", key === column ? dir : "none");
  }
}

const cells = (page: Page, testId: string) => page.getByTestId(testId).allTextContents();

test("sort: a header click sorts the whole column ascending, the second descending, the third restores the server's order", async ({
  page,
  pageErrors,
}) => {
  void pageErrors;
  await openProducts(page);
  await sortedBy(page, null);
  await expect(resort(page)).toBeDisabled();

  await sortBy(page, "title");
  await sortedBy(page, "title", "ascending");
  await expect(header(page, "title")).toContainText("▲");
  await expect(titles(page)).toHaveText(TITLE_ASC);
  await expect(resort(page)).toBeEnabled();

  await sortBy(page, "title");
  await sortedBy(page, "title", "descending");
  await expect(header(page, "title")).toContainText("▼");
  await expect(titles(page)).toHaveText(TITLE_DESC);

  await sortBy(page, "title");
  await sortedBy(page, null);
  await expect(header(page, "title")).not.toContainText(/[▲▼]/);
  await expect(titles(page)).toHaveText(SERVER_ORDER);
  await expect(resort(page)).toBeDisabled();
  await stillOneRequest(page);
});

test("sort: numbers, booleans and dates sort by their value in both directions", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await sortBy(page, "price");
  await expect(titles(page)).toHaveText(PRICE_ASC);
  await sortBy(page, "price");
  await sortedBy(page, "price", "descending");
  await expect(titles(page)).toHaveText(PRICE_DESC);

  // Another header starts at ascending; the previous one is unsorted again.
  await sortBy(page, "inStock");
  await sortedBy(page, "inStock", "ascending");
  await expect(page.getByTestId("lists-products-in-stock")).toHaveText([...Array(8).fill("—"), ...Array(16).fill("✓")]);
  expect((await cells(page, "lists-products-title")).slice(0, 8)).toEqual(OUT_OF_STOCK);
  await sortBy(page, "inStock");
  await expect(page.getByTestId("lists-products-in-stock")).toHaveText([...Array(16).fill("✓"), ...Array(8).fill("—")]);
  expect((await cells(page, "lists-products-title")).slice(16)).toEqual(OUT_OF_STOCK);

  // ISO date strings: their text order is their time order.
  await sortBy(page, "createdAt");
  await sortedBy(page, "createdAt", "ascending");
  await expect(page.getByTestId("lists-products-created").first()).toHaveText("2025-07-19");
  const ascending = await cells(page, "lists-products-created");
  expect(ascending).toEqual([...ascending].sort());
  await sortBy(page, "createdAt");
  await expect(page.getByTestId("lists-products-created").first()).toHaveText("2026-08-14");
  expect(await cells(page, "lists-products-created")).toEqual([...ascending].reverse());
  await stillOneRequest(page);
});

test("sort: products without a rating stay at the bottom in both directions", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await sortBy(page, "rating");
  await expect(titles(page)).toHaveText(RATING_ASC);
  await expect(page.getByTestId("lists-products-rating").first()).toHaveText("3.5");
  expect((await cells(page, "lists-products-rating")).slice(-5)).toEqual(Array(5).fill("—"));

  await sortBy(page, "rating");
  await sortedBy(page, "rating", "descending");
  await expect(titles(page)).toHaveText(RATING_DESC);
  await expect(page.getByTestId("lists-products-rating").first()).toHaveText("4.9");
  expect((await cells(page, "lists-products-rating")).slice(-5)).toEqual(Array(5).fill("—"));
  await stillOneRequest(page);
});

test("sort: the search narrows a sorted list and keeps its order; clearing the search keeps the sort", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);
  const search = page.getByTestId("lists-products-filter-search");

  await sortBy(page, "title");
  await search.fill("lamp");
  await expect(titles(page)).toHaveText(["Desk lamp 1", "Desk lamp 2", "Desk lamp 10", "Floor lamp"]);
  await sortedBy(page, "title", "ascending");

  // A sort change under the search orders the visible rows too.
  await sortBy(page, "title");
  await expect(titles(page)).toHaveText(["Floor lamp", "Desk lamp 10", "Desk lamp 2", "Desk lamp 1"]);

  await search.fill("");
  await expect(titles(page)).toHaveText(TITLE_DESC);
  await sortedBy(page, "title", "descending");
  await stillOneRequest(page);
});

test("sort: an added row stays at the bottom until the next header click puts it in its place", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await sortBy(page, "price");
  await page.getByTestId("lists-products-add").click();
  // Its price (0) is the lowest, but the order was taken before it came.
  await expect(titles(page)).toHaveText([...PRICE_ASC, "New product"]);

  await sortBy(page, "title");
  const withNew = [...TITLE_ASC];
  withNew.splice(TITLE_ASC.indexOf("Linen napkins") + 1, 0, "New product");
  await expect(titles(page)).toHaveText(withNew);

  // Its category is empty: last in both directions.
  await sortBy(page, "category");
  await expect(titles(page).last()).toHaveText("New product");
  await expect(page.getByTestId("lists-products-category").first()).toHaveText("Furniture");
  await sortBy(page, "category");
  await sortedBy(page, "category", "descending");
  await expect(titles(page).last()).toHaveText("New product");
  await expect(page.getByTestId("lists-products-category").first()).toHaveText("Textiles");

  await sortBy(page, "price");
  await expect(titles(page).first()).toHaveText("New product");
  await stillOneRequest(page);
});

test("sort: a price edited under a price sort keeps its place until Re-sort moves it", async ({ page, pageErrors }) => {
  void pageErrors;
  await openProducts(page);

  await sortBy(page, "price");
  await expect(titles(page).first()).toHaveText("Ceramic mug");
  const mug = productRow(page, "Ceramic mug").getByTestId("lists-products-price");
  await mug.fill("300");
  await expect(mug).toHaveValue("300");
  // An edit changes a value, not the order: the row stays first, the header still says ascending.
  await expect(titles(page)).toHaveText(PRICE_ASC);
  await sortedBy(page, "price", "ascending");

  await resort(page).click();
  const resorted = PRICE_ASC.filter((title) => title !== "Ceramic mug");
  resorted.splice(resorted.indexOf("Zebra rug") + 1, 0, "Ceramic mug"); // 210 < 300 < 480
  await expect(titles(page)).toHaveText(resorted);
  await sortedBy(page, "price", "ascending");
  await expect(mug).toHaveValue("300");
  await stillOneRequest(page);
});
