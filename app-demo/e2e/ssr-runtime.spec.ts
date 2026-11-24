import { test, expect, type Page } from "./fixtures";

// Route /ssr/runtime: when a store starts its resolvers, where it lives and
// how the provider's context reaches it. Four blocks, each with its own store:
//   1. runtime-held      — `server: true` in the browser too: a read lazy list
//                          and an eager list are held until store.start();
//   2. runtime-client    — the same lists, default `server`: usePalistor starts
//                          the eager one after the first commit, the lazy one
//                          waits for a read;
//   3. runtime-instances — one card component twice, a store per instance,
//                          each with its own initialData;
//   4. runtime-context   — a nested <PalistorProvider context={{ region }}>:
//                          a resolve waiting for its contextDeps, then one run
//                          per region change.
// Every resolver counts its calls (shared/events.ts); the counters read 0 in
// the server's HTML and in the hydrating render.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/ssr is built on the Cube implementation only");

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
 * The page is server-rendered: its buttons exist before React hydrates them.
 * React tags hydrated DOM nodes with `__reactProps$…`; wait until the
 * store.start() button and the last block's region button carry it.
 */
async function openRuntime(page: Page) {
  await page.goto("./ssr/runtime/");
  await page.waitForFunction(() =>
    ['[data-testid="runtime-held-start"]', '[data-testid="runtime-region-ap-south"]'].every((selector) => {
      const node = document.querySelector(selector);
      return !!node && Object.keys(node).some((k) => k.startsWith("__reactProps"));
    }),
  );
}

const byId = (page: Page, testId: string) => page.getByTestId(testId);

/** The value a store-computed counter or chip shows in the server's HTML. */
const shown = (testId: string, value: string) => new RegExp(`data-testid="${testId}"[^>]*>${value}<`);

/** Time for a request that should not happen to show up (the slowest fake endpoint answers in 1.5 s). */
const QUIET_MS = 800;

test("server HTML: the held states, the server's data, translations and counters at 0", async ({ request }) => {
  const response = await request.get("./ssr/runtime/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Texts come from next-intl, labels computed by the stores through the provider's translator.
  expect(html).toContain("1 · Server mode: nothing starts until store.start()");
  expect(html).toContain("4 · The provider&#x27;s context, live");
  expect(html).toMatch(/<span[^>]*>Name<\/span>/); // a store label: `label: (t) => t("ssr.runtime.instances.name")`
  expect(html).not.toMatch(/ssr\.runtime\.[\w.]+/);

  // 1. Server mode: both lists read loading: true while resolveStatus is "idle"; no rows.
  for (const list of ["releases", "builds"]) {
    expect(html).toMatch(shown(`runtime-held-${list}-loading`, "true"));
    expect(html).toMatch(shown(`runtime-held-${list}-status`, "idle"));
    expect(html).toMatch(shown(`runtime-held-${list}-requests`, "0"));
  }
  expect(html).not.toContain('data-testid="runtime-held-release"');
  expect(html).not.toContain('data-testid="runtime-held-build"');
  expect(html).toMatch(shown("runtime-held-starts", "0"));

  // 2. The eager list's loading state is the skeleton; the lazy list is not read.
  expect(html).toMatch(shown("runtime-client-builds-loading", "true"));
  expect(html).toContain('data-testid="runtime-client-builds-skeleton"');
  expect(html).toContain('data-testid="runtime-client-releases-unread"');
  expect(html).not.toContain('data-testid="runtime-client-releases-skeleton"');
  expect(html).toMatch(shown("runtime-client-builds-requests", "0"));
  expect(html).toMatch(shown("runtime-client-releases-requests", "0"));

  // 3. Each card's server data is markup; its resolver was not called.
  expect(html).toMatch(/data-testid="runtime-teammate-tm-1-name"[^>]*value="John Backus"|value="John Backus"[^>]*data-testid="runtime-teammate-tm-1-name"/);
  expect(html).toMatch(/data-testid="runtime-teammate-tm-2-name"[^>]*value="Niklaus Wirth"|value="Niklaus Wirth"[^>]*data-testid="runtime-teammate-tm-2-name"/);
  expect(html).toContain('value="FORTRAN compiler"');
  expect(html).toMatch(shown("runtime-teammate-tm-1-dirty", "As the server sent it"));
  expect(html).toMatch(shown("runtime-teammate-tm-1-requests", "0"));
  expect(html).toMatch(shown("runtime-teammate-tm-2-requests", "0"));

  // 4. The merged context (outer workspace + inner region, still null); the
  //    resolve waiting for its contextDeps reads loading: false, no skeleton.
  expect(html).toMatch(shown("runtime-context-workspace", "compilers-lab"));
  expect(html).toMatch(shown("runtime-context-region", "null"));
  expect(html).toMatch(shown("runtime-mirror-loading", "false"));
  expect(html).toContain('data-testid="runtime-mirror-waiting"');
  expect(html).not.toContain('data-testid="runtime-mirror-skeleton"');
  expect(html).toMatch(shown("runtime-mirror-requests", "0"));
});

test("hydration is clean; after it only the eager list of the default store has run", async ({ page, pageErrors }, testInfo) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openRuntime(page);

  // 2. The hook started the store after the commit, and with it the eager list: one call, the skeleton gives way to the rows.
  await expect(byId(page, "runtime-client-builds-requests")).toHaveText("1");
  await expect(byId(page, "runtime-client-build")).toHaveText([/#412/, /#411/, /#410/]);
  await expect(byId(page, "runtime-client-builds-skeleton")).toHaveCount(0);
  await expect(byId(page, "runtime-client-builds-loading")).toHaveText("false");

  // Nothing else may start by itself: give a late call time to show up.
  await page.waitForTimeout(QUIET_MS);

  // 1. The held store is in the state the server rendered.
  for (const list of ["releases", "builds"]) {
    await expect(byId(page, `runtime-held-${list}-loading`)).toHaveText("true");
    await expect(byId(page, `runtime-held-${list}-status`)).toHaveText("idle");
    await expect(byId(page, `runtime-held-${list}-requests`)).toHaveText("0");
  }

  // 2. The lazy list has not been read, so it has not been requested.
  await expect(byId(page, "runtime-client-releases-unread")).toBeVisible();
  await expect(byId(page, "runtime-client-releases-requests")).toHaveText("0");
  await expect(byId(page, "runtime-client-builds-requests")).toHaveText("1");

  // 3. The cards' resolvers were answered by initialData.
  await expect(byId(page, "runtime-teammate-tm-1-name")).toHaveValue("John Backus");
  await expect(byId(page, "runtime-teammate-tm-1-requests")).toHaveText("0");
  await expect(byId(page, "runtime-teammate-tm-2-requests")).toHaveText("0");

  // 4. The resolve waiting for `region` sent nothing and does not show loading.
  await expect(byId(page, "runtime-mirror-loading")).toHaveText("false");
  await expect(byId(page, "runtime-mirror-waiting")).toBeVisible();
  await expect(byId(page, "runtime-mirror-requests")).toHaveText("0");

  await testInfo.attach("console", {
    body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
    contentType: "text/plain",
  });
  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});

test("store.start() runs each held resolve once; calling it again starts nothing", async ({ page, pageErrors }) => {
  void pageErrors;
  await openRuntime(page);

  await byId(page, "runtime-held-start").click();
  await expect(byId(page, "runtime-held-starts")).toHaveText("1");
  await expect(byId(page, "runtime-held-release")).toHaveText([/v2\.4\.0/, /v2\.3\.1/]);
  await expect(byId(page, "runtime-held-build")).toHaveText([/#412/, /#411/, /#410/]);
  for (const list of ["releases", "builds"]) {
    await expect(byId(page, `runtime-held-${list}-loading`)).toHaveText("false");
    await expect(byId(page, `runtime-held-${list}-status`)).toHaveText("resolved");
    await expect(byId(page, `runtime-held-${list}-requests`)).toHaveText("1");
  }

  // Idempotent: the second call is counted by the button, not by any resolver.
  await byId(page, "runtime-held-start").click();
  await expect(byId(page, "runtime-held-starts")).toHaveText("2");
  await page.waitForTimeout(QUIET_MS);
  await expect(byId(page, "runtime-held-releases-requests")).toHaveText("1");
  await expect(byId(page, "runtime-held-builds-requests")).toHaveText("1");
  await expect(byId(page, "runtime-held-releases-status")).toHaveText("resolved");

  // The default store's lists were not touched by this store's start().
  await expect(byId(page, "runtime-client-builds-requests")).toHaveText("1");
  await expect(byId(page, "runtime-client-releases-requests")).toHaveText("0");
});

test("the lazy list of the default store loads on its first read, once", async ({ page, pageErrors }) => {
  void pageErrors;
  await openRuntime(page);
  await expect(byId(page, "runtime-client-build")).toHaveCount(3);
  await page.waitForTimeout(QUIET_MS);
  await expect(byId(page, "runtime-client-releases-requests")).toHaveText("0");

  await byId(page, "runtime-client-read").click();
  await expect(byId(page, "runtime-client-releases-skeleton")).toBeVisible(); // loading: true from the read on
  await expect(byId(page, "runtime-client-release")).toHaveText([/v2\.4\.0/, /v2\.3\.1/]);
  await expect(byId(page, "runtime-client-releases-requests")).toHaveText("1");

  await page.waitForTimeout(QUIET_MS);
  await expect(byId(page, "runtime-client-releases-requests")).toHaveText("1");
  await expect(byId(page, "runtime-client-builds-requests")).toHaveText("1");
});

test("each card has its own store: editing one leaves the other alone, Reset returns to the server's data", async ({ page, pageErrors }) => {
  void pageErrors;
  await openRuntime(page);
  const first = (field: string) => byId(page, `runtime-teammate-tm-1-${field}`);
  const second = (field: string) => byId(page, `runtime-teammate-tm-2-${field}`);

  await first("name").fill("John W. Backus");
  await first("role").fill("FORTRAN, BNF");
  await expect(first("name")).toHaveValue("John W. Backus");
  await expect(first("dirty")).toHaveText("Edited");

  await expect(second("name")).toHaveValue("Niklaus Wirth");
  await expect(second("role")).toHaveValue("Pascal and Oberon");
  await expect(second("dirty")).toHaveText("As the server sent it");

  // The other card edits its own store just as well.
  await second("role").fill("Pascal, Modula-2, Oberon");
  await expect(second("dirty")).toHaveText("Edited");
  await expect(first("role")).toHaveValue("FORTRAN, BNF");

  // initialData is the baseline of each store.
  await first("reset").click();
  await expect(first("name")).toHaveValue("John Backus");
  await expect(first("role")).toHaveValue("FORTRAN compiler");
  await expect(first("dirty")).toHaveText("As the server sent it");
  await expect(second("role")).toHaveValue("Pascal, Modula-2, Oberon");

  // Neither resolver was ever called.
  await expect(first("requests")).toHaveText("0");
  await expect(second("requests")).toHaveText("0");
});

test("the provider's context: the resolve waits for region, runs once per region, and not for the same region", async ({ page, pageErrors }) => {
  void pageErrors;
  await openRuntime(page);
  await page.waitForTimeout(QUIET_MS);
  await expect(byId(page, "runtime-mirror-requests")).toHaveText("0");
  await expect(byId(page, "runtime-context-region")).toHaveText("null");

  // A region: the inner provider's context changes, the waiting resolve starts.
  await byId(page, "runtime-region-eu-west").click();
  await expect(byId(page, "runtime-context-region")).toHaveText("eu-west");
  await expect(byId(page, "runtime-context-workspace")).toHaveText("compilers-lab");
  await expect(byId(page, "runtime-mirror-skeleton")).toBeVisible();
  await expect(byId(page, "runtime-mirror-host")).toHaveText("eu-west.mirror.compilers-lab.dev");
  await expect(byId(page, "runtime-mirror-requests")).toHaveText("1");

  // The same region again: a new context object with the same value is no change.
  await byId(page, "runtime-region-eu-west").click();
  await expect(byId(page, "runtime-region-picks")).toHaveText("2");
  await page.waitForTimeout(QUIET_MS);
  await expect(byId(page, "runtime-mirror-requests")).toHaveText("1");
  await expect(byId(page, "runtime-mirror-loading")).toHaveText("false");

  // Another region: one more run, with the new key.
  await byId(page, "runtime-region-us-east").click();
  await expect(byId(page, "runtime-mirror-host")).toHaveText("us-east.mirror.compilers-lab.dev");
  await expect(byId(page, "runtime-mirror-requests")).toHaveText("2");
  await page.waitForTimeout(QUIET_MS);
  await expect(byId(page, "runtime-mirror-requests")).toHaveText("2");
  await expect(byId(page, "runtime-region-picks")).toHaveText("3");
});
