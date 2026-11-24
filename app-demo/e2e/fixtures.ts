import { test as base, expect, type Locator, type Page } from "@playwright/test";

export type Tab = "form" | "flow" | "lists" | "async" | "hooks" | "mapping" | "debug";

declare global {
  interface Window {
    /** Math.random() draws from [lo, hi) — mock APIs fail when random < 0.2 / 0.25. */
    __e2eRandomRange?: [number, number];
  }
}

type Fixtures = {
  /** Uncaught page errors and console.error lines, collected per test. */
  pageErrors: string[];
  /** Open the demo on a tab (hash route) and wait for it to render. */
  openTab: (tab: Tab) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  pageErrors: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
    // The mock APIs fail at random (passport save 20 %, user save 25 %).
    // Tests are deterministic: random draws from [0.5, 1) (never fails) unless
    // a test calls forceMockFailures(). The draw stays random — libraries use
    // Math.random for ids, and a constant makes those ids collide.
    await page.addInitScript(() => {
      const original = Math.random.bind(Math);
      window.__e2eRandomRange = [0.5, 1];
      Math.random = () => {
        const [lo, hi] = window.__e2eRandomRange ?? [0, 1];
        return lo + original() * (hi - lo);
      };
    });
    await use(errors);
    if (errors.length > 0) {
      await testInfo.attach("page-errors", { body: errors.join("\n"), contentType: "text/plain" });
    }
    // An uncaught exception in the page is always a failure; React/console
    // noise is attached above for review but does not fail the test.
    expect(errors.filter((e) => e.startsWith("pageerror")), "uncaught page errors").toEqual([]);
  },

  openTab: async ({ page, pageErrors }, use) => {
    void pageErrors; // make sure error collection is installed first
    await use(async (tab) => {
      await page.goto(`./#${tab}`);
      await waitForHydration(page);
      // The prerendered HTML shows the default tab; the hash takes over after hydration.
      await expect(page.getByRole("button", { name: TAB_LABELS[tab], exact: true })).toHaveClass(/border-blue-500/);
    });
  },
});

export { expect };
export type { Locator, Page };

export const TAB_LABELS: Record<Tab, string> = {
  form: "Payment Form",
  flow: "Flow Wizard",
  lists: "Lists & Entities",
  async: "Async Resolvers",
  hooks: "User Profile",
  mapping: "Field Mapping",
  debug: "Debug Panel",
};

/**
 * The page is server-rendered: inputs exist before React hydrates them, and
 * typing into them then is lost. React tags hydrated DOM nodes with
 * `__reactProps$…`; wait until the tab buttons carry it.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector("header button");
    return !!button && Object.keys(button).some((k) => k.startsWith("__reactProps"));
  });
}

/** From now on the mock APIs' random failures always fire. */
export async function forceMockFailures(page: Page) {
  await page.evaluate(() => { window.__e2eRandomRange = [0, 0.1]; });
}

/**
 * Pick an option of a HeroUI <Select> found by its label. Driven by keyboard
 * (open, Home, ArrowDown to the option, Enter): mouse clicks race the
 * popover's open animation and its close-on-scroll, and type-ahead trips on
 * option texts with spaces and dashes.
 */
export async function selectOption(page: Page, label: string | RegExp, option: string) {
  // A required select's label ends with "*".
  const name = typeof label === "string" ? new RegExp(`${escapeRegExp(label)}\\*?$`) : label;
  const trigger = page.getByRole("button", { name });
  const listbox = page.getByRole("listbox");
  // Enter on a trigger that has just re-rendered is sometimes dropped: retry.
  await expect(async () => {
    if (!(await listbox.isVisible())) {
      await trigger.focus();
      await page.keyboard.press("Enter");
    }
    await expect(listbox.getByRole("option", { name: option, exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  // Focus moves into the listbox a moment after it opens; a key pressed
  // before that is lost.
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest("[role=listbox]")))
    .toBe(true);
  const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  const count = await listbox.getByRole("option").count();
  await page.keyboard.press("Home");
  for (let i = 0; i < count && (await focusedText()) !== option; i++) {
    await page.keyboard.press("ArrowDown");
  }
  expect(await focusedText()).toBe(option);
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(trigger).toContainText(option);
}

/**
 * Click a button that opens a native alert(); resolves with its message.
 * The handler must be installed before the click: an open alert blocks the
 * click from completing.
 */
export async function clickForAlert(page: Page, target: Locator): Promise<string> {
  const message = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.dismiss();
    });
  });
  await target.click();
  return message;
}

/** The `<pre>` with the side-panel JSON (StatePreview). */
export function statePreview(page: Page): Locator {
  return page.locator("h2", { hasText: "Values" }).locator("..").locator("pre");
}

/** Parse the JSON shown in a `<pre>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions walk the parsed JSON freely
export async function readJson<T = any>(pre: Locator): Promise<T> {
  return JSON.parse((await pre.textContent()) ?? "null") as T;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
