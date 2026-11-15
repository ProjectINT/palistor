import { test, expect, statePreview, readJson } from "./fixtures";

// Tab "Field Mapping": config authored in external names, fields spread into
// a component that knows nothing about Palistor.

test.beforeEach(async ({ openTab }) => {
  await openTab("mapping");
});

test("the rename table lists the map", async ({ page }) => {
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("isRequired");
  await expect(rows.first()).toContainText("required");
});

test("the spread exposes external names only", async ({ page }) => {
  const keys = page
    .getByRole("heading", { name: "Object.keys({ ...form.email })" })
    .locator("xpath=../..")
    .locator("span.font-mono");
  await expect(keys.first()).toBeVisible();
  const names = await keys.allTextContents();
  for (const external of ["required", "disabled", "readOnly", "error", "helperText", "helpText", "value", "label"]) {
    expect(names, `spread has ${external}`).toContain(external);
  }
  for (const internal of ["isRequired", "isDisabled", "isReadOnly", "isInvalid", "errorMessage", "description"]) {
    expect(names, `spread lacks ${internal}`).not.toContain(internal);
  }
});

test("native field renders required marks, help text and read-only", async ({ page }) => {
  const email = page.getByPlaceholder("you@example.com");
  await expect(page.getByText("We never share your email")).toBeVisible();
  await expect(page.getByText("At least 8 characters")).toBeVisible();
  // required → the "*" mark next to the label (Email and Password).
  await expect(page.locator("label span.text-red-500", { hasText: "*" })).toHaveCount(2);
  const nickname = page.locator("input[value='guest_42']");
  await expect(nickname).toHaveAttribute("readonly", "");
  await email.fill("someone@example.com");
  expect((await readJson(statePreview(page))).email).toBe("someone@example.com");
});

test("submit validates: error / helperText under external names", async ({ page }) => {
  await page.getByRole("button", { name: "Submit (trigger validation)" }).click();
  await expect(page.getByText("Email is required")).toBeVisible();
  await expect(page.getByText("Password is required")).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveAttribute("aria-invalid", "true");
  // helperText replaces helpText while the field is in error.
  await expect(page.getByText("We never share your email")).toHaveCount(0);

  await page.getByPlaceholder("you@example.com").fill("nope");
  await expect(page.getByText("Invalid email address")).toBeVisible();
  await page.getByPlaceholder("you@example.com").fill("ok@example.com");
  await expect(page.getByText("Invalid email address")).toHaveCount(0);
  await expect(page.getByText("We never share your email")).toBeVisible();

  await page.getByPlaceholder("••••••••").fill("short");
  await expect(page.getByText("Too short — min 8 characters")).toBeVisible();
  await page.getByPlaceholder("••••••••").fill("long-enough");
  await expect(page.getByText("Too short — min 8 characters")).toHaveCount(0);
});
