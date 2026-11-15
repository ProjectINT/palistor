import { test, expect, selectOption, type Page } from "./fixtures";

// Tab "Flow Wizard": defineFlow / defineStep — per-step validation, navigation
// from a step's onSubmit, isVisible branching (Enterprise adds a step),
// history / canGoBack, aggregated values, flow.submit() and reset.

const next = (page: Page) => page.getByRole("button", { name: "Next →" });
const back = (page: Page) => page.getByRole("button", { name: "← Back" });
const stepTitle = (page: Page) => page.getByRole("heading", { level: 3 });
const history = (page: Page) => page.locator("span.font-mono", { hasText: "flow.history:" }).locator("..").locator("span.rounded");

async function fillAccount(page: Page) {
  await page.getByRole("textbox", { name: "Full name*" }).fill("Ada Lovelace");
  await page.getByRole("textbox", { name: "Work email*" }).fill("ada@example.com");
}

test.beforeEach(async ({ openTab }) => {
  await openTab("flow");
});

test("a step does not advance while it is invalid", async ({ page }) => {
  await expect(stepTitle(page)).toHaveText("Create your account");
  await expect(back(page)).toBeDisabled();
  await next(page).click();
  await expect(page.getByText("Enter at least 2 characters")).toBeVisible();
  await expect(page.getByText("Enter a valid email")).toBeVisible();
  await expect(stepTitle(page)).toHaveText("Create your account");

  await fillAccount(page);
  await next(page).click();
  await expect(stepTitle(page)).toHaveText("Choose a plan");
  await expect(back(page)).toBeEnabled();

  await next(page).click();
  await expect(page.getByText("Pick a plan to continue")).toBeVisible();
  await expect(stepTitle(page)).toHaveText("Choose a plan");
});

test("non-enterprise plan skips the company step", async ({ page }) => {
  await fillAccount(page);
  await next(page).click();
  // Three visible steps in the indicator; the hidden branch is out of sight.
  await expect(page.locator("ol li")).toHaveCount(3);
  await page.getByRole("button", { name: /^Pro/ }).click();
  await next(page).click();
  await expect(stepTitle(page)).toHaveText("Confirmation");
  await expect(history(page)).toHaveText(["account", "plan", "summary"]);
  await expect(page.locator("dd", { hasText: "Ada Lovelace" })).toBeVisible();
  await expect(page.locator("dd", { hasText: "Pro" })).toBeVisible();
  await expect(page.locator("dt", { hasText: "Company" })).toHaveCount(0);

  await back(page).click();
  await expect(stepTitle(page)).toHaveText("Choose a plan");
});

test("enterprise plan adds the company step, finish submits the flow", async ({ page }) => {
  await fillAccount(page);
  await next(page).click();
  await page.getByRole("button", { name: /^Enterprise/ }).click();
  await expect(page.locator("ol li")).toHaveCount(4);
  await next(page).click();
  await expect(stepTitle(page)).toHaveText("Company details");

  await next(page).click();
  await expect(page.getByText("Required field").or(page.locator("[data-slot='error-message']")).first()).toBeVisible();
  await expect(stepTitle(page)).toHaveText("Company details");

  await page.getByRole("textbox", { name: "Company name*" }).fill("Analytical Engines Ltd");
  await selectOption(page, "Team size", "51–200 people");
  await next(page).click();
  await expect(stepTitle(page)).toHaveText("Confirmation");
  await expect(page.locator("dd", { hasText: "Analytical Engines Ltd" })).toBeVisible();
  await expect(page.locator("dd", { hasText: "51-200" })).toBeVisible();
  await expect(history(page)).toHaveText(["account", "plan", "company", "summary"]);
  // Completed steps show a check in the indicator.
  await expect(page.locator("ol li span", { hasText: "✓" })).toHaveCount(3);

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("button", { name: "Submitting…" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done!" })).toBeVisible();
  const result = page.locator("pre", { hasText: '"ok": true' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('"companyName": "Analytical Engines Ltd"');
  await expect(result).toContainText('"plan": "enterprise"');

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(stepTitle(page)).toHaveText("Create your account");
  await expect(page.getByRole("textbox", { name: "Full name*" })).toHaveValue("");
  await expect(history(page)).toHaveText(["account"]);
});

test("switching back from enterprise hides the company step again", async ({ page }) => {
  await fillAccount(page);
  await next(page).click();
  await page.getByRole("button", { name: /^Enterprise/ }).click();
  await expect(page.locator("ol li")).toHaveCount(4);
  await page.getByRole("button", { name: /^Free/ }).click();
  await expect(page.locator("ol li")).toHaveCount(3);
  await next(page).click();
  await expect(stepTitle(page)).toHaveText("Confirmation");
  await expect(page.locator("dd", { hasText: "Free" })).toBeVisible();
});
