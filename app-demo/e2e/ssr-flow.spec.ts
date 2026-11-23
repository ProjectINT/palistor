import { test, expect, type Page } from "./fixtures";

// Route /ssr/flow: two step flows (defineFlow) in one usePalistor store.
//   (1) onboarding — the first step (profile) has a resolve and gets its result
//       from the Server Component as initialData; the second step (team) has a
//       resolve and no server data.
//   (2) booking    — the first step (slot) has a resolve and no server data.
// Each step with a resolve shows how many times its onEnter, its onReady and
// its resolver's fake endpoint ran in this tab.
//
// Evidence for the lifecycle: cube/ssr/initialDataFlow.test.ts,
// cube/ssr/serverMode.test.tsx, cube/contract/sliceI/flowNavigation.test.ts.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/ssr is built on the Cube implementation only");

const PROFILE = { name: "Ada Lovelace", email: "ada@compilers-lab.dev" };

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

/**
 * The page is server-rendered: its inputs exist before React hydrates them.
 * React tags hydrated DOM nodes with `__reactProps$…`; wait until the profile
 * step's name input carries it.
 */
async function openFlow(page: Page) {
  await page.goto("./ssr/flow/");
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="flow-profile-name"]');
    return !!input && Object.keys(input).some((k) => k.startsWith("__reactProps"));
  });
}

type Step = "profile" | "team" | "slot";

/** The counters of one step: onEnter, onReady, resolver calls. */
async function expectCounts(page: Page, step: Step, counts: { enter: number; ready: number; requests: number }) {
  await expect(page.getByTestId(`flow-${step}-enter`)).toHaveText(String(counts.enter));
  await expect(page.getByTestId(`flow-${step}-ready`)).toHaveText(String(counts.ready));
  await expect(page.getByTestId(`flow-${step}-requests`)).toHaveText(String(counts.requests));
}

/** The booking flow's first step has loaded in the browser: from here on nothing is in flight. */
async function settled(page: Page) {
  await expect(page.getByTestId("flow-slot-reviewer")).toHaveText("Barbara Liskov");
  await expectCounts(page, "slot", { enter: 1, ready: 1, requests: 1 });
}

/** The step indicator's `data-status` per step, in order ("pending" = status null, not visited yet). */
async function expectStatuses(page: Page, flow: "onboarding" | "booking", statuses: string[]) {
  const items = page.getByTestId(`flow-${flow}-steps`).locator("li");
  await expect(items).toHaveCount(statuses.length);
  for (const [i, status] of statuses.entries()) await expect(items.nth(i)).toHaveAttribute("data-status", status);
}

test("server HTML: the first step's server data, the held step's skeleton, no step entered", async ({ request }) => {
  const response = await request.get("./ssr/flow/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Labels computed by the store are translated on the server (the provider's translator in the constructor).
  expect(html).toContain("Full name");
  expect(html).toContain("Work email");
  expect(html).toContain("A flow whose first step has server data");
  expect(html).not.toMatch(/ssr\.flow\.\w+/);

  // (1) The profile step's initialData is markup: the inputs carry the values.
  // Its resolve counts as answered, so the flow is not loading.
  expect(html).toMatch(/data-testid="flow-onboarding-step" data-step="profile" data-loading="false"/);
  expect(html).toMatch(new RegExp(`data-testid="flow-profile-name"[^>]*value="${PROFILE.name}"`));
  expect(html).toMatch(new RegExp(`data-testid="flow-profile-email"[^>]*value="${PROFILE.email}"`));
  expect(html).toMatch(/<li data-step="profile" data-status="active"/);
  expect(html).toMatch(/<li data-step="team" data-status="pending"/);
  expect(html).not.toContain('data-testid="flow-team-skeleton"');
  expect(html).not.toContain('data-testid="flow-team-mentor"');

  // (2) Server mode holds the active step's resolve: `loading` is true, the HTML has its skeleton.
  expect(html).toMatch(/data-testid="flow-booking-step" data-step="slot" data-loading="true"/);
  expect(html).toContain('data-testid="flow-slot-skeleton"');
  expect(html).toContain("Looking for a free review slot…");
  expect(html).not.toContain('data-testid="flow-slot-content"');
  expect(html).toMatch(/data-testid="flow-booking-next" disabled=""/);

  // Nothing has run for this page yet: every counter reads 0.
  for (const step of ["profile", "team", "slot"]) {
    for (const counter of ["enter", "ready", "requests"]) {
      expect(html).toMatch(new RegExp(`data-testid="flow-${step}-${counter}"[^>]*>0<`));
    }
  }
});

test("hydration is clean; each flow's first step is entered once, the step with server data without a request", async ({
  page,
  pageErrors,
}, testInfo) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openFlow(page);

  // (1) The server's values; onEnter, then onReady right away; the resolver is not called.
  await expect(page.getByTestId("flow-profile-name")).toHaveValue(PROFILE.name);
  await expect(page.getByTestId("flow-profile-email")).toHaveValue(PROFILE.email);
  await expectCounts(page, "profile", { enter: 1, ready: 1, requests: 0 });
  await expectCounts(page, "team", { enter: 0, ready: 0, requests: 0 }); // not entered yet

  // (2) The browser enters the held step: onEnter and one request, onReady when it lands.
  await expect(page.getByTestId("flow-slot-starts-at")).toHaveText("Thursday, 14:00");
  await expect(page.getByTestId("flow-slot-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("flow-booking-step")).toHaveAttribute("data-loading", "false");
  await settled(page);

  // Give a late entry or request time to show up, then check that there was none.
  await page.waitForTimeout(600);
  await expectCounts(page, "profile", { enter: 1, ready: 1, requests: 0 });
  await expectCounts(page, "team", { enter: 0, ready: 0, requests: 0 });
  await expectCounts(page, "slot", { enter: 1, ready: 1, requests: 1 });

  await testInfo.attach("console", {
    body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
    contentType: "text/plain",
  });
  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});

test("the next step loads once on entry; Back and Next again find its result cached", async ({ page, pageErrors }) => {
  void pageErrors;
  await openFlow(page);
  await settled(page);

  // Entering the team step runs its resolver: the skeleton, then the data.
  await page.getByTestId("flow-onboarding-next").click();
  await expect(page.getByTestId("flow-onboarding-step")).toHaveAttribute("data-step", "team");
  await expect(page.getByTestId("flow-team-skeleton")).toBeVisible();
  await expect(page.getByTestId("flow-team-mentor")).toHaveValue("Frances Allen");
  // The resolver saw the provider's context (shared/SsrProviders.tsx).
  await expect(page.getByTestId("flow-team-channel")).toHaveValue("#compilers-lab");
  await expect(page.getByTestId("flow-team-skeleton")).toHaveCount(0);
  await expectCounts(page, "team", { enter: 1, ready: 1, requests: 1 });
  await expectStatuses(page, "onboarding", ["completed", "active"]);
  await expect(page.getByTestId("flow-onboarding-history")).toHaveText("profile → team");
  await expect(page.getByTestId("flow-onboarding-next")).toHaveCount(0); // the last step

  // A choice on the step is a value: it survives navigation.
  await page.getByTestId("flow-team-mentor").selectOption("Grace Hopper");

  // Back: the profile step again — onEnter fires, onReady does not, nothing is requested.
  await page.getByTestId("flow-onboarding-back").click();
  await expect(page.getByTestId("flow-onboarding-step")).toHaveAttribute("data-step", "profile");
  await expect(page.getByTestId("flow-profile-name")).toHaveValue(PROFILE.name);
  await expectCounts(page, "profile", { enter: 2, ready: 1, requests: 0 });
  await expectStatuses(page, "onboarding", ["active", "completed"]);
  await expect(page.getByTestId("flow-onboarding-back")).toBeDisabled();

  // Next again: the team step is resolved — no skeleton, no second request, no second onReady.
  await page.getByTestId("flow-onboarding-next").click();
  await expect(page.getByTestId("flow-onboarding-step")).toHaveAttribute("data-step", "team");
  await expect(page.getByTestId("flow-team-mentor")).toHaveValue("Grace Hopper");
  await expect(page.getByTestId("flow-team-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("flow-onboarding-step")).toHaveAttribute("data-loading", "false");
  await page.waitForTimeout(800); // longer than the team endpoint's delay: a request would have landed
  await expectCounts(page, "team", { enter: 2, ready: 1, requests: 1 });
  await expectCounts(page, "profile", { enter: 2, ready: 1, requests: 0 });

  // The other flow was not touched.
  await expectCounts(page, "slot", { enter: 1, ready: 1, requests: 1 });
});

test("an invalid step blocks Next: errors show and the next step is not entered", async ({ page, pageErrors }) => {
  void pageErrors;
  await openFlow(page);

  // No errors before a submit, even when a field becomes invalid.
  const name = page.getByTestId("flow-profile-name");
  await name.fill("");
  await page.getByTestId("flow-profile-email").fill("ada");
  await expect(page.getByTestId("flow-profile-name-error")).toHaveCount(0);

  // Next submits the step: validation fails, the errors appear, the flow stays.
  await page.getByTestId("flow-onboarding-next").click();
  await expect(page.getByTestId("flow-profile-name-error")).toHaveText("Enter at least 2 characters");
  await expect(page.getByTestId("flow-profile-email-error")).toHaveText("Enter a valid email");
  await expect(page.getByTestId("flow-onboarding-step")).toHaveAttribute("data-step", "profile");
  await expectCounts(page, "team", { enter: 0, ready: 0, requests: 0 });

  // After a failed submit the errors follow the input live.
  await name.fill("Alan Turing");
  await expect(page.getByTestId("flow-profile-name-error")).toHaveCount(0);
  await page.getByTestId("flow-profile-email").fill("alan@compilers-lab.dev");
  await expect(page.getByTestId("flow-profile-email-error")).toHaveCount(0);

  // Valid now: Next enters the team step, whose resolver runs once.
  await page.getByTestId("flow-onboarding-next").click();
  await expect(page.getByTestId("flow-team-mentor")).toHaveValue("Frances Allen");
  await expectCounts(page, "team", { enter: 1, ready: 1, requests: 1 });
  await expectCounts(page, "profile", { enter: 1, ready: 1, requests: 0 });
});

test("the flow without server data: navigation after its client load requests nothing more", async ({
  page,
  pageErrors,
}) => {
  void pageErrors;
  await openFlow(page);
  await settled(page);

  await page.getByTestId("flow-booking-next").click();
  await expect(page.getByTestId("flow-booking-step")).toHaveAttribute("data-step", "notes");
  const topic = page.getByTestId("flow-notes-topic");
  await expect(topic).toHaveAttribute("placeholder", "For example: the register allocator");
  await topic.fill("The register allocator");
  await expectStatuses(page, "booking", ["completed", "active"]);

  // Back to the slot: its result is cached — content at once, onEnter again, no request.
  await page.getByTestId("flow-booking-back").click();
  await expect(page.getByTestId("flow-booking-step")).toHaveAttribute("data-step", "slot");
  await expect(page.getByTestId("flow-slot-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("flow-slot-reviewer")).toHaveText("Barbara Liskov");
  await page.waitForTimeout(1000); // longer than the slot endpoint's delay
  await expectCounts(page, "slot", { enter: 2, ready: 1, requests: 1 });

  await page.getByTestId("flow-booking-next").click();
  await expect(topic).toHaveValue("The register allocator");
  await expect(page.getByTestId("flow-booking-history")).toHaveText("slot → notes");

  // The onboarding flow was not touched.
  await expectCounts(page, "profile", { enter: 1, ready: 1, requests: 0 });
  await expectCounts(page, "team", { enter: 0, ready: 0, requests: 0 });
});

test("the store's labels follow the locale after hydration; no step is entered again", async ({
  page,
  pageErrors,
  request,
  baseURL,
}) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server always renders the default locale (static export).
  const html = await (await request.get("./ssr/flow/", { headers: { cookie: "NEXT_LOCALE=ru" } })).text();
  expect(html).toContain("Full name");

  await openFlow(page);
  await expect(page.getByTestId("flow-onboarding")).toContainText("Полное имя");
  await expect(page.getByTestId("flow-onboarding")).toContainText("Рабочий email");
  await settled(page);
  await expect(page.getByTestId("flow-booking")).toContainText("Ревьюер");

  // A new translator re-labels; it neither re-enters a step nor requests anything.
  await expectCounts(page, "profile", { enter: 1, ready: 1, requests: 0 });
  await expectCounts(page, "slot", { enter: 1, ready: 1, requests: 1 });

  // Validation messages come from the translator too.
  await page.getByTestId("flow-profile-name").fill("");
  await page.getByTestId("flow-onboarding-next").click();
  await expect(page.getByTestId("flow-profile-name-error")).toHaveText("Введите не меньше 2 символов");

  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});
