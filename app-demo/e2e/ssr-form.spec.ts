import { test, expect, type Page } from "./fixtures";

// Route /ssr/form: an editable form whose data comes from the server. The
// Server Component reads users.json and announcement.json and the client view
// hands the results to its stores as `initialData`. Four blocks:
//   1. profile — a group with `resolve` prefilled by the server (dirty, reset);
//   2. deps    — `userId` in both resolves' `deps`, and the list's reload();
//   3. errors  — a failed run: onError → ctx.notify → the provider's notifier;
//   4. draft   — a second store with usePersist: a localStorage draft over the server's data.
// The counters under the blocks count the fake endpoints' calls (and onError calls).
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/ssr is built on the Cube implementation only");

const ROUTE = "./ssr/form/";

/** DraftBlock.tsx's persist key. */
const DRAFT_KEY = "palistor-ssr-form-draft";

/** usr-1 in users.json: the user the server opens the page with. */
const ADA = {
  name: "Ada Lovelace",
  email: "ada@compilers-lab.test",
  role: "researcher",
  bio: "Wrote the first published program for the Analytical Engine.",
  activity: [/^Note G: Bernoulli numbers/, /^Translation of Menabrea's memoir/],
};

const EDSGER_ACTIVITY = [
  /^Go To Statement Considered Harmful/,
  /^A note on two problems in connexion with graphs/,
  /^THE multiprogramming system/,
];

const BACKUS_ACTIVITY = [/^The FORTRAN automatic coding system/, /^Can programming be liberated/];

const ANNOUNCEMENT_TITLE = "Compilers Lab: the spring release";

type ConsoleLine = { type: string; text: string };

/** What React and Next print when the client's first render is not the server's. */
const HYDRATION = /hydrat|did(?:n't| not) match|does not match|recoverable|switched to client rendering/i;

/** Every console message and uncaught error of the page; install before navigation. */
function collectConsole(page: Page): ConsoleLine[] {
  const lines: ConsoleLine[] = [];
  page.on("console", (msg) => lines.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => lines.push({ type: "pageerror", text: err.message }));
  return lines;
}

const hydrationLines = (lines: ConsoleLine[]) => lines.filter((line) => HYDRATION.test(line.text));

/**
 * The inputs exist before React hydrates them, and typing into them then is
 * lost. React tags hydrated DOM nodes with `__reactProps$…`: wait until the
 * last block's input carries it.
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="ssr-form-draft-title"]');
    return !!input && Object.keys(input).some((k) => k.startsWith("__reactProps"));
  });
}

async function openForm(page: Page) {
  await page.goto(ROUTE);
  await waitForHydration(page);
}

const counter = (page: Page, name: "profile" | "activity" | "errors" | "announcement") =>
  page.getByTestId(name === "errors" ? "ssr-form-errors-count" : `ssr-form-${name}-requests`);

async function expectCounters(page: Page, expected: { profile: number; activity: number; errors: number; announcement: number }) {
  for (const [name, value] of Object.entries(expected)) {
    await expect(counter(page, name as keyof typeof expected), name).toHaveText(String(value));
  }
}

/** The opening tag of the element with this test id, from server HTML. */
function tagOf(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[a-z]+ [^>]*data-testid="${testId}"[^>]*>`));
  expect(match, `an element with data-testid="${testId}" in the server HTML`).not.toBeNull();
  return match![0];
}

const draftStored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);

test("server HTML: translated labels, the server's values in the controls, nothing requested", async ({ request }) => {
  const response = await request.get(ROUTE);
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Labels computed by the store are translated on the server: the provider's translator is in the constructor.
  for (const label of ["Full name", "Email", "Role", "Bio", "User", "Title", "Text"]) {
    expect(html).toContain(`mb-1">${label}</span>`);
  }
  expect(html).not.toMatch(/ssr\.form\.[\w.]+/);

  // 1. The profile is markup: input values, the selected option, the textarea's text.
  expect(tagOf(html, "ssr-form-name")).toContain(`value="${ADA.name}"`);
  expect(tagOf(html, "ssr-form-email")).toContain(`value="${ADA.email}"`);
  expect(html).toMatch(/data-testid="ssr-form-role"[^>]*><option value="researcher" selected="">Researcher<\/option>/);
  expect(html).toMatch(new RegExp(`data-testid="ssr-form-bio"[^>]*>${ADA.bio}</textarea>`));
  // It starts resolved, clean, and its reset button is disabled.
  expect(html).toMatch(/data-testid="ssr-form-profile-loading"[^>]*>false</);
  expect(html).toMatch(/data-testid="ssr-form-profile-dirty"[^>]*>false</);
  expect(tagOf(html, "ssr-form-reset")).toContain('disabled=""');

  // 2. The selector shows the server's user; the list's rows are there and it is resolved.
  expect(html).toMatch(/data-testid="ssr-form-user"[^>]*><option value="usr-1" selected="">Ada Lovelace<\/option>/);
  expect(html).toContain('<span class="font-medium text-zinc-900 dark:text-zinc-100">Note G: Bernoulli numbers</span>');
  expect(html.match(/data-testid="ssr-form-activity"/g)).toHaveLength(2);
  expect(html).toMatch(/data-testid="ssr-form-activity-status"[^>]*>resolved</);

  // 3. No error yet; the switches are off.
  expect(html).toMatch(/data-testid="ssr-form-activity-error"[^>]*>null</);
  expect(tagOf(html, "ssr-form-fail-profile")).not.toContain("checked");
  expect(tagOf(html, "ssr-form-fail-activity")).not.toContain("checked");

  // 4. The draft block shows the server's announcement (the server never reads localStorage).
  expect(tagOf(html, "ssr-form-draft-title")).toContain(`value="${ANNOUNCEMENT_TITLE}"`);
  expect(html).toMatch(/data-testid="ssr-form-draft-dirty"[^>]*>false</);

  // Every counter is 0: a store in server mode calls nothing.
  for (const testId of ["profile-requests", "activity-requests", "errors-count", "announcement-requests"]) {
    expect(html).toMatch(new RegExp(`data-testid="ssr-form-${testId}"[^>]*>0<`));
  }
});

test("hydration is clean, and no resolver is called after it", async ({ page, pageErrors }, testInfo) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openForm(page);

  await expect(page.getByTestId("ssr-form-name")).toHaveValue(ADA.name);
  await expect(page.getByTestId("ssr-form-role")).toHaveValue(ADA.role);
  await expect(page.getByTestId("ssr-form-user")).toHaveValue("usr-1");
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(ADA.activity);
  await expect(page.getByTestId("ssr-form-profile-loading")).toHaveText("false");
  await expect(page.getByTestId("ssr-form-profile-dirty")).toHaveText("false");
  await expect(page.getByTestId("ssr-form-activity-status")).toHaveText("resolved");
  await expect(page.getByTestId("ssr-form-draft-dirty")).toHaveText("false");

  // Give a late request time to show up, then check that there was none.
  await page.waitForTimeout(800);
  await expectCounters(page, { profile: 0, activity: 0, errors: 0, announcement: 0 });

  await testInfo.attach("console", {
    body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
    contentType: "text/plain",
  });
  expect(hydrationLines(consoleLines), "hydration messages in the console").toEqual([]);
});

test("1. editing makes the profile dirty; reset() returns to the server's values without a request", async ({ page, pageErrors }) => {
  void pageErrors;
  await openForm(page);
  const dirty = page.getByTestId("ssr-form-profile-dirty");
  const reset = page.getByTestId("ssr-form-reset");
  await expect(reset).toBeDisabled();

  await page.getByTestId("ssr-form-name").fill("Augusta Ada King");
  await page.getByTestId("ssr-form-role").selectOption("lead");
  await page.getByTestId("ssr-form-bio").fill("Countess of Lovelace.");
  await expect(dirty).toHaveText("true");
  await expect(reset).toBeEnabled();

  // Fields set back to their baseline are clean again; the group stays dirty while the name differs.
  await page.getByTestId("ssr-form-role").selectOption("researcher");
  await page.getByTestId("ssr-form-bio").fill(ADA.bio);
  await expect(dirty).toHaveText("true");

  await reset.click();
  await expect(page.getByTestId("ssr-form-name")).toHaveValue(ADA.name);
  await expect(page.getByTestId("ssr-form-email")).toHaveValue(ADA.email);
  await expect(page.getByTestId("ssr-form-role")).toHaveValue(ADA.role);
  await expect(page.getByTestId("ssr-form-bio")).toHaveValue(ADA.bio);
  await expect(dirty).toHaveText("false");
  await expect(reset).toBeDisabled();

  // Editing and resetting is local: the resolver was never asked.
  await page.waitForTimeout(600);
  await expectCounters(page, { profile: 0, activity: 0, errors: 0, announcement: 0 });
});

test("2. another user runs each resolver once; reload() runs the list's resolver once", async ({ page, pageErrors }) => {
  void pageErrors;
  await openForm(page);
  await expectCounters(page, { profile: 0, activity: 0, errors: 0, announcement: 0 });

  // `userId` is in both resolves' deps: one change, one request each.
  await page.getByTestId("ssr-form-user").selectOption("usr-2");
  await expect(page.getByTestId("ssr-form-name")).toHaveValue("Edsger Dijkstra");
  await expect(page.getByTestId("ssr-form-email")).toHaveValue("edsger@compilers-lab.test");
  await expect(page.getByTestId("ssr-form-role")).toHaveValue("lead");
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(EDSGER_ACTIVITY);
  await expect(page.getByTestId("ssr-form-profile-loading")).toHaveText("false");
  await expect(page.getByTestId("ssr-form-activity-status")).toHaveText("resolved");
  await expectCounters(page, { profile: 1, activity: 1, errors: 0, announcement: 0 });

  // A run's result is the new baseline: the profile is clean, and reset() returns to this user.
  await expect(page.getByTestId("ssr-form-profile-dirty")).toHaveText("false");
  await page.getByTestId("ssr-form-name").fill("E. W. Dijkstra");
  await expect(page.getByTestId("ssr-form-profile-dirty")).toHaveText("true");
  await page.getByTestId("ssr-form-reset").click();
  await expect(page.getByTestId("ssr-form-name")).toHaveValue("Edsger Dijkstra");
  await expect(page.getByTestId("ssr-form-profile-dirty")).toHaveText("false");

  // No second request trails behind.
  await page.waitForTimeout(800);
  await expectCounters(page, { profile: 1, activity: 1, errors: 0, announcement: 0 });

  // reload(): one more run of the list's resolver; the profile is not touched.
  await page.getByTestId("ssr-form-reload").click();
  await expect(counter(page, "activity")).toHaveText("2");
  await expect(page.getByTestId("ssr-form-activity-status")).toHaveText("resolved");
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(EDSGER_ACTIVITY);
  await page.waitForTimeout(800);
  await expectCounters(page, { profile: 1, activity: 2, errors: 0, announcement: 0 });
});

test("3. a failed run reaches the provider's notifier, and the data stays", async ({ page, pageErrors }) => {
  void pageErrors;
  await openForm(page);
  const toast = page.getByTestId("ssr-toast");
  const failActivity = page.getByTestId("ssr-form-fail-activity");
  const failProfile = page.getByTestId("ssr-form-fail-profile");
  const status = page.getByTestId("ssr-form-activity-status");
  const error = page.getByTestId("ssr-form-activity-error");

  // The list: reload with the next request armed to fail.
  await failActivity.check();
  await page.getByTestId("ssr-form-reload").click();
  await expect(toast).toHaveText(/Could not load the activity: 503 Service Unavailable \(simulated\)/);
  await expect(status).toHaveText("error");
  await expect(error).toHaveText("503 Service Unavailable (simulated)");
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(ADA.activity); // the rows stay
  await expect(failActivity).not.toBeChecked(); // the switch fires once
  await expectCounters(page, { profile: 0, activity: 1, errors: 1, announcement: 0 });

  // reload() is the retry: resolved again, the error is cleared.
  await page.getByTestId("ssr-form-reload").click();
  await expect(status).toHaveText("resolved");
  await expect(error).toHaveText("null");
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(ADA.activity);
  await expectCounters(page, { profile: 0, activity: 2, errors: 1, announcement: 0 });

  // The group: another user, with the profile's next request armed to fail.
  await failProfile.check();
  await page.getByTestId("ssr-form-user").selectOption("usr-3");
  await expect(toast.filter({ hasText: "Could not load the profile" })).toHaveText(
    /Could not load the profile: 503 Service Unavailable \(simulated\)/,
  );
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(BACKUS_ACTIVITY); // the list's run succeeded
  await expectCounters(page, { profile: 1, activity: 3, errors: 2, announcement: 0 });
  // A failed run changes no value: the group keeps the previous user's values and baseline.
  await expect(page.getByTestId("ssr-form-profile-loading")).toHaveText("false");
  await expect(page.getByTestId("ssr-form-name")).toHaveValue(ADA.name);
  await expect(page.getByTestId("ssr-form-email")).toHaveValue(ADA.email);
  await expect(page.getByTestId("ssr-form-profile-dirty")).toHaveText("false");
  await expect(failProfile).not.toBeChecked();

  // The failed run read `userId`, so its next change restarts the group as usual.
  await page.getByTestId("ssr-form-user").selectOption("usr-2");
  await expect(page.getByTestId("ssr-form-name")).toHaveValue("Edsger Dijkstra");
  await expect(page.getByTestId("ssr-form-activity")).toHaveText(EDSGER_ACTIVITY);
  await page.waitForTimeout(800);
  await expectCounters(page, { profile: 2, activity: 4, errors: 2, announcement: 0 });
});

test("4. a localStorage draft is laid over the server's data after mount; hydration stays clean", async ({ page, pageErrors }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await openForm(page);
  const title = page.getByTestId("ssr-form-draft-title");
  const dirty = page.getByTestId("ssr-form-draft-dirty");
  const discard = page.getByTestId("ssr-form-draft-discard");
  expect(await draftStored(page)).toBeNull();

  // Edit: the draft is saved 300 ms after the last change.
  await title.fill("Draft: the spring release slips a week");
  await expect(dirty).toHaveText("true");
  await expect.poll(() => draftStored(page)).toContain("Draft: the spring release slips a week");

  // Reload: the server's HTML (the document this navigation received) has the server's title …
  const response = await page.reload();
  const html = await response!.text();
  expect(tagOf(html, "ssr-form-draft-title")).toContain(`value="${ANNOUNCEMENT_TITLE}"`);
  expect(html).not.toContain("Draft: the spring release slips a week");
  expect(html).toMatch(/data-testid="ssr-form-draft-dirty"[^>]*>false</);
  // … and after mount the page shows the draft, dirty against the server's data.
  await waitForHydration(page);
  await expect(title).toHaveValue("Draft: the spring release slips a week");
  await expect(page.getByTestId("ssr-form-draft-body")).toHaveText(/^The new register allocator ships on Monday/);
  await expect(dirty).toHaveText("true");
  await expect(discard).toBeEnabled();
  // The draft starts no resolver, here or in the other store.
  await page.waitForTimeout(600);
  await expectCounters(page, { profile: 0, activity: 0, errors: 0, announcement: 0 });
  expect(hydrationLines(consoleLines), "hydration messages in the console").toEqual([]);

  // Discard: back to the server's values, and nothing is written back to the storage.
  await discard.click();
  await expect(title).toHaveValue(ANNOUNCEMENT_TITLE);
  await expect(dirty).toHaveText("false");
  await expect(discard).toBeDisabled();
  await expect.poll(() => draftStored(page)).toBeNull();
  await page.waitForTimeout(600); // past the debounce of the save reset() scheduled
  expect(await draftStored(page)).toBeNull();

  await page.reload();
  await waitForHydration(page);
  await page.waitForTimeout(300);
  await expect(title).toHaveValue(ANNOUNCEMENT_TITLE);
  await expect(dirty).toHaveText("false");
  expect(hydrationLines(consoleLines), "hydration messages in the console").toEqual([]);
});

test("an error toast is in the page's language: onError builds it with the store's translator", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);
  await openForm(page);
  // The provider's translator has switched to Russian after mount; onError's `t` follows it.
  await expect(page.getByTestId("ssr-form-profile").getByText("Полное имя")).toBeVisible();
  const toast = page.getByTestId("ssr-toast");

  // A list's onError.
  await page.getByTestId("ssr-form-fail-activity").check();
  await page.getByTestId("ssr-form-reload").click();
  await expect(toast).toHaveText(/Не удалось загрузить активность: 503 Service Unavailable \(simulated\)/);

  // A group's onError.
  await page.getByTestId("ssr-form-fail-profile").check();
  await page.getByTestId("ssr-form-user").selectOption("usr-3");
  await expect(toast.filter({ hasText: "профиль" })).toHaveText(
    /Не удалось загрузить профиль: 503 Service Unavailable \(simulated\)/,
  );
  await expectCounters(page, { profile: 1, activity: 2, errors: 2, announcement: 0 });
});

test("the store's labels follow the locale after hydration, without a request", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server renders the default locale (static export); the provider's translator changes after mount.
  await openForm(page);
  await expect(page.getByTestId("ssr-form-profile").getByText("Полное имя")).toBeVisible();
  await expect(page.getByTestId("ssr-form-deps").getByText("Пользователь", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ssr-form-draft").getByText("Заголовок", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ssr-form-name")).toHaveValue(ADA.name);

  // A new translator re-labels; it is not a reason to load anything again.
  await page.waitForTimeout(600);
  await expectCounters(page, { profile: 0, activity: 0, errors: 0, announcement: 0 });
  expect(hydrationLines(consoleLines), "hydration messages in the console").toEqual([]);
});
