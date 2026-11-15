import { test, expect, readJson } from "./fixtures";

// Tab "Async Resolvers": loading flags of lists and a group, group resolve
// with retry (the mock fails 2 of 3 calls), auto-deps, live store values.

test.beforeEach(async ({ openTab }) => {
  await openTab("async");
});

test("loading states settle for lists and the resolved group", async ({ page }) => {
  const card = (label: string) => page.locator("div.rounded-lg", { has: page.getByText(label, { exact: true }) });
  await expect(card("Users List")).toContainText("3 items");
  await expect(card("Products List")).toContainText("4 items");
  await expect(card("Server Status")).toContainText("ok", { timeout: 15_000 });
});

test("group resolve retries until the service answers", async ({ page }) => {
  const section = page.locator("div", { has: page.getByRole("heading", { name: "Retry & Error Handling" }) }).last();
  await expect(section.getByText("Waiting / retrying...")).toBeVisible();
  // Two failures × 1 s retry delay, then success.
  await expect(section.locator("strong", { hasText: "ok" })).toBeVisible({ timeout: 15_000 });
  await expect(section.getByText(/Last check:/)).toBeVisible();
});

test("auto-deps: the filter buttons re-fetch products", async ({ page }) => {
  const section = page.locator("div", { has: page.getByRole("heading", { name: "Auto-Dependencies" }) }).last();
  await expect(section.getByText("4 loaded")).toBeVisible();
  await section.getByRole("button", { name: "furniture" }).click();
  await expect(section.getByText("re-fetching...")).toBeVisible();
  await expect(section.getByText("1 loaded")).toBeVisible();
  await expect(section.locator("code", { hasText: "furniture" })).toBeVisible();
  await section.getByRole("button", { name: "electronics" }).click();
  await expect(section.getByText("3 loaded")).toBeVisible();
  await section.getByRole("button", { name: "All" }).click();
  await expect(section.getByText("4 loaded")).toBeVisible();
  await expect(section.locator("code", { hasText: "(none)" })).toBeVisible();
});

test("store values debug view reflects resolved data", async ({ page }) => {
  const pre = page.locator("div", { has: page.getByRole("heading", { name: "Store Values (debug)" }) }).last().locator("pre");
  await expect.poll(async () => (await readJson(pre)).users?.length).toBe(3);
  await expect.poll(async () => (await readJson(pre)).products?.length).toBe(4);
  await expect.poll(async () => (await readJson(pre)).serverStatus?.status, { timeout: 15_000 }).toBe("ok");
  const values = await readJson(pre);
  expect(values.users[0]).toMatchObject({ id: "u1", name: "Alice Johnson", email: "alice@example.com", role: "admin" });
});
