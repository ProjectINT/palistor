import { test, expect, type Locator, type Page } from "./fixtures";

// Route /ssr/catalog: lists beyond the overview's plain list, under SSR.
//   (1) papers     — paged list, page 1 from the server as { items, total };
//   (2) milestones — infinite ("load more") list, first page from the server
//                    with nextCursor / hasMore;
//   (3) talks      — paged list without server data (skeleton, client load);
//   (4) teams      — rows with a nested `members` list, all from the server,
//                    in a store of their own (add / remove / reset).
// Blocks 1–3 show how many times their resolver's fake endpoint was called.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/ssr is built on the Cube implementation only");

const PAPERS = [
  "On Computable Numbers, with an Application to the Entscheidungsproblem",
  "A Mathematical Theory of Communication",
  "Recursive Functions of Symbolic Expressions and Their Computation by Machine",
  "Go To Statement Considered Harmful",
  "An Axiomatic Basis for Computer Programming",
  "A Relational Model of Data for Large Shared Data Banks",
  "The Complexity of Theorem-Proving Procedures",
  "On the Criteria To Be Used in Decomposing Systems into Modules",
  "The UNIX Time-Sharing System",
  "A Protocol for Packet Network Intercommunication",
];
const PAPERS_PAGE_1 = PAPERS.slice(0, 5);
const PAPERS_PAGE_2 = PAPERS.slice(5, 10);
const PAPERS_PAGE_5 = [
  "A Note on Distributed Computing",
  "The Part-Time Parliament",
  "MapReduce: Simplified Data Processing on Large Clusters",
];

const MILESTONES = [
  "Ada Lovelace publishes an algorithm for the Analytical Engine",
  "Alan Turing describes the universal machine",
  "ENIAC is completed",
  "UNIVAC I is delivered to the US Census Bureau",
  "FORTRAN ships for the IBM 704",
  "ARPANET carries its first message",
  "Intel releases the 4004 microprocessor",
  "C is created at Bell Labs",
  "ARPANET switches to TCP/IP",
  "The first website goes online at CERN",
  "Linux 0.01 is released",
  "The first Android phone ships",
];

const TALKS_PAGE_1 = ["The Mother of All Demos", "The Humble Programmer", "Growing a Language"];
const TALKS_PAGE_2 = ["Hammock Driven Development", "Simple Made Easy", "Inventing on Principle"];

const TEAMS: Record<string, string[]> = {
  Compilers: ["Grace Hopper", "Frances Allen", "John Backus"],
  Networking: ["Radia Perlman", "Vint Cerf"],
  "Flight software": ["Margaret Hamilton", "Katherine Johnson"],
  Security: [],
};

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
 * React tags hydrated DOM nodes with `__reactProps$…`; wait until the papers'
 * "Next" button carries it.
 */
async function openCatalog(page: Page) {
  await page.goto("./ssr/catalog/");
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="ssr-catalog-papers-next"]');
    return !!button && Object.keys(button).some((k) => k.startsWith("__reactProps"));
  });
}

const requests = (page: Page, block: "papers" | "milestones" | "talks") =>
  page.getByTestId(`ssr-catalog-${block}-requests`);

/** Rows whose text starts with each of `texts`, in order. */
const startingWith = (texts: string[]) => texts.map((text) => new RegExp(`^${escapeRegExp(text)}`));

/** The talks (the one list without server data) have loaded: from here on nothing is in flight. */
async function settled(page: Page) {
  await expect(page.getByTestId("ssr-catalog-talk")).toHaveText(startingWith(TALKS_PAGE_1));
  await expect(requests(page, "talks")).toHaveText("1");
}

function team(page: Page, name: string): Locator {
  return page.getByTestId("ssr-catalog-team").filter({ hasText: name });
}

test("server HTML has the translations, the first pages, the nested rows and the skeleton", async ({ request }) => {
  const response = await request.get("./ssr/catalog/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Translated on the server: the view's texts and the labels the store computes.
  expect(html).toContain("Pages, the first one from the server");
  expect(html).not.toMatch(/ssr\.catalog\.[\w.]+/);

  // (1) Page 1 is markup, with the pager's state; page 2 was never read.
  for (const title of PAPERS_PAGE_1) {
    expect(html).toMatch(new RegExp(`<li data-testid="ssr-catalog-paper"[^>]*><span[^>]*>${escapeRegExp(title)}</span>`));
  }
  expect(html).toMatch(/Alan Turing<!-- --> · <!-- -->Year<!-- -->: <span class="font-mono">1936<\/span>/);
  expect(html).not.toContain(PAPERS_PAGE_2[0]);
  expect(html).toMatch(/data-testid="ssr-catalog-papers-status"[^>]*>Page 1 of 5</);
  expect(html).toMatch(/data-testid="ssr-catalog-papers-total"[^>]*>23 papers</);
  expect(html).toMatch(/<button data-testid="ssr-catalog-papers-prev" disabled=""/);
  expect(html).toMatch(/<button data-testid="ssr-catalog-papers-next" class=/);
  expect(html).not.toContain('data-testid="ssr-catalog-papers-busy"');

  // (2) The first page of the feed, and "Load more" (hasMore: true).
  for (const event of MILESTONES.slice(0, 4)) {
    expect(html).toMatch(new RegExp(`<li data-testid="ssr-catalog-milestone"[^>]*>.*?<span[^>]*>${escapeRegExp(event)}</span>`));
  }
  expect(html).not.toContain(MILESTONES[4]);
  expect(html).toContain('data-testid="ssr-catalog-milestones-more"');
  expect(html).not.toContain('data-testid="ssr-catalog-milestones-end"');
  expect(html).toMatch(/data-testid="ssr-catalog-milestones-shown"[^>]*>Showing 4 · 1 page loaded</);

  // (3) No server data: `isInitialLoading` is already true, so the skeleton.
  expect(html).toContain('data-testid="ssr-catalog-talks-skeleton"');
  expect(html).not.toContain('data-testid="ssr-catalog-talks-rows"');
  expect(html).not.toContain(TALKS_PAGE_1[0]);

  // (4) The teams and the rows of their nested lists; nothing is edited.
  for (const [name, members] of Object.entries(TEAMS)) {
    expect(html).toMatch(new RegExp(`<h3[^>]*>${escapeRegExp(name)}</h3>`));
    for (const member of members) {
      expect(html).toMatch(new RegExp(`<li data-testid="ssr-catalog-member"[^>]*><span>${escapeRegExp(member)}</span>`));
    }
  }
  expect(html.match(/data-testid="ssr-catalog-member"/g)).toHaveLength(7);
  expect(html).toContain('data-testid="ssr-catalog-team-empty"');
  expect(html).not.toContain('data-testid="ssr-catalog-team-dirty"');

  // The server called no endpoint.
  for (const block of ["papers", "milestones", "talks"]) {
    expect(html).toMatch(new RegExp(`data-testid="ssr-catalog-${block}-requests"[^>]*>0<`));
  }
});

test("hydration is clean: the server's pages are not requested again, the talks load once", async ({ page, pageErrors }, testInfo) => {
  void pageErrors; // uncaught page errors fail the test (fixtures.ts)
  const consoleLines = collectConsole(page);
  await openCatalog(page);

  // (1), (2), (4): the server's rows, no request.
  await expect(page.getByTestId("ssr-catalog-paper")).toHaveText(startingWith(PAPERS_PAGE_1));
  await expect(page.getByTestId("ssr-catalog-papers-status")).toHaveText("Page 1 of 5");
  await expect(page.getByTestId("ssr-catalog-milestone")).toHaveCount(4);
  await expect(page.getByTestId("ssr-catalog-member")).toHaveCount(7);
  await expect(requests(page, "papers")).toHaveText("0");
  await expect(requests(page, "milestones")).toHaveText("0");

  // (3) The skeleton gives way to page 1, loaded once.
  await settled(page);
  await expect(page.getByTestId("ssr-catalog-talks-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("ssr-catalog-talks-status")).toHaveText("Page 1 of 3");

  // Give a late request time to show up, then check that there was none.
  await page.waitForTimeout(700);
  await expect(requests(page, "papers")).toHaveText("0");
  await expect(requests(page, "milestones")).toHaveText("0");
  await expect(requests(page, "talks")).toHaveText("1");

  await testInfo.attach("console", {
    body: consoleLines.map((line) => `[${line.type}] ${line.text}`).join("\n"),
    contentType: "text/plain",
  });
  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});

test("pages: a new page is one request, a page seen before (the server's page 1 too) comes from the cache", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCatalog(page);
  await settled(page);
  const rows = page.getByTestId("ssr-catalog-paper");
  const status = page.getByTestId("ssr-catalog-papers-status");

  // Page 2 is not cached: one request.
  await page.getByTestId("ssr-catalog-papers-next").click();
  await expect(rows).toHaveText(startingWith(PAPERS_PAGE_2));
  await expect(status).toHaveText("Page 2 of 5");
  await expect(requests(page, "papers")).toHaveText("1");
  await expect(page.getByTestId("ssr-catalog-papers-busy")).toHaveCount(0);

  // Back to page 1 — the server's page, filed as a fetched one — and to page 2 again: no request.
  await page.getByTestId("ssr-catalog-papers-page-1").click();
  await expect(rows).toHaveText(startingWith(PAPERS_PAGE_1));
  await expect(status).toHaveText("Page 1 of 5");
  await expect(page.getByTestId("ssr-catalog-papers-prev")).toBeDisabled();
  await page.getByTestId("ssr-catalog-papers-page-2").click();
  await expect(rows).toHaveText(startingWith(PAPERS_PAGE_2));
  await expect(requests(page, "papers")).toHaveText("1");

  // The last page: one more request, a short page, no next one.
  await page.getByTestId("ssr-catalog-papers-page-5").click();
  await expect(rows).toHaveText(startingWith(PAPERS_PAGE_5));
  await expect(status).toHaveText("Page 5 of 5");
  await expect(requests(page, "papers")).toHaveText("2");
  await expect(page.getByTestId("ssr-catalog-papers-next")).toBeDisabled();
  await expect(page.getByTestId("ssr-catalog-papers-total")).toHaveText("23 papers");

  await page.waitForTimeout(600);
  await expect(requests(page, "papers")).toHaveText("2");
  await expect(requests(page, "milestones")).toHaveText("0");
  await expect(requests(page, "talks")).toHaveText("1");
});

test("load more: one request per click appends one page, from the server's cursor; hasMore: false ends the feed", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCatalog(page);
  await settled(page);
  const rows = page.getByTestId("ssr-catalog-milestone");
  const more = page.getByTestId("ssr-catalog-milestones-more");
  const shown = page.getByTestId("ssr-catalog-milestones-shown");

  // The server's page carried nextCursor "ms-05": the request continues there,
  // so the rows are 1–8 in order (a request from the start would repeat 1–4).
  await more.click();
  await expect(rows).toHaveText(MILESTONES.slice(0, 8).map((event) => new RegExp(`${escapeRegExp(event)}$`)));
  await expect(shown).toHaveText("Showing 8 · 2 pages loaded");
  await expect(requests(page, "milestones")).toHaveText("1");

  // The last page answers hasMore: false: no more "Load more".
  await more.click();
  await expect(rows).toHaveCount(12);
  await expect(rows.last()).toHaveText(new RegExp(`${escapeRegExp(MILESTONES[11])}$`));
  await expect(shown).toHaveText("Showing 12 · 3 pages loaded");
  await expect(page.getByTestId("ssr-catalog-milestones-end")).toHaveText("The end of the timeline");
  await expect(more).toHaveCount(0);
  await expect(requests(page, "milestones")).toHaveText("2");

  await page.waitForTimeout(600);
  await expect(requests(page, "milestones")).toHaveText("2");
  await expect(requests(page, "papers")).toHaveText("0");
});

test("pages without server data: after the first load, a new page is one request and the way back is cached", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCatalog(page);
  await settled(page);
  const rows = page.getByTestId("ssr-catalog-talk");

  await page.getByTestId("ssr-catalog-talks-next").click();
  await expect(rows).toHaveText(startingWith(TALKS_PAGE_2));
  await expect(page.getByTestId("ssr-catalog-talks-status")).toHaveText("Page 2 of 3");
  await expect(requests(page, "talks")).toHaveText("2");

  await page.getByTestId("ssr-catalog-talks-prev").click();
  await expect(rows).toHaveText(startingWith(TALKS_PAGE_1));
  await page.waitForTimeout(600);
  await expect(requests(page, "talks")).toHaveText("2");
});

test("nested lists: adding and removing members edits a team, reset brings back the server's members", async ({ page, pageErrors }) => {
  void pageErrors;
  await openCatalog(page);
  await settled(page);
  const members = (name: string) => team(page, name).getByTestId("ssr-catalog-member");
  const edited = (name: string) => team(page, name).getByTestId("ssr-catalog-team-dirty");

  // Remove a member the server sent.
  await team(page, "Compilers").getByRole("button", { name: "Remove John Backus" }).click();
  await expect(members("Compilers")).toHaveText(startingWith(["Grace Hopper", "Frances Allen"]));
  await expect(edited("Compilers")).toBeVisible();

  // Add one to the team the server sent with an empty list.
  await team(page, "Security").getByTestId("ssr-catalog-team-input").fill("Ada Lovelace");
  await team(page, "Security").getByTestId("ssr-catalog-team-add").click();
  await expect(members("Security")).toHaveText(startingWith(["Ada Lovelace"]));
  await expect(team(page, "Security").getByTestId("ssr-catalog-team-empty")).toHaveCount(0);
  await expect(edited("Security")).toBeVisible();

  // Dirty compares the membership with the server's: add and remove again is not an edit.
  await team(page, "Networking").getByTestId("ssr-catalog-team-input").fill("Bob Kahn");
  await team(page, "Networking").getByTestId("ssr-catalog-team-input").press("Enter");
  await expect(members("Networking")).toHaveText(startingWith(["Radia Perlman", "Vint Cerf", "Bob Kahn"]));
  await expect(edited("Networking")).toBeVisible();
  await team(page, "Networking").getByRole("button", { name: "Remove Bob Kahn" }).click();
  await expect(members("Networking")).toHaveText(startingWith(TEAMS.Networking));
  await expect(edited("Networking")).toHaveCount(0);
  await expect(edited("Flight software")).toHaveCount(0);

  // store.reset(): every nested list is back to the server's members, nothing is edited.
  await page.getByTestId("ssr-catalog-teams-reset").click();
  for (const [name, list] of Object.entries(TEAMS)) {
    await expect(members(name)).toHaveText(startingWith(list));
  }
  await expect(page.getByTestId("ssr-catalog-team-dirty")).toHaveCount(0);
  await expect(team(page, "Security").getByTestId("ssr-catalog-team-empty")).toBeVisible();

  // The teams' store is its own: the other blocks were not touched.
  await expect(page.getByTestId("ssr-catalog-paper")).toHaveText(startingWith(PAPERS_PAGE_1));
  await expect(requests(page, "papers")).toHaveText("0");
  await expect(requests(page, "milestones")).toHaveText("0");
  await expect(requests(page, "talks")).toHaveText("1");
});

test("the store's labels follow the locale after hydration, without a request", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server renders the default locale; the client switches after mount.
  await openCatalog(page);
  await expect(page.getByTestId("ssr-catalog-paper").first()).toHaveText(/Alan Turing · Год: 1936$/);
  await expect(page.getByTestId("ssr-catalog-papers-status")).toHaveText("Страница 1 из 5");
  await expect(page.getByTestId("ssr-catalog-papers-total")).toHaveText("Статей: 23");
  await settled(page);
  await expect(page.getByTestId("ssr-catalog-talk").first()).toHaveText(/Год: 1968$/);
  await expect(page.getByTestId("ssr-catalog-milestones-more")).toHaveText("Загрузить ещё");

  await expect(requests(page, "papers")).toHaveText("0");
  await expect(requests(page, "milestones")).toHaveText("0");
  await expect(requests(page, "talks")).toHaveText("1");
  expect(consoleLines.filter((line) => HYDRATION.test(line.text)), "hydration messages in the console").toEqual([]);
});

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
