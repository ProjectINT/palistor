import { test, expect, type Page } from "./fixtures";

// Route /ssr (experiments/SsrPlan.md, Stage 4): a Server Component reads the
// rows and a client view builds its store with usePalistor + initialData,
// under a <PalistorProvider> that gets next-intl's translator. Three blocks:
//   (a) engineers — a list with server data and a debounced server filter;
//   (b) projects  — a list without server data (skeleton, then a client load);
//   (c) summary   — a `suspense: true` group without server data (fallback).
// Each block shows how many times its resolver's fake endpoint was called.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/ssr is built on the Cube implementation only");

const ENGINEERS = [
  "Margaret Hamilton",
  "Grace Hopper",
  "Barbara Liskov",
  "Katherine Johnson",
  "Radia Perlman",
  "Frances Allen",
];

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
 * React tags hydrated DOM nodes with `__reactProps$…`; wait until the search
 * input carries it. (The shared waitForHydration looks for the demo header,
 * which this route does not render.)
 */
async function openSsr(page: Page) {
  await page.goto("./ssr/");
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="ssr-engineers-search"]');
    return !!input && Object.keys(input).some((k) => k.startsWith("__reactProps"));
  });
}

const requests = (page: Page, block: "engineers" | "projects" | "summary") =>
  page.getByTestId(`ssr-${block}-requests`);

/** Blocks (b) and (c) have loaded: from here on nothing is in flight. */
async function settled(page: Page) {
  await expect(page.getByTestId("ssr-project")).toHaveCount(3);
  await expect(page.getByTestId("ssr-summary-headcount")).toHaveText("6");
}

test("server HTML has the translations, the rows, the skeleton and the Suspense fallback", async ({ request }) => {
  const response = await request.get("./ssr/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Labels computed by the store (`label: (t) => t("ssr.…")`) are translated
  // on the server: the translator comes from the provider into the constructor.
  expect(html).toContain("Search engineers");
  expect(html).toContain('placeholder="A name or a focus, for example: compilers"');
  expect(html).not.toMatch(/ssr\.(engineers|projects|summary)\.\w+/);

  // (a) The rows are markup, not only props in the RSC payload; no request was made.
  for (const name of ENGINEERS) {
    expect(html).toMatch(new RegExp(`<li data-testid="ssr-engineer"[^>]*><span[^>]*>${name}</span>`));
  }
  expect(html).toMatch(/<span[^>]*>Focus<!-- -->: <!-- -->Flight software<\/span>/);
  expect(html).toMatch(/data-testid="ssr-engineers-requests"[^>]*>0</);

  // (b) `list.loading` is already true on the server: the skeleton, not an empty list.
  expect(html).toContain('data-testid="ssr-projects-skeleton"');
  expect(html).not.toContain('data-testid="ssr-projects-rows"');
  expect(html).not.toContain("Apollo Guidance Computer");

  // (c) The suspense group has no data on the server: the boundary's fallback.
  expect(html).toContain('data-testid="ssr-summary-fallback"');
  expect(html).toContain("Loading the summary…");
  expect(html).not.toContain('data-testid="ssr-summary-content"');

  // The provider's context is rendered too (usePalistorContext).
  expect(html).toMatch(/data-testid="ssr-workspace"[^>]*>compilers-lab</);
});

test("hydration is clean and the list with server data is not requested again", async ({ page, pageErrors }, testInfo) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openSsr(page);

  // (a) The server's rows, no request.
  await expect(page.getByTestId("ssr-engineer")).toHaveText(ENGINEERS.map((name) => new RegExp(`^${name}`)));
  await expect(requests(page, "engineers")).toHaveText("0");

  // (b) Loads in the browser, once.
  await expect(page.getByTestId("ssr-project")).toHaveText([
    /Apollo Guidance Computer/,
    /FLOW-MATIC/,
    /Spanning Tree Protocol/,
  ]);
  await expect(page.getByTestId("ssr-projects-skeleton")).toHaveCount(0);
  await expect(requests(page, "projects")).toHaveText("1");

  // (c) The content replaces the fallback; the resolver saw the provider's context.
  await expect(page.getByTestId("ssr-summary-workspace")).toHaveText("compilers-lab");
  await expect(page.getByTestId("ssr-summary-headcount")).toHaveText("6");
  await expect(page.getByTestId("ssr-summary-top-focus")).toHaveText("Compilers");
  await expect(page.getByTestId("ssr-summary-fallback")).toHaveCount(0);
  await expect(requests(page, "summary")).toHaveText("1");

  // Everything has settled; give a late request (the filter's debounce is
  // 300 ms) time to show up, then check that there was none.
  await page.waitForTimeout(600);
  await expect(requests(page, "engineers")).toHaveText("0");
  await expect(requests(page, "projects")).toHaveText("1");
  await expect(requests(page, "summary")).toHaveText("1");

  // Hydration messages fail the test; the rest of the console is attached for review.
  await testInfo.attach("console", {
    body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
    contentType: "text/plain",
  });
  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});

test("typing in the search sends exactly one request and the rows follow", async ({ page, pageErrors }) => {
  void pageErrors;
  await openSsr(page);
  await settled(page);
  await expect(requests(page, "engineers")).toHaveText("0");

  // Four keystrokes inside the debounce window: the input follows at once, one request goes out.
  const search = page.getByTestId("ssr-engineers-search");
  await search.pressSequentially("comp", { delay: 40 });
  await expect(search).toHaveValue("comp");
  await expect(page.getByTestId("ssr-engineer")).toHaveText([/^Grace Hopper/, /^Frances Allen/]);
  await expect(requests(page, "engineers")).toHaveText("1");
  await expect(page.getByTestId("ssr-engineers-busy")).toHaveCount(0);

  // No second request trails behind.
  await page.waitForTimeout(600);
  await expect(requests(page, "engineers")).toHaveText("1");

  // Clearing the field is one more change: one more request, all rows are back.
  await search.fill("");
  await expect(page.getByTestId("ssr-engineer")).toHaveCount(ENGINEERS.length);
  await expect(requests(page, "engineers")).toHaveText("2");

  // The other blocks were not touched.
  await expect(requests(page, "projects")).toHaveText("1");
  await expect(requests(page, "summary")).toHaveText("1");
});

test("the store's labels follow the locale after hydration, without a request", async ({ page, pageErrors, request, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server always renders the default locale (static export): the first
  // client render matches it, then the provider's translator changes.
  const html = await (await request.get("./ssr/", { headers: { cookie: "NEXT_LOCALE=ru" } })).text();
  expect(html).toContain("Search engineers");

  await openSsr(page);
  await expect(page.getByText("Поиск инженеров")).toBeVisible();
  await expect(page.getByTestId("ssr-engineer").first()).toHaveText(/Специализация: Flight software/);
  await settled(page);
  await expect(page.getByTestId("ssr-summary")).toContainText("Инженеров в базе");

  // A new translator re-labels; it is not a reason to load anything again.
  await expect(requests(page, "engineers")).toHaveText("0");
  await expect(requests(page, "projects")).toHaveText("1");
  await expect(requests(page, "summary")).toHaveText("1");
  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});

test("client navigation from the home page: the same page without a server render", async ({ page, openTab }) => {
  await openTab("form");
  await page.getByRole("link", { name: "SSR demo →" }).click();
  await expect(page).toHaveURL(/\/ssr\/$/);

  // No HTML came from the server this time: the store is built in the browser
  // from the same props, and the list with initialData still makes no request.
  await expect(page.getByTestId("ssr-engineer")).toHaveText(ENGINEERS.map((name) => new RegExp(`^${name}`)));
  await settled(page);
  await expect(requests(page, "engineers")).toHaveText("0");

  await page.getByRole("link", { name: "← Back to the demo" }).click();
  await expect(page.getByRole("heading", { name: "Palistor Demo", level: 1 })).toBeVisible();
});

// Open question (Cube, usePalistor): on a client navigation the store can be
// built twice, and each lazy resolver then runs twice (the counters read 2).
//
// Mechanism: the navigation mounts the page in a transition. A read during
// that render schedules the lazy resolve on a microtask (cube/core/resolve.ts,
// `touch`). If the render yields before it commits, the run starts, the store
// changes under React's useSyncExternalStore check (cube/react/useForm.ts) and
// React renders the page again from scratch. The uncommitted render's hook
// state is gone — the lazy ref in cube/react/usePalistor.ts too — so a second
// store is built and starts the same requests; the first store's are wasted.
//
// Observed (doubled / navigations), timing dependent:
//   client navigation, dev server,        4 browsers in parallel:  8 / 48
//   client navigation, production export, 6 browsers in parallel:  5 / 90
//   client navigation, either,            1 browser:               0 / 27
//   hydration (dev + production export),  6 browsers in parallel:  0 / 162
// The list with initialData makes no request in either case.
test.fixme("client navigation: each resolver runs once", async ({ page, openTab }) => {
  await openTab("form");
  await page.getByRole("link", { name: "SSR demo →" }).click();
  await settled(page);
  await expect(requests(page, "projects")).toHaveText("1");
  await expect(requests(page, "summary")).toHaveText("1");
});
