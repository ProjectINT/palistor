import { test, expect, waitForHydration } from "./fixtures";

// Shell: hash routing between tabs and the locale switch, which goes through
// useTranslator — labels computed with `t` in the store must follow the locale.

const TABS = [
  ["Payment Form", "form"],
  ["Flow Wizard", "flow"],
  ["Lists & Entities", "lists"],
  ["Async Resolvers", "async"],
  ["User Profile", "hooks"],
  ["Field Mapping", "mapping"],
  ["Debug Panel", "debug"],
] as const;

test("every tab opens by click and by deep link", async ({ page, openTab }) => {
  await openTab("form");
  for (const [label, hash] of TABS) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
  }
  await page.goBack();
  await expect(page).toHaveURL(/#mapping$/);
  await expect(page.getByRole("heading", { name: "Field Mapping", level: 2 })).toBeVisible();

  await openTab("flow");
  await expect(page.getByRole("heading", { name: /Flow — a step-by-step wizard/ })).toBeVisible();
});

test("locale switch re-translates store labels (useTranslator)", async ({ page, openTab }) => {
  await openTab("form");
  await expect(page.getByRole("textbox", { name: "Card Number*" })).toBeVisible();
  // The switch writes a cookie and reloads the page.
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "🇷🇺 RU" }).click()]);
  await waitForHydration(page);
  // Labels come from the store config (`label: (t) => t("form.cardNumber")`).
  await expect(page.getByRole("textbox", { name: "Номер карты*" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Card Number/ })).toHaveCount(0);

  // A validation message produced by `validate(value, values, t)` follows too.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Оплатить", exact: true }).click();
  await expect(page.getByText("Некорректный email")).toBeVisible();

  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "🇺🇸 EN" }).click()]);
  await waitForHydration(page);
  await expect(page.getByRole("textbox", { name: "Card Number*" })).toBeVisible();
});
