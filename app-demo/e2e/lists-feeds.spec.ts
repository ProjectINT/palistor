import { test, expect, type Locator, type Page } from "./fixtures";
import { badConsoleLines, collectConsole, openLists } from "./lists-fixtures";
import journalTable from "../src/app/lists/feeds/journal.json";
import postTable from "../src/app/lists/feeds/posts.json";

// Route /lists/feeds (src/app/lists/feeds/): two lists paged without page
// numbers, one store each.
//   Feed    — `infinite`: Load more, the end through `nextCursor: null`,
//             `maxPages: 3`, the window and the scroll anchor saved with
//             `usePersist` (`persist: "window"`, `setScrollAnchor`), and a
//             server sort, Newest / Oldest (`sort` block, `ctx.sort`).
//   Journal — `cursor`: Forward / Back, Back and revisits from the cache,
//             `suspense: true` read under a <Suspense> boundary.
// Each block counts its backend calls (lists-feed-requests,
// lists-journal-requests); every test checks what is on screen and the count.
//
// The route exists on the Cube implementation only (page.cube.tsx).
test.skip(process.env.PALISTOR_IMPL === "store", "/lists is built on the Cube implementation only");

// Mirrors src/app/lists/feeds/feedsConfig.ts (not imported: it pulls in the library).
const FEED_PAGE = 9;
const MAX_PAGES = 3;
const JOURNAL_PAGE = 6;
const PERSIST_KEY = "palistor-demo:lists-feed";

/** The posts in feed order: newest first (the sort's `$default`). */
const FEED = [...postTable].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
/** The posts under "Oldest first". */
const OLDEST = [...FEED].reverse();
/** The texts of feed pages `from`…`to` (1-based, inclusive), in the order `posts`. */
const feedPages = (from: number, to = from, posts = FEED) =>
  posts.slice((from - 1) * FEED_PAGE, to * FEED_PAGE).map((post) => post.text);
const FEED_PAGE_COUNT = Math.ceil(FEED.length / FEED_PAGE); // 5, the last one full

/** The messages of journal page `n` (1-based), oldest entry first. */
const journalPage = (n: number) => journalTable.slice((n - 1) * JOURNAL_PAGE, n * JOURNAL_PAGE).map((entry) => entry.message);
const JOURNAL_PAGE_COUNT = Math.ceil(journalTable.length / JOURNAL_PAGE); // 5, the last one full

/**
 * Backend calls a reload makes before the saved window is on screen.
 *
 * KNOWN LIBRARY GAP (reported): this should be 0. `usePalistor` starts the
 * store in an effect, and that start fetches the first page the render asked
 * for; `usePersist` reads the storage in an effect too, asynchronously, so its
 * window lands a microtask later and supersedes that fetch. The window and
 * the anchor come back from storage, but one request has already been sent.
 * Set this to 0 once the library restores the window before the start.
 */
const RELOAD_REQUESTS = 1;

// Any test that opens the page leaves a saved feed window behind (usePersist
// writes after every page that lands). Every test gets a fresh browser
// context, so storage starts empty; still, remove it, also after a failure.
test.afterEach(async ({ page }) => {
  await page.evaluate((key) => localStorage.removeItem(key), PERSIST_KEY).catch(() => {});
});

const requests = (page: Page, block: "feed" | "journal") => page.getByTestId(`lists-${block}-requests`);
const feedTexts = (page: Page) => page.getByTestId("lists-feed-post-text");
const journalMessages = (page: Page) => page.getByTestId("lists-journal-message");

/** A request needs a moment to be sent: wait longer than the fake endpoint's delay, then check the count. */
async function stillCounts(page: Page, block: "feed" | "journal", count: number) {
  await page.waitForTimeout(1_000);
  await expect(requests(page, block)).toHaveText(String(count));
}

/** Reload, then wait until the shell has hydrated (as openLists does after its goto). */
async function reloadLists(page: Page) {
  await page.reload();
  await page.waitForFunction(() => {
    const link = document.querySelector('[data-testid="lists-nav"] a');
    return !!link && Object.keys(link).some((k) => k.startsWith("__reactProps"));
  });
}

/** React has attached its handlers to this element (content behind <Suspense> hydrates on its own). */
async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))))
    .toBe(true);
}

/** Click Load more and wait until the window shows pages `from`…`to` of `posts`. */
async function loadMore(page: Page, from: number, to: number, posts = FEED) {
  await page.getByTestId("lists-feed-more").click();
  await expect(feedTexts(page)).toHaveText(feedPages(from, to, posts));
}

/** The order buttons: the active one is pressed, the other is not. */
async function orderIs(page: Page, order: "newest" | "oldest") {
  const other = order === "newest" ? "oldest" : "newest";
  await expect(page.getByTestId(`lists-feed-sort-${order}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`lists-feed-sort-${other}`)).toHaveAttribute("aria-pressed", "false");
}

const feedScrollTop = (page: Page) => page.getByTestId("lists-feed-scroll").evaluate((box) => box.scrollTop);

/** Scroll the feed's box so that the post with `id` is its first visible row. */
async function scrollFeedTo(page: Page, id: string) {
  await page.getByTestId("lists-feed-scroll").evaluate((box, postId) => {
    const row = box.querySelector<HTMLElement>(`[data-post-id="${postId}"]`);
    if (!row) throw new Error(`no row ${postId}`);
    box.scrollTop = row.offsetTop;
  }, id);
}

/** The id of the first post visible in the feed's box (the rule Feed.tsx anchors on). */
function firstVisiblePost(page: Page) {
  return page.getByTestId("lists-feed-scroll").evaluate((box) => {
    const top = box.getBoundingClientRect().top;
    for (const row of box.querySelectorAll<HTMLElement>("[data-post-id]")) {
      if (row.getBoundingClientRect().bottom > top + 1) return row.dataset.postId ?? null;
    }
    return null;
  });
}

test("server HTML has the feed's skeleton and the journal's fallback, translated, and no request", async ({ request }) => {
  const response = await request.get("./lists/feeds/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  expect(html).toContain("Feed");
  expect(html).toContain("Journal");
  expect(html).not.toMatch(/lists\.feeds\.[\w.]+/);

  // The store runs no resolver on the server: the feed reads isInitialLoading and draws its skeleton…
  expect(html).toContain('data-testid="lists-feed-skeleton"');
  expect(html).not.toContain('data-testid="lists-feed-post"');
  expect(html).not.toContain(FEED[0].text);
  // The order buttons render from the sort's `$default` ("-createdAt"): Newest is pressed.
  expect(html).toMatch(/data-testid="lists-feed-sort-newest" aria-pressed="true"[^>]*>Newest first</);
  expect(html).toMatch(/data-testid="lists-feed-sort-oldest" aria-pressed="false"[^>]*>Oldest first</);
  // …and the journal's suspense read throws there: the boundary's fallback is sent.
  expect(html).toContain('data-testid="lists-journal-fallback"');
  expect(html).toContain("Loading the journal…");
  expect(html).not.toContain('data-testid="lists-journal-entry"');

  expect(html).toMatch(/data-testid="lists-feed-requests"[^>]*>0</);
  expect(html).toMatch(/data-testid="lists-journal-requests"[^>]*>0</);
});

test.describe("feed", () => {
  test("the first page arrives with one request; Load more appends a page with one request each", async ({
    page,
    pageErrors,
  }) => {
    void pageErrors; // uncaught page errors fail the test (fixtures.ts)
    const consoleLines = collectConsole(page);
    await openLists(page, "feeds");

    await expect(feedTexts(page)).toHaveText(feedPages(1));
    await expect(requests(page, "feed")).toHaveText("1");
    await expect(page.getByTestId("lists-feed-shown")).toHaveText("9 posts on screen · page 1");
    await expect(page.getByTestId("lists-feed-page-1")).toHaveText("Page 1");
    await expect(page.getByTestId("lists-feed-more")).toBeVisible();
    await expect(page.getByTestId("lists-feed-end")).toHaveCount(0);

    await loadMore(page, 1, 2);
    await expect(requests(page, "feed")).toHaveText("2");
    await loadMore(page, 1, 3);
    await expect(requests(page, "feed")).toHaveText("3");
    await expect(page.getByTestId("lists-feed-shown")).toHaveText("27 posts on screen · pages 1–3");
    for (const n of [1, 2, 3]) await expect(page.getByTestId(`lists-feed-page-${n}`)).toBeVisible();
    // Three pages is the most the window holds: nothing has been dropped yet.
    await expect(page.getByTestId("lists-feed-dropped")).toHaveCount(0);
    await stillCounts(page, "feed", 3);

    expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
  });

  test("maxPages drops the oldest page from the window; nextCursor: null ends the feed", async ({ page }) => {
    await openLists(page, "feeds");
    await expect(feedTexts(page)).toHaveText(feedPages(1));
    await loadMore(page, 1, 2);
    await loadMore(page, 1, 3);

    // A fourth page: the window keeps three, page 1 leaves it.
    await loadMore(page, 2, 4);
    await expect(requests(page, "feed")).toHaveText("4");
    await expect(page.getByTestId("lists-feed-page-1")).toHaveCount(0);
    await expect(page.getByTestId("lists-feed-page-2")).toBeVisible();
    await expect(page.getByTestId("lists-feed-shown")).toHaveText("27 posts on screen · pages 2–4");
    await expect(page.getByTestId("lists-feed-dropped")).toHaveText(`1 older page left the window (maxPages: ${MAX_PAGES})`);

    // The last page is full: only its nextCursor: null says there is no next one.
    await loadMore(page, 3, FEED_PAGE_COUNT);
    await expect(requests(page, "feed")).toHaveText("5");
    await expect(feedTexts(page).last()).toHaveText(FEED[FEED.length - 1].text);
    await expect(page.getByTestId("lists-feed-end")).toHaveText("You've reached the end of the feed.");
    await expect(page.getByTestId("lists-feed-more")).toHaveCount(0);
    await expect(page.getByTestId("lists-feed-dropped")).toHaveText(`2 older pages left the window (maxPages: ${MAX_PAGES})`);
    await stillCounts(page, "feed", 5);
  });

  test.describe("saved window", () => {
    test("a reload restores the window and the scroll anchor; the chain continues; Clear starts fresh", async ({
      page,
      pageErrors,
    }, testInfo) => {
      void pageErrors;
      testInfo.annotations.push({
        type: "known gap",
        description: `a reload sends ${RELOAD_REQUESTS} request before the saved window lands (should be 0, see RELOAD_REQUESTS)`,
      });
      const consoleLines = collectConsole(page);

      await openLists(page, "feeds");
      await expect(feedTexts(page)).toHaveText(feedPages(1));
      await loadMore(page, 1, 2);
      await loadMore(page, 1, 3);
      await expect(requests(page, "feed")).toHaveText("3");

      // Read down to the 5th post of page 2: it becomes the scroll anchor. The scroll handler flushes
      // the snapshot; wait until it holds the anchor, so the reload cannot overtake the write.
      const anchor = FEED[FEED_PAGE + 4].id;
      await scrollFeedTo(page, anchor);
      await expect.poll(() => firstVisiblePost(page)).toBe(anchor);
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? "", PERSIST_KEY))
        .toContain(`"anchorId":"${anchor}"`);

      // A new document: the counter starts at 0, the store is built anew, the window comes from storage.
      await reloadLists(page);
      await expect(feedTexts(page)).toHaveText(feedPages(1, 3));
      await expect(page.getByTestId("lists-feed-shown")).toHaveText("27 posts on screen · pages 1–3");
      await expect.poll(() => firstVisiblePost(page)).toBe(anchor);
      await stillCounts(page, "feed", RELOAD_REQUESTS);

      // The restored cursor chain goes on: the next page is page 4, and maxPages drops page 1.
      await loadMore(page, 2, 4);
      await expect(requests(page, "feed")).toHaveText(String(RELOAD_REQUESTS + 1));
      await expect(page.getByTestId("lists-feed-dropped")).toHaveText(`1 older page left the window (maxPages: ${MAX_PAGES})`);

      // Clear: the next load starts from the network, at the top of page 1.
      await page.getByTestId("lists-feed-clear").click();
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY)).toBeNull();
      await reloadLists(page);
      await expect(feedTexts(page)).toHaveText(feedPages(1));
      await expect(requests(page, "feed")).toHaveText("1");
      await expect(page.getByTestId("lists-feed-shown")).toHaveText("9 posts on screen · page 1");
      expect(await feedScrollTop(page)).toBe(0);
      await stillCounts(page, "feed", 1);

      // Clean up what this test saved: the fresh page 1 was saved again once it landed.
      await page.getByTestId("lists-feed-clear").click();
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY)).toBeNull();

      expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
    });
  });
});

test.describe("journal", () => {
  test("the first load shows the Suspense fallback, then the first page after one request", async ({ page }) => {
    // What the journal block puts in the DOM, in order (repeats collapsed), from the server's HTML on.
    await page.addInitScript(() => {
      const phases: string[] = [];
      Object.assign(window, { __journalPhases: phases });
      const ids = ["lists-journal-fallback", "lists-journal-skeleton", "lists-journal-entry"];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            for (const id of ids) {
              const selector = `[data-testid="${id}"]`;
              if ((node.matches(selector) || node.querySelector(selector)) && phases[phases.length - 1] !== id) phases.push(id);
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await openLists(page, "feeds");

    await expect(page.getByTestId("lists-journal-fallback")).toBeVisible();
    await expect(page.getByTestId("lists-journal-fallback")).toContainText("Loading the journal…");

    await expect(journalMessages(page)).toHaveText(journalPage(1));
    await expect(page.getByTestId("lists-journal-fallback")).toHaveCount(0);
    // The server sent the fallback. In the browser the held store's first render reads an empty list
    // (the skeleton); once the store starts, the read suspends — the fallback again — until page 1 lands.
    const phases = await page.evaluate(() => (window as unknown as { __journalPhases: string[] }).__journalPhases);
    expect(phases[0]).toBe("lists-journal-fallback");
    expect(phases.slice(-3)).toEqual(["lists-journal-skeleton", "lists-journal-fallback", "lists-journal-entry"]);
    await expect(requests(page, "journal")).toHaveText("1");
    await expect(page.getByTestId("lists-journal-page")).toHaveText("Page 1");
    await expect(page.getByTestId("lists-journal-cached")).toHaveText("1 page in the cache");
    await expect(page.getByTestId("lists-journal-prev")).toBeDisabled();
    await expect(page.getByTestId("lists-journal-next")).toBeEnabled();
    await stillCounts(page, "journal", 1);
  });

  test("Forward is one request; Back and Forward to a visited page come from the cache", async ({ page }) => {
    await openLists(page, "feeds");
    await expect(journalMessages(page)).toHaveText(journalPage(1));
    const next = page.getByTestId("lists-journal-next");
    const prev = page.getByTestId("lists-journal-prev");
    await hydrated(next);

    // Forward: one request; the rows of page 1 stay until page 2 lands, no fallback.
    await next.click();
    await expect(page.getByTestId("lists-journal-busy")).toBeVisible();
    await expect(journalMessages(page)).toHaveText(journalPage(1));
    await expect(page.getByTestId("lists-journal-fallback")).toHaveCount(0);
    await expect(journalMessages(page)).toHaveText(journalPage(2));
    await expect(requests(page, "journal")).toHaveText("2");
    await expect(page.getByTestId("lists-journal-fallback")).toHaveCount(0);
    await expect(page.getByTestId("lists-journal-page")).toHaveText("Page 2");
    await expect(page.getByTestId("lists-journal-cached")).toHaveText("2 pages in the cache");

    // Back: from the cache, at once.
    await prev.click();
    await expect(journalMessages(page)).toHaveText(journalPage(1));
    await expect(page.getByTestId("lists-journal-page")).toHaveText("Page 1");
    await expect(requests(page, "journal")).toHaveText("2");

    // Forward again: page 2 is cached too.
    await next.click();
    await expect(journalMessages(page)).toHaveText(journalPage(2));
    await stillCounts(page, "journal", 2);

    // On to the last page: one request per new page. Its nextCursor: null disables Forward.
    for (let n = 3; n <= JOURNAL_PAGE_COUNT; n++) {
      await next.click();
      await expect(journalMessages(page)).toHaveText(journalPage(n));
      await expect(requests(page, "journal")).toHaveText(String(n));
    }
    await expect(next).toBeDisabled();
    await expect(page.getByTestId("lists-journal-cached")).toHaveText(`${JOURNAL_PAGE_COUNT} pages in the cache`);

    // All the way back: every page from the cache.
    for (let n = JOURNAL_PAGE_COUNT - 1; n >= 1; n--) {
      await prev.click();
      await expect(journalMessages(page)).toHaveText(journalPage(n));
    }
    await expect(prev).toBeDisabled();
    await stillCounts(page, "journal", JOURNAL_PAGE_COUNT);
  });
});

test("both blocks follow the saved locale", async ({ page, pageErrors, baseURL }) => {
  void pageErrors;
  const consoleLines = collectConsole(page);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ru", url: baseURL! }]);

  // The server renders English (static export); the client switches after hydration.
  await openLists(page, "feeds");
  await expect(page.getByTestId("lists-feed").getByRole("heading", { level: 2 })).toHaveText("Лента");
  await expect(page.getByTestId("lists-journal").getByRole("heading", { level: 2 })).toHaveText("Журнал");
  await expect(feedTexts(page)).toHaveText(feedPages(1));
  await expect(page.getByTestId("lists-feed-more")).toHaveText("Показать ещё");
  await expect(page.getByTestId("lists-feed-shown")).toHaveText("9 постов на экране · страница 1");
  await expect(page.getByTestId("lists-feed-sort-newest")).toHaveText("Сначала новые");
  await expect(page.getByTestId("lists-feed-sort-oldest")).toHaveText("Сначала старые");
  await expect(journalMessages(page)).toHaveText(journalPage(1));
  await expect(page.getByTestId("lists-journal-next")).toHaveText("Вперёд →");
  await expect(page.getByTestId("lists-journal-cached")).toHaveText("1 страница в кэше");
  await expect(requests(page, "feed")).toHaveText("1");
  await expect(requests(page, "journal")).toHaveText("1");

  expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
});

// ─── Sort: newest / oldest ───────────────────────────────────────────────────
// The feed's `sort` block (`$default: "-createdAt"`) is a server sort: it
// reaches the resolver as `ctx.sort` and is part of the query key.

test.describe("feed sort", () => {
  test("Oldest first is one request and starts the window over; Load more keeps that order; Newest first is a request again", async ({
    page,
  }) => {
    await openLists(page, "feeds");
    await expect(feedTexts(page)).toHaveText(feedPages(1));
    await orderIs(page, "newest");
    await loadMore(page, 1, 2);
    await expect(requests(page, "feed")).toHaveText("2");
    await scrollFeedTo(page, FEED[FEED_PAGE + 2].id);
    expect(await feedScrollTop(page)).toBeGreaterThan(0);

    // One request for the first page of the other order; the window holds that one page, at the top.
    await page.getByTestId("lists-feed-sort-oldest").click();
    await orderIs(page, "oldest");
    await expect(feedTexts(page)).toHaveText(feedPages(1, 1, OLDEST));
    await expect(requests(page, "feed")).toHaveText("3");
    await expect(page.getByTestId("lists-feed-shown")).toHaveText("9 posts on screen · page 1");
    await expect(page.getByTestId("lists-feed-page-1")).toBeVisible();
    await expect(page.getByTestId("lists-feed-page-2")).toHaveCount(0);
    expect(await feedScrollTop(page)).toBe(0);

    // Load more continues oldest first, one request a page, maxPages included, to the end: the newest post.
    await loadMore(page, 1, 2, OLDEST);
    await expect(requests(page, "feed")).toHaveText("4");
    await loadMore(page, 1, 3, OLDEST);
    await loadMore(page, 2, 4, OLDEST);
    await expect(page.getByTestId("lists-feed-dropped")).toHaveText(`1 older page left the window (maxPages: ${MAX_PAGES})`);
    await loadMore(page, 3, FEED_PAGE_COUNT, OLDEST);
    await expect(requests(page, "feed")).toHaveText("7");
    await expect(feedTexts(page).last()).toHaveText(FEED[0].text);
    await expect(page.getByTestId("lists-feed-end")).toBeVisible();

    // Back to Newest: the config keeps one query (maxCachedQueries: 1), so the newest pages were dropped
    // when the order changed. One request for page 1, and the window starts over again.
    await page.getByTestId("lists-feed-sort-newest").click();
    await orderIs(page, "newest");
    await expect(feedTexts(page)).toHaveText(feedPages(1));
    await expect(requests(page, "feed")).toHaveText("8");
    await expect(page.getByTestId("lists-feed-shown")).toHaveText("9 posts on screen · page 1");
    await expect(page.getByTestId("lists-feed-more")).toBeVisible();
    await expect(page.getByTestId("lists-feed-end")).toHaveCount(0);
    await expect(page.getByTestId("lists-feed-dropped")).toHaveCount(0);

    // Pressing the active order again changes nothing.
    await page.getByTestId("lists-feed-sort-newest").click();
    await stillCounts(page, "feed", 8);
  });

  test("a window saved under Oldest is not reused: the reload starts at Newest with a fresh first page", async ({
    page,
    pageErrors,
  }, testInfo) => {
    void pageErrors;
    testInfo.annotations.push({
      type: "known gap",
      description: `the reload sends ${RELOAD_REQUESTS + 1} requests (should be 1, see RELOAD_REQUESTS)`,
    });
    const consoleLines = collectConsole(page);

    await openLists(page, "feeds");
    await expect(feedTexts(page)).toHaveText(feedPages(1));
    await page.getByTestId("lists-feed-sort-oldest").click();
    await expect(feedTexts(page)).toHaveText(feedPages(1, 1, OLDEST));
    await loadMore(page, 1, 2, OLDEST);
    await expect(requests(page, "feed")).toHaveText("3");
    // The window under Oldest is saved once its second page has landed: the snapshot holds that page's last post.
    const lastOfWindow = OLDEST[2 * FEED_PAGE - 1].id;
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? "", PERSIST_KEY)).toContain(`"${lastOfWindow}"`);

    // The sort is not persisted: the new store starts at `$default` (Newest), the saved window
    // answers another query and is not restored, and the first page of Newest is fetched.
    // KNOWN GAP: RELOAD_REQUESTS + 1, not 1 — the start's first-page request is superseded when the
    // saved window is examined (and rejected), and the same page is requested again.
    await reloadLists(page);
    await orderIs(page, "newest");
    await expect(feedTexts(page)).toHaveText(feedPages(1));
    await expect(page.getByTestId("lists-feed-shown")).toHaveText("9 posts on screen · page 1");
    expect(await feedScrollTop(page)).toBe(0);
    await stillCounts(page, "feed", RELOAD_REQUESTS + 1);

    // Clean up what this test saved (the Newest page 1 replaced the Oldest window once it landed).
    await page.getByTestId("lists-feed-clear").click();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY)).toBeNull();

    expect(badConsoleLines(consoleLines), "hydration or missing-message lines in the console").toEqual([]);
  });
});
