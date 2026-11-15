import { test, expect, type Page } from "./fixtures";

// Tab "Lists & Entities": catalogStore — defineList with a list resolver and a
// per-entity field resolver, add (temp id → rekey), remove / delete /
// invalidate, entity projection (useForm(entity, template)) with template and
// lazy field resolves, auto-deps list (products), paginated list (orders),
// useStoreContext, list loading / dirty flags.

const usersSection = (page: Page) =>
  page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Users", exact: true }) });
const userRow = (page: Page, name: string) =>
  usersSection(page).locator("div.rounded-lg.border", { hasText: name });

test.beforeEach(async ({ openTab }) => {
  await openTab("lists");
});

test("users list resolves, per-entity status resolves for each row", async ({ page }) => {
  const section = usersSection(page);
  await expect(section.getByText("Count: 3")).toBeVisible();
  await expect(section.getByText("Loading...")).toHaveCount(0);
  await expect(userRow(page, "Alice Johnson")).toContainText("alice@example.com");
  await expect(userRow(page, "Alice Johnson")).toContainText("admin");
  // isActive: per-entity field resolver, different delays per user.
  await expect(userRow(page, "Alice Johnson")).toContainText("● online");
  await expect(userRow(page, "Bob Smith")).toContainText("○ offline");
  await expect(userRow(page, "Charlie Brown")).toContainText("● online");
  await expect(section.getByText("● Modified")).toHaveCount(0);
});

test("add user: temp row appears at once and is rekeyed by the server id", async ({ page }) => {
  const section = usersSection(page);
  await expect(section.getByText("Count: 3")).toBeVisible();
  const add = section.getByRole("button", { name: "Add User" });
  await expect(add).toBeDisabled();
  await section.getByPlaceholder("Name").fill("Dana Scully");
  await section.getByPlaceholder("Email").fill("dana@fbi.gov");
  await add.click();

  await expect(section.getByText("Count: 4")).toBeVisible();
  await expect(userRow(page, "Dana Scully")).toContainText("Saving...");
  await expect(section.getByRole("button", { name: "Saving..." })).toBeVisible();
  // After rekey the temp badge is gone, Edit/Delete are available.
  await expect(userRow(page, "Dana Scully").getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(userRow(page, "Dana Scully")).not.toContainText("Saving...");
  // afterSubmit → reset() cleared the add form.
  await expect(section.getByPlaceholder("Name")).toHaveValue("");
  await expect(section.getByPlaceholder("Email")).toHaveValue("");
});

test("remove takes the row out of the list and marks the list dirty", async ({ page }) => {
  const section = usersSection(page);
  await expect(section.getByText("Count: 3")).toBeVisible();
  await userRow(page, "Bob Smith").getByRole("button", { name: "Remove" }).click();
  await expect(section.getByText("Count: 2")).toBeVisible();
  await expect(userRow(page, "Bob Smith")).toHaveCount(0);
  await expect(section.getByText("● Modified")).toBeVisible();
  await expect(page.getByText("✏️ modified")).toBeVisible();
});

test("delete removes the row and the entity", async ({ page }) => {
  const section = usersSection(page);
  await expect(section.getByText("Count: 3")).toBeVisible();
  await userRow(page, "Charlie Brown").getByRole("button", { name: "Delete" }).click();
  await expect(section.getByText("Count: 2")).toBeVisible();
  await expect(userRow(page, "Charlie Brown")).toHaveCount(0);
});

test("refresh list re-runs the list resolver (auto-dep on usersRefreshKey)", async ({ page }) => {
  const section = usersSection(page);
  await expect(section.getByText("Count: 3")).toBeVisible();
  await userRow(page, "Bob Smith").getByRole("button", { name: "Remove" }).click();
  await expect(section.getByText("Count: 2")).toBeVisible();
  await section.getByRole("button", { name: "↻ Refresh List" }).click();
  await expect(section.getByText("Loading...")).toBeVisible();
  await expect(section.getByText("Count: 3")).toBeVisible();
  await expect(userRow(page, "Bob Smith")).toBeVisible();
});

test.describe("entity edit modal", () => {
  const modal = (page: Page) =>
    page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: "Edit User" }) });

  test("template resolve fills details, bio resolves lazily", async ({ page }) => {
    await expect(usersSection(page).getByText("Count: 3")).toBeVisible();
    await userRow(page, "Alice Johnson").getByRole("button", { name: "Edit" }).click();
    const m = modal(page);
    await expect(m.getByText("Loading details...")).toBeVisible();
    await expect(m.getByPlaceholder("Department")).toHaveValue("Engineering");
    await expect(m.getByPlaceholder("Phone")).toHaveValue("+1-555-0101");
    await expect(m.getByPlaceholder("Name")).toHaveValue("Alice Johnson");
    await expect(m.getByPlaceholder("Email")).toHaveValue("alice@example.com");
    await expect(m.getByPlaceholder("Tell about yourself...")).toHaveValue(/Senior developer/);
    await expect(m.getByText("Unsaved changes")).toHaveCount(0);
  });

  test("editing marks dirty and validates; save updates the row", async ({ page }) => {
    await expect(usersSection(page).getByText("Count: 3")).toBeVisible();
    await userRow(page, "Bob Smith").getByRole("button", { name: "Edit" }).click();
    const m = modal(page);
    await expect(m.getByPlaceholder("Department")).toHaveValue("Product");

    // An entity view's leaf validates live (no submit needed).
    await m.getByPlaceholder("Email").fill("not-an-email");
    await expect(m.getByText("Invalid email")).toBeVisible();
    await m.getByPlaceholder("Email").fill("bob@example.com");
    await expect(m.getByText("Invalid email")).toHaveCount(0);

    await m.getByPlaceholder("Name").fill("Robert Smith");
    await expect(m.getByText("Unsaved changes")).toBeVisible();
    await m.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("User saved successfully")).toBeVisible();
    await expect(m).toHaveCount(0, { timeout: 5_000 });
    await expect(userRow(page, "Robert Smith")).toBeVisible();
  });

  test("close discards nothing in the list; reopening shows the entity", async ({ page }) => {
    await expect(usersSection(page).getByText("Count: 3")).toBeVisible();
    await userRow(page, "Charlie Brown").getByRole("button", { name: "Edit" }).click();
    const m = modal(page);
    await expect(m.getByPlaceholder("Department")).toHaveValue("Marketing");
    await m.getByRole("button", { name: "Close" }).click();
    await expect(m).toHaveCount(0);

    // Invalidate the resolve cache, reopen → template resolve runs again.
    await userRow(page, "Charlie Brown").getByRole("button", { name: "↻" }).click();
    await userRow(page, "Charlie Brown").getByRole("button", { name: "Edit" }).click();
    await expect(m.getByPlaceholder("Department")).toHaveValue("Marketing");
  });
});

test("products: the category filter re-runs the resolver (auto-deps)", async ({ page }) => {
  const section = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Products", exact: true }) });
  await expect(section.getByText("Total: 4 products")).toBeVisible();
  await expect(section.getByText("Standing Desk")).toBeVisible();

  await section.getByRole("button", { name: "Furniture" }).click();
  await expect(section.getByText("Total: 1 products")).toBeVisible();
  await expect(section.getByText("Out of Stock")).toBeVisible();
  await expect(section.getByText("Laptop Pro")).toHaveCount(0);

  await section.getByRole("button", { name: "Electronics" }).click();
  await expect(section.getByText("Total: 3 products")).toBeVisible();
  await expect(section.getByText("Standing Desk")).toHaveCount(0);

  await section.getByRole("button", { name: "All" }).click();
  await expect(section.getByText("Total: 4 products")).toBeVisible();
});

test.describe("orders: paginated list", () => {
  const ordersSection = (page: Page) =>
    page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Orders (paginated)" }) });

  test("pages, cached page switch, search re-keys the cache, refetch", async ({ page }) => {
    const s = ordersSection(page);
    await expect(s.getByText("Page 1 of 12")).toBeVisible();
    await expect(s.getByText("57 orders")).toBeVisible();
    await expect(s.getByText("Order #1000", { exact: true })).toBeVisible();
    await expect(s.getByText("Order #1004", { exact: true })).toBeVisible();
    await expect(s.getByText("Order #1005", { exact: true })).toHaveCount(0);
    await expect(s.getByRole("button", { name: /Prev/ })).toBeDisabled();

    await s.getByRole("button", { name: /Next/ }).click();
    await expect(s.getByText("Page 2 of 12")).toBeVisible();
    await expect(s.getByText("Order #1005", { exact: true })).toBeVisible();
    await expect(s.getByText("Order #1000", { exact: true })).toHaveCount(0);

    // Back to a cached page: a synchronous projection, no fetch spinner.
    await s.getByRole("button", { name: /Prev/ }).click();
    await expect(s.getByText("Page 1 of 12")).toBeVisible();
    await expect(s.getByText("Order #1000", { exact: true })).toBeVisible();

    await s.getByPlaceholder("Search...").fill("cancelled");
    await expect(s.getByText("14 orders")).toBeVisible();
    await expect(s.getByText("Page 1 of 3")).toBeVisible();
    await expect(s.getByText("Order #1003", { exact: true })).toBeVisible();

    await s.getByPlaceholder("Search...").fill("");
    await expect(s.getByText("57 orders")).toBeVisible();

    await s.getByRole("button", { name: /Refetch/ }).click();
    await expect(s.getByText("Page 1 of 12")).toBeVisible();
    await expect(s.getByText("Order #1000", { exact: true })).toBeVisible();
  });

  test("removing a row marks the paginated list dirty", async ({ page }) => {
    const s = ordersSection(page);
    await expect(s.getByText("Order #1001", { exact: true })).toBeVisible();
    await s.locator("div.rounded-lg.border", { hasText: "Order #1001" }).getByRole("button", { name: "✕" }).click();
    await expect(s.getByText("Order #1001", { exact: true })).toHaveCount(0);
    await expect(s.getByText("List modified")).toBeVisible();
  });
});

test("useStoreContext: switching the context re-renders the context view", async ({ page }) => {
  const s = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "useStoreContext Demo" }) });
  await expect(s.getByText('"demo-123"')).toBeVisible();
  await expect(s.getByText('"acme"')).toBeVisible();
  await s.getByRole("button", { name: "acme-prod" }).click();
  await expect(s.getByText('"acme-prod"')).toBeVisible();
  await s.getByRole("button", { name: "dev-org" }).click();
  await expect(s.getByText('"dev-org"')).toBeVisible();

  // The users resolver reads store.context.accountId; the refresh still works.
  const users = usersSection(page);
  await users.getByRole("button", { name: "↻ Refresh List" }).click();
  await expect(users.getByText("Count: 3")).toBeVisible();
});

test("list stats panel mirrors the lists", async ({ page }) => {
  const stats = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "List Stats" }) });
  await expect(stats.getByText("3 items")).toBeVisible();
  await expect(stats.getByText("4 items")).toBeVisible();
});
