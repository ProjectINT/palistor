import { test, expect, selectOption, statePreview, readJson, waitForHydration, forceMockFailures, clickForAlert } from "./fixtures";

// Tab "Payment Form": one global store (appStore) — visibility and
// requiredness branches, formatters, setter cascade, computed values,
// onChange, nested group submit, form submit/reset/setValues, persist.

test.beforeEach(async ({ openTab }) => {
  await openTab("form");
});

test("payment type switches the visible branch", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: "Card Number*" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Bank Account/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Passport Information" })).toHaveCount(0);

  await selectOption(page, "Payment Type", "Bank Transfer");
  await expect(page.getByRole("textbox", { name: /Card Number/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Bank Account*" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "BIK Code*" })).toBeVisible();
  // The nested passport group is visible only for bank transfers.
  await expect(page.getByRole("heading", { name: "Passport Information" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Passport Number*" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Issue Date*" })).toBeVisible();

  await selectOption(page, "Payment Type", "Cryptocurrency");
  await expect(page.getByRole("textbox", { name: "Crypto Wallet*" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ethereum Network\*$/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Bank Account/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Passport Information" })).toHaveCount(0);

  await selectOption(page, "Network", "Bitcoin");
  await expect(page.getByRole("button", { name: /Bitcoin Network\*$/ })).toBeVisible();
  expect((await readJson(statePreview(page))).cryptoNetwork).toBe("bitcoin");
});

test("formatters shape the value as it is typed", async ({ page }) => {
  const card = page.getByRole("textbox", { name: "Card Number*" });
  await card.pressSequentially("4111111111111111");
  await expect(card).toHaveValue("4111 1111 1111 1111");

  const expiry = page.getByRole("textbox", { name: "Expiry Date*" });
  await expiry.pressSequentially("1229");
  await expect(expiry).toHaveValue("12/29");

  const cvv = page.getByRole("textbox", { name: "CVV*" });
  await cvv.pressSequentially("1a2345");
  await expect(cvv).toHaveValue("123");

  const phone = page.getByRole("textbox", { name: "Phone" });
  await phone.pressSequentially("15551234567");
  await expect(phone).toHaveValue("+1 (555) 123-45-67");

  const values = await readJson(statePreview(page));
  expect(values.cardNumber).toBe("4111 1111 1111 1111");
  expect(values.cardExpiry).toBe("12/29");
  expect(values.phone).toBe("+1 (555) 123-45-67");
});

test("conditional requiredness: company name only for business accounts", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: /Company Name/ })).toHaveCount(0);
  await selectOption(page, "Account Type", "Business");
  await expect(page.getByRole("textbox", { name: "Company Name*" })).toBeVisible();
  await selectOption(page, "Account Type", "Personal");
  await expect(page.getByRole("textbox", { name: /Company Name/ })).toHaveCount(0);
});

test("address cascade: setter resets the city, shipping cost is computed", async ({ page }) => {
  await expect(page.getByRole("button", { name: /City$/ })).toHaveCount(0);

  await selectOption(page, "Country", "USA");
  await expect(page.getByRole("button", { name: /City$/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Shipping Cost" })).toHaveCount(0);

  await selectOption(page, "City", "New York");
  await expect(page.getByRole("textbox", { name: "Shipping Cost" })).toHaveValue("25");

  // The country setter clears the city → shipping cost disappears again.
  await selectOption(page, "Country", "Germany");
  await expect(page.getByRole("textbox", { name: "Shipping Cost" })).toHaveCount(0);
  expect((await readJson(statePreview(page))).city).toBe("");

  await selectOption(page, "City", "Berlin");
  await expect(page.getByRole("textbox", { name: "Shipping Cost" })).toHaveValue("15");
});

test("calculator: total is computed from price and quantity", async ({ page }) => {
  const total = page.getByRole("textbox", { name: "Total" });
  await expect(total).toHaveValue("100");
  await page.getByRole("textbox", { name: "Price per unit" }).fill("20");
  await page.getByRole("textbox", { name: "Quantity" }).fill("3");
  await expect(total).toHaveValue("60");
  await page.getByRole("textbox", { name: "Quantity" }).fill("7");
  await expect(total).toHaveValue("140");
});

test("onChange handler writes lastModified when the email changes", async ({ page }) => {
  await expect(page.getByText("Last email change:")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Email*" }).pressSequentially("a@b.c");
  await expect(page.getByText("Last email change:")).toBeVisible();
  expect((await readJson(statePreview(page))).lastModified).toBeGreaterThan(0);
});

test("checkboxes write booleans", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Agree to Terms" }).check();
  await page.getByRole("checkbox", { name: "Newsletter" }).check();
  let values = await readJson(statePreview(page));
  expect(values.agreeTerms).toBe(true);
  expect(values.newsletter).toBe(true);
  await page.getByRole("checkbox", { name: "Newsletter" }).uncheck();
  values = await readJson(statePreview(page));
  expect(values.newsletter).toBe(false);
});

test("submit of an empty form fails and shows the validation errors", async ({ page }) => {
  const message = await clickForAlert(page, page.getByRole("button", { name: "Pay", exact: true }));
  expect(message).toContain("Form submission failed!");
  expect(message).toContain("email");
  expect(message).toContain("cardNumber");
  // The hidden bank / crypto fields guard their validators on paymentType.
  expect(message).not.toContain("bankAccount");
  expect(message).not.toContain("cryptoWallet");

  await expect(page.getByText("Card number must contain 16 digits")).toBeVisible();
  await expect(page.getByText("Minimum amount: 1")).toBeVisible();
  await expect(page.getByText("Invalid email")).toBeVisible();
  await expect(page.getByText("Required field").first()).toBeVisible();
});

test("submit of a valid bank transfer succeeds with the form values", async ({ page }) => {
  await selectOption(page, "Payment Type", "Bank Transfer");
  await page.getByRole("textbox", { name: "Bank Account*" }).fill("40817810099910004312");
  await page.getByRole("textbox", { name: "BIK Code*" }).fill("044525225");
  await page.getByRole("textbox", { name: /^Passport Number/ }).fill("AB 123456");
  await page.getByLabel("Issue Date").fill("2020-01-15");
  await page.getByRole("spinbutton", { name: "Amount*" }).fill("50");
  await page.getByRole("textbox", { name: "Name*" }).fill("Ada");
  await page.getByRole("textbox", { name: "Email*" }).fill("ada@example.com");
  await page.getByRole("checkbox", { name: "Agree to Terms" }).check();

  const message = await clickForAlert(page, page.getByRole("button", { name: "Pay", exact: true }));
  expect(message).toContain("Form submitted!");
  expect(message).toContain('"name": "Ada"');
  expect(message).toContain('"bankAccount": "40817810099910004312"');
  expect(message).toContain('"number": "AB 123456"');
});

// Open question (same in store and Cube): every leaf of the subtree is
// validated on submit, hidden ones included, and a nested field's functions
// see only its group's values — so the passport (bank branch only) cannot make
// itself optional for card payments, and "Pay" with a card always fails on
// passport.number / passport.issueDate.
test.fixme("submit of a valid card payment succeeds", async ({ page }) => {
  await page.getByRole("textbox", { name: "Card Number*" }).fill("4111111111111111");
  await page.getByRole("textbox", { name: "Expiry Date*" }).fill("1229");
  await page.getByRole("textbox", { name: "CVV*" }).fill("123");
  await page.getByRole("spinbutton", { name: "Amount*" }).fill("50");
  await page.getByRole("textbox", { name: "Name*" }).fill("Ada");
  await page.getByRole("textbox", { name: "Email*" }).fill("ada@example.com");
  await page.getByRole("checkbox", { name: "Agree to Terms" }).check();
  const message = await clickForAlert(page, page.getByRole("button", { name: "Pay", exact: true }));
  expect(message).toContain("Form submitted!");
});

test("setValues fills the form, reset restores the initial values", async ({ page }) => {
  await page.getByRole("button", { name: "Fill Demo Data" }).click();
  await expect(page.getByRole("textbox", { name: "Name*" })).toHaveValue("John Doe");
  await expect(page.getByRole("textbox", { name: "Email*" })).toHaveValue("john@example.com");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  const filled = await readJson(statePreview(page));
  expect(filled.country).toBe("us");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name*" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Email*" })).toHaveValue("");
  const reset = await readJson(statePreview(page));
  expect(reset.country).toBe("");
  expect(reset.name).toBe("");
});

test.describe("nested passport group", () => {
  test.beforeEach(async ({ page }) => {
    await selectOption(page, "Payment Type", "Bank Transfer");
    await expect(page.getByRole("heading", { name: "Passport Information" })).toBeVisible();
  });

  // A group's isInvalid is its own computed flag (from a group-level
  // validate), not an aggregate of its children: the passport has none, so
  // "Save Passport" stays enabled and validation runs inside submit().
  test("dirty state and group reset", async ({ page }) => {
    const number = page.getByRole("textbox", { name: /^Passport Number/ });
    await expect(page.getByText("dirty=false")).toBeVisible();
    await number.fill("AB12");
    await expect(page.getByText("dirty=true")).toBeVisible();
    await expect(page.getByText("Unsaved changes").first()).toBeVisible();
    await expect(page.getByTitle("Field changed")).toHaveCount(1);

    await page.getByRole("button", { name: "Reset Passport" }).click();
    await expect(number).toHaveValue("");
    await expect(page.getByText("dirty=false")).toBeVisible();
    await expect(page.getByTitle("Field changed")).toHaveCount(0);
  });

  test("group submit validates the group, then runs onSubmit: success and failure", async ({ page }) => {
    const number = page.getByRole("textbox", { name: /^Passport Number/ });
    const save = page.getByRole("button", { name: "Save Passport" });
    await number.fill("AB12");
    await save.click();
    await expect(page.getByText(/✕ .*Passport number is too short/)).toBeVisible();
    await expect(page.getByText("Passport number is too short").last()).toBeVisible();
    await expect(page.getByText("Required field").first()).toBeVisible();

    // After a failed submit the errors are live: fixing the value clears them.
    await number.fill("AB 123456");
    await page.getByLabel("Issue Date").fill("2020-01-15");
    await expect(page.locator("[data-slot='error-message']")).toHaveCount(0);

    await save.click();
    await expect(page.getByText("✓ Saved")).toBeVisible();
    await expect(page.getByText("submitting=false")).toBeVisible();
    // beforeSubmit strips spaces for the request only; the field keeps them.
    await expect(number).toHaveValue("AB 123456");

    await forceMockFailures(page);
    await save.click();
    await expect(page.getByText("submitting=true")).toBeVisible();
    await expect(page.getByText(/✕ .*failed to save passport/)).toBeVisible();
  });

  test("expiry date validation reads another nested field", async ({ page }) => {
    await page.getByRole("textbox", { name: /^Passport Number/ }).fill("AB123456");
    const issue = page.getByLabel("Issue Date");
    const expiry = page.getByLabel("Expiry Date").last();
    const errors = page.locator("[data-slot='error-message']");
    await issue.fill("2098-01-01");
    await expiry.fill("2097-06-01");
    await page.getByRole("button", { name: "Save Passport" }).click();
    await expect(errors.filter({ hasText: "Expiry date must be after issue date" })).toBeVisible();
    await expect(errors.filter({ hasText: "Issue date cannot be in the future" })).toBeVisible();

    // Changing the OTHER field (issue date) revalidates the expiry date.
    await issue.fill("2020-01-15");
    await expect(errors).toHaveCount(0);

    await expiry.fill("2019-01-01");
    await expect(errors.filter({ hasText: "Passport has expired" })).toBeVisible();
    await expiry.fill("2099-01-01");
    await expect(errors).toHaveCount(0);
    await page.getByRole("button", { name: "Save Passport" }).click();
    await expect(page.getByText("✓ Saved")).toBeVisible();
  });
});

test.describe("persist", () => {
  test("picked fields are saved (debounced), restored on reload, cleared", async ({ page }) => {
    await page.getByRole("textbox", { name: "Name*" }).fill("Persisted Name");
    await page.getByRole("textbox", { name: "Comment" }).fill("not picked");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("payment-form-demo")))
      .toContain("Persisted Name");
    const saved = await page.evaluate(() => localStorage.getItem("payment-form-demo"));
    expect(saved).not.toContain("not picked");

    await page.getByRole("button", { name: "View Saved" }).click();
    await expect(page.locator("pre", { hasText: "Persisted Name" }).first()).toBeVisible();

    await page.reload();
    await waitForHydration(page);
    await expect(page.getByRole("textbox", { name: "Name*" })).toHaveValue("Persisted Name");
    await expect(page.getByRole("textbox", { name: "Comment" })).toHaveValue("");

    await page.getByRole("button", { name: "Clear Saved" }).click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("payment-form-demo"))).toBeNull();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
  });

  test("force save writes immediately; the driver switches to sessionStorage", async ({ page }) => {
    await page.getByRole("button", { name: "Switch to sessionStorage" }).click();
    await expect(page.getByText("sessionStorage", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch to localStorage" })).toBeVisible();
    await page.getByRole("textbox", { name: "Email*" }).fill("session@example.com");
    await page.getByRole("button", { name: "Force Save" }).click();
    await expect
      .poll(async () => page.evaluate(() => sessionStorage.getItem("payment-form-demo")))
      .toContain("session@example.com");
    await expect(page.locator("pre", { hasText: "session@example.com" }).first()).toBeVisible();
  });
});
