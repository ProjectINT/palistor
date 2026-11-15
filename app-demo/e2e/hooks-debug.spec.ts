import { test, expect, selectOption, statePreview, readJson } from "./fixtures";

// Tabs "User Profile" (per-field reads from the shared store), "Debug Panel"
// and the side panel (StatePreview): the stores are module-level, so a write
// on one tab is visible on the others.

test("hooks tab reads field state written on the form tab", async ({ page, openTab }) => {
  await openTab("form");
  await page.getByRole("textbox", { name: "Card Number*" }).pressSequentially("4242");
  await page.getByRole("textbox", { name: "Email*" }).fill("bad");

  await page.getByRole("button", { name: "User Profile" }).click();
  await expect(page).toHaveURL(/#hooks$/);
  const state = page.locator("div", { has: page.getByRole("heading", { name: "form.paymentType — the proxy" }) }).last().locator("pre");
  const json = await readJson(state);
  expect(json).toMatchObject({
    value: "card",
    label: "Payment Type",
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
  });
  await expect(page.locator("div", { has: page.getByRole("heading", { name: "form.cardNumber.value" }) }).last()).toContainText('"4242"');
  await expect(page.locator("div", { has: page.getByRole("heading", { name: "form.cardNumber.isVisible" }) }).last()).toContainText("isVisible: true");

  // Hide the card branch on the form tab → the hooks tab sees isVisible false.
  await page.getByRole("button", { name: "Payment Form" }).click();
  await selectOption(page, "Payment Type", "Bank Transfer");
  await page.getByRole("button", { name: "User Profile" }).click();
  await expect(page.locator("div", { has: page.getByRole("heading", { name: "form.cardNumber.isVisible" }) }).last()).toContainText("isVisible: false");
  expect((await readJson(state)).value).toBe("bank");
});

test("hooks tab shows the email error after a failed submit", async ({ page, openTab }) => {
  await openTab("form");
  await page.getByRole("textbox", { name: "Email*" }).fill("bad");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByText("Invalid email")).toBeVisible();
  await page.getByRole("button", { name: "User Profile" }).click();
  await expect(page.locator("div", { has: page.getByRole("heading", { name: "form.email.errorMessage" }) }).last()).toContainText("Invalid email");
});

test("debug panel shows both stores' values", async ({ page, openTab }) => {
  // Lists resolve lazily on first read through a proxy; the debug panel reads
  // getValues() only, so load them on the lists tab first.
  await openTab("lists");
  await expect(page.getByText("Count: 3")).toBeVisible();
  await expect(page.getByText("Total: 4 products")).toBeVisible();
  await page.getByRole("button", { name: "Debug Panel" }).click();
  await expect(page.getByRole("heading", { name: "Form State" })).toBeVisible();
  const payment = page.locator("div", { has: page.getByRole("heading", { name: /paymentStore/ }) }).last().locator("pre");
  const paymentValues = await readJson(payment);
  expect(paymentValues).toMatchObject({ paymentType: "card", total: 100 });
  // HeroUI's text input reports its value back as a string on mount.
  expect(Number(paymentValues.price)).toBe(100);
  expect(Number(paymentValues.quantity)).toBe(1);
  const catalog = page.locator("div", { has: page.getByRole("heading", { name: /catalogStore/ }) }).last();
  await expect(catalog.getByText("Users: 3")).toBeVisible();
  await expect(catalog.getByText("Products: 4")).toBeVisible();
});

test("side panel switches the previewed store with the tab", async ({ page, openTab }) => {
  await openTab("form");
  const label = page.locator("h2", { hasText: "Values" }).locator("..").locator("p").first();
  await expect(label).toHaveText("paymentStore");
  expect((await readJson(statePreview(page))).paymentType).toBe("card");

  await page.getByRole("button", { name: "Lists & Entities" }).click();
  await expect(label).toHaveText("catalogStore");
  await page.getByRole("button", { name: "Field Mapping" }).click();
  await expect(label).toHaveText("mappingStore");
  expect(await readJson(statePreview(page))).toEqual({ email: "", password: "", nickname: "guest_42" });
  await page.getByRole("button", { name: "Flow Wizard" }).click();
  await expect(label).toHaveText("flowStore");
  expect((await readJson(statePreview(page))).onboarding.account).toEqual({ fullName: "", email: "" });
});
