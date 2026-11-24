import { test, expect, type Page } from "./fixtures";

// The five /ssr routes reached by client navigation, through the nav of
// SsrShell. A navigation mounts the route in a transition: the store is built
// in a render React may repeat or throw away, and usePalistor starts it only
// after the commit. So every route must end in the state a direct open gives,
// with each resolver called once per visit. The other /ssr specs open their
// route directly (server HTML + hydration).
//
// The counters (shared/events.ts) live in the browser tab and survive a client
// navigation: a second visit builds a new store, which requests again, so the
// counts are per visit times the number of visits.
//
// The routes exist on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/ssr is built on the Cube implementation only");

type Route = "lists" | "form" | "catalog" | "flow" | "runtime";

const NAV: Record<Route, string> = {
  lists: "Lists & Suspense",
  form: "Prefilled form",
  catalog: "Pages & nested lists",
  flow: "Flow",
  runtime: "Server mode & provider",
};

const PATH: Record<Route, RegExp> = {
  lists: /\/ssr\/?$/,
  form: /\/ssr\/form\/?$/,
  catalog: /\/ssr\/catalog\/?$/,
  flow: /\/ssr\/flow\/?$/,
  runtime: /\/ssr\/runtime\/?$/,
};

const count = (page: Page, testId: string, value: number) => expect(page.getByTestId(testId)).toHaveText(String(value));

/** What each route shows once it has loaded, on its `visit`-th visit in this tab. */
const LOADED: Record<Route, (page: Page, visit: number) => Promise<void>> = {
  // A list with server data (no request), a lazy list and a suspense group without data (one each).
  lists: async (page, visit) => {
    await expect(page.getByTestId("ssr-project")).toHaveCount(3);
    await expect(page.getByTestId("ssr-summary-headcount")).toHaveText("6");
    await count(page, "ssr-engineers-requests", 0);
    await count(page, "ssr-projects-requests", visit);
    await count(page, "ssr-summary-requests", visit);
  },
  // Everything came as initialData: nothing is requested.
  form: async (page) => {
    await expect(page.getByTestId("ssr-form-name")).toHaveValue("Ada Lovelace");
    await count(page, "ssr-form-profile-requests", 0);
    await count(page, "ssr-form-activity-requests", 0);
    await count(page, "ssr-form-errors-count", 0);
    await count(page, "ssr-form-announcement-requests", 0);
  },
  // Two lists with a server page, one without: its first page is one request.
  catalog: async (page, visit) => {
    await expect(page.getByTestId("ssr-catalog-talk").first()).toBeVisible();
    await count(page, "ssr-catalog-papers-requests", 0);
    await count(page, "ssr-catalog-milestones-requests", 0);
    await count(page, "ssr-catalog-talks-requests", visit);
  },
  // The step with server data: onEnter and onReady, no request. The flow without data: one request.
  flow: async (page, visit) => {
    await count(page, "flow-slot-requests", visit);
    await count(page, "flow-slot-enter", visit);
    await count(page, "flow-slot-ready", visit);
    await count(page, "flow-profile-enter", visit);
    await count(page, "flow-profile-ready", visit);
    await count(page, "flow-profile-requests", 0);
    await count(page, "flow-team-enter", 0);
    await count(page, "flow-team-requests", 0);
  },
  // The eager list of the default store starts after the commit; the `server: true` store stays held.
  runtime: async (page, visit) => {
    await expect(page.getByTestId("runtime-client-build")).toHaveCount(3);
    await count(page, "runtime-client-builds-requests", visit);
    await count(page, "runtime-client-releases-requests", 0);
    await count(page, "runtime-held-builds-requests", 0);
    await count(page, "runtime-held-releases-requests", 0);
    await count(page, "runtime-mirror-requests", 0);
  },
};

async function go(page: Page, route: Route) {
  await page.getByTestId("ssr-nav").getByRole("link", { name: NAV[route], exact: true }).click();
  await expect(page).toHaveURL(PATH[route]);
  await expect(page.getByTestId("ssr-nav").getByRole("link", { name: NAV[route], exact: true })).toHaveAttribute("aria-current", "page");
}

/** Hydrated: the nav links carry React's props. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => {
    const link = document.querySelector('[data-testid="ssr-nav"] a');
    return !!link && Object.keys(link).some((k) => k.startsWith("__reactProps"));
  });
}

test("a walk through the nav: every route reached by client navigation starts each resolver once per visit", async ({ page, pageErrors }) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  // Opened directly: the form requests nothing, so every count below comes from a client navigation.
  await open(page, "./ssr/form/");
  await LOADED.form(page, 1);

  const order: Route[] = ["lists", "catalog", "flow", "runtime", "form"];
  for (let visit = 1; visit <= 3; visit++) {
    for (const route of order) {
      await go(page, route);
      await LOADED[route](page, visit);
    }
  }

  // Nothing late: a doubled request would land after its route had "loaded".
  await page.waitForTimeout(800);
  await go(page, "lists");
  await LOADED.lists(page, 4);
  await go(page, "runtime");
  await LOADED.runtime(page, 4);
  await go(page, "flow");
  await LOADED.flow(page, 4);
  await go(page, "catalog");
  await LOADED.catalog(page, 4);
});

test("leaving a route before it has loaded: the next visit still starts each resolver once", async ({ page, pageErrors }) => {
  void pageErrors;
  await open(page, "./ssr/form/");

  // In and out at once: the first visit's requests are in flight when its store goes away.
  await go(page, "lists");
  await go(page, "form");
  await go(page, "lists");
  await LOADED.lists(page, 2);
  await page.waitForTimeout(800);
  await LOADED.lists(page, 2);
});
