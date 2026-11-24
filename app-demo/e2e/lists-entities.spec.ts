import { test, expect, type Page } from "./fixtures";
import { openLists } from "./lists-fixtures";

// /lists, block "Favorites" (src/app/lists/Favorites.tsx): one entity in two
// lists. The favorites list loads the saved favorites with its own resolver;
// ☆ in a products row adds the same entity with add(id), ↑ / ↓ reorder with
// setItems, ✕ removes from this list only, and "Restore saved" is reload().
// A row is stored once (the registry), so a price edit shows in both lists.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

const favoriteTitles = (page: Page) => page.getByTestId("lists-favorites-title");
const dirty = (page: Page) => page.getByTestId("lists-favorites-dirty");
const restore = (page: Page) => page.getByTestId("lists-favorites-reset");

function productRow(page: Page, title: string) {
  return page
    .getByTestId("lists-products-row")
    .filter({ has: page.getByTestId("lists-products-title").getByText(title, { exact: true }) });
}

function favoriteRow(page: Page, title: string) {
  return page
    .getByTestId("lists-favorites-row")
    .filter({ has: page.getByTestId("lists-favorites-title").getByText(title, { exact: true }) });
}

const star = (page: Page, title: string) => productRow(page, title).getByTestId("lists-products-favorite");

/** Each list's resolver has been called this many times. */
async function requests(page: Page, products: number, favorites: number) {
  await expect(page.getByTestId("lists-products-requests")).toHaveText(String(products));
  await expect(page.getByTestId("lists-favorites-requests")).toHaveText(String(favorites));
}

/** Open /lists and wait until both lists have loaded. */
async function openFavorites(page: Page) {
  await openLists(page, "products");
  await expect(page.getByTestId("lists-products-title")).toHaveCount(24);
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Chef knife"]);
  await requests(page, 1, 1);
}

test("the saved favorites load once, and ★ marks the same entities in the products table", async ({ page, pageErrors }) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  await openFavorites(page);

  await expect(page.locator('[data-testid="lists-products-favorite"][aria-pressed="true"]')).toHaveCount(2);
  await expect(star(page, "Walnut table")).toHaveAttribute("aria-pressed", "true");
  await expect(star(page, "Chef knife")).toHaveAttribute("aria-pressed", "true");
  await expect(star(page, "Kettle")).toHaveAttribute("aria-pressed", "false");
  await expect(dirty(page)).toHaveText("false");
  await expect(restore(page)).toBeDisabled();
});

test("☆ adds the product to favorites with add(id); ★ or ✕ takes it out of that list only", async ({ page, pageErrors }) => {
  void pageErrors;
  await openFavorites(page);

  await star(page, "Kettle").click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Chef knife", "Kettle"]);
  await expect(star(page, "Kettle")).toHaveAttribute("aria-pressed", "true");
  await expect(dirty(page)).toHaveText("true");

  // ★ again: the membership is the loaded one again, so the list is clean.
  await star(page, "Kettle").click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Chef knife"]);
  await expect(dirty(page)).toHaveText("false");

  // ✕ in favorites: out of this list, still a product.
  await favoriteRow(page, "Chef knife").getByTestId("lists-favorites-remove").click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table"]);
  await expect(star(page, "Chef knife")).toHaveAttribute("aria-pressed", "false");
  await expect(productRow(page, "Chef knife")).toHaveCount(1);
  await expect(dirty(page)).toHaveText("true");

  // Membership changes are local: no list asked its resolver again.
  await page.waitForTimeout(300);
  await requests(page, 1, 1);
});

test("a price edited in either list is the price in the other; row values take no part in dirty", async ({ page, pageErrors }) => {
  void pageErrors;
  await openFavorites(page);

  // A saved favorite: same entity, so the edit shows in both, and the membership is untouched.
  await productRow(page, "Walnut table").getByTestId("lists-products-price").fill("520");
  await expect(favoriteRow(page, "Walnut table").getByTestId("lists-favorites-price")).toHaveValue("520");
  await expect(dirty(page)).toHaveText("false");

  // An entity added from the products table; edited from the favorites side this time.
  await star(page, "Kettle").click();
  await favoriteRow(page, "Kettle").getByTestId("lists-favorites-price").fill("55");
  await expect(productRow(page, "Kettle").getByTestId("lists-products-price")).toHaveValue("55");

  await page.waitForTimeout(300);
  await requests(page, 1, 1);
});

test("↑ and ↓ reorder through setItems; dirty compares the order too", async ({ page, pageErrors }) => {
  void pageErrors;
  await openFavorites(page);
  await star(page, "Kettle").click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Chef knife", "Kettle"]);

  // The ends cannot move further.
  await expect(favoriteRow(page, "Walnut table").getByTestId("lists-favorites-up")).toBeDisabled();
  await expect(favoriteRow(page, "Kettle").getByTestId("lists-favorites-down")).toBeDisabled();

  await favoriteRow(page, "Kettle").getByTestId("lists-favorites-up").click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Kettle", "Chef knife"]);
  await favoriteRow(page, "Walnut table").getByTestId("lists-favorites-down").click();
  await expect(favoriteTitles(page)).toHaveText(["Kettle", "Walnut table", "Chef knife"]);

  // Without Kettle the loaded members are back in the loaded order: clean. Swapped: dirty again.
  await favoriteRow(page, "Kettle").getByTestId("lists-favorites-remove").click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Chef knife"]);
  await expect(dirty(page)).toHaveText("false");
  await favoriteRow(page, "Walnut table").getByTestId("lists-favorites-down").click();
  await expect(favoriteTitles(page)).toHaveText(["Chef knife", "Walnut table"]);
  await expect(dirty(page)).toHaveText("true");
  await favoriteRow(page, "Walnut table").getByTestId("lists-favorites-up").click();
  await expect(dirty(page)).toHaveText("false");

  // The products table keeps its own order: the membership of one list is not the other's.
  await expect(page.getByTestId("lists-products-title").first()).toHaveText("Walnut table");
  await requests(page, 1, 1);
});

test("Restore saved reloads the favorites: the saved membership, order and values come back", async ({ page, pageErrors }) => {
  void pageErrors;
  await openFavorites(page);

  await star(page, "Kettle").click();
  await productRow(page, "Kettle").getByTestId("lists-products-price").fill("55");
  await productRow(page, "Chef knife").getByTestId("lists-products-price").fill("99");
  await favoriteRow(page, "Kettle").getByTestId("lists-favorites-up").click();
  await favoriteRow(page, "Walnut table").getByTestId("lists-favorites-remove").click();
  await expect(favoriteTitles(page)).toHaveText(["Kettle", "Chef knife"]);
  await expect(dirty(page)).toHaveText("true");

  await restore(page).click();
  await expect(favoriteTitles(page)).toHaveText(["Walnut table", "Chef knife"]);
  await expect(dirty(page)).toHaveText("false");
  await expect(restore(page)).toBeDisabled();
  await requests(page, 1, 2);

  // The reload returned Chef knife as saved: its price is the server's again, in both lists.
  await expect(favoriteRow(page, "Chef knife").getByTestId("lists-favorites-price")).toHaveValue("75");
  await expect(productRow(page, "Chef knife").getByTestId("lists-products-price")).toHaveValue("75");
  // Kettle left the favorites; the reload did not return it, so its edited price stays.
  await expect(star(page, "Kettle")).toHaveAttribute("aria-pressed", "false");
  await expect(productRow(page, "Kettle").getByTestId("lists-products-price")).toHaveValue("55");
  await expect(star(page, "Walnut table")).toHaveAttribute("aria-pressed", "true");
});
