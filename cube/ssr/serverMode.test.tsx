// @vitest-environment node
/**
 * Server mode (experiments/SsrPlan.md, Stage 1), Cube only. Without `window`
 * a store starts nothing by itself: no resolver (lazy, eager, a flow step's),
 * no page fetch, no flow entry. Whatever would have started reads
 * `loading: true`, so the HTML shows the skeleton the client's first render
 * shows. `store.start()` runs what was held; `server: false` is the client's
 * behavior in Node.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { Writable } from "node:stream";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { Palistor, defineFlow, defineList, defineStep, useForm } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type T = (key: string) => string;
const t: T = (key) => `T:${key}`;

/**
 * One store with every kind of start: a lazy list, an eager group, a lazy
 * group nobody reads, and a flow whose two steps have a resolve each.
 * `order` is the first step's lifecycle.
 */
function makeStore(options: Record<string, unknown> = {}) {
  const order: string[] = [];
  const resolvers = {
    users: vi.fn(async () => [{ id: "u1", name: "Alice" }]),
    car: vi.fn(async () => ({ brand: "Toyota" })),
    unread: vi.fn(async () => ({ note: "read" })),
    step: vi.fn(async () => { order.push("resolve"); return { data: "loaded" }; }),
    nextStep: vi.fn(async () => ({ data: "next" })),
  };
  const onEnter = vi.fn(() => { order.push("enter"); });
  const onReady = vi.fn(() => { order.push("ready"); });
  const store = new Palistor({
    config: {
      title: { value: "", label: (translate: T) => translate("title.label") },
      users: [
        { id: { value: "" }, name: { value: "" } },
        { resolve: { resolver: resolvers.users, onError: vi.fn() } },
      ],
      car: {
        resolve: { resolver: resolvers.car, onError: vi.fn(), options: { lazy: false } },
        brand: { value: "no brand" },
      },
      unread: { resolve: { resolver: resolvers.unread, onError: vi.fn() }, note: { value: "" } },
      wizard: defineFlow({
        steps: [
          defineStep("first", {
            data: { value: "no data" },
            onEnter,
            onReady,
            resolve: { resolver: resolvers.step, onError: vi.fn() },
          }),
          defineStep("second", { data: { value: "" }, resolve: { resolver: resolvers.nextStep, onError: vi.fn() } }),
        ],
      }),
    },
    translator: t,
    ...options,
  } as any) as any;
  return { store, resolvers, onEnter, onReady, order };
}

type Made = ReturnType<typeof makeStore>;

/** Reads the label, the lazy list (`loading`, then the rows), the eager group and the flow. Never reads `unread`. */
function App({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  return (
    <main>
      <label>{form.title.label}</label>
      <ul data-loading={String(form.users.loading)}>
        {form.users.items.map((user: any) => <li key={user.id}>{user.name.value}</li>)}
      </ul>
      <p data-loading={String(form.car.loading)}>{form.car.brand.value}</p>
      <section data-loading={String(form.wizard.loading)}>{form.wizard.steps.first.data.value}</section>
    </main>
  );
}

/** What the server sends before anything ran: the translation, the defaults, and `loading` on every resolve that will start. */
const HELD_HTML = [
  "<label>T:title.label</label>",
  '<ul data-loading="true"></ul>',
  '<p data-loading="true">no brand</p>',
  '<section data-loading="true">no data</section>',
];

/** Streams the element and collects the whole output once everything is ready. */
function stream(element: ReactElement): Promise<{ html: string; errors: unknown[] }> {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    let html = "";
    const sink = new Writable({
      write(chunk, _encoding, done) { html += Buffer.from(chunk).toString("utf8"); done(); },
    });
    sink.on("finish", () => resolve({ html, errors }));
    const { pipe } = renderToPipeableStream(element, {
      onAllReady() { pipe(sink); },
      onShellError: reject,
      onError(error) { errors.push(error); },
    });
  });
}

function expectNothingRan(s: Made) {
  for (const resolver of Object.values(s.resolvers)) expect(resolver).not.toHaveBeenCalled();
  expect(s.onEnter).not.toHaveBeenCalled();
  expect(s.onReady).not.toHaveBeenCalled();
}

describe("server mode: the default without `window`", () => {
  it("construction starts nothing; an eager resolve and the active step's read loading: true right away", async () => {
    expect(typeof window).toBe("undefined"); // the premise of this file: no `server` option, no `window`
    const s = makeStore();
    await flush();
    expectNothingRan(s);
    const form = s.store.proxy;
    expect(form.car.loading).toBe(true);
    expect(form.wizard.steps.first.loading).toBe(true);
    expect(form.wizard.loading).toBe(true);
    expect(form.wizard.steps.second.loading).toBe(false); // not the active step
  });

  it("renderToString: no resolver and no onEnter is called; the HTML has the translation and loading: true", async () => {
    const s = makeStore();
    const html = renderToString(<App store={s.store} />);
    await flush();
    for (const part of HELD_HTML) expect(html).toContain(part);
    expect(html).not.toContain("<label>title.label</label>"); // not the key
    expectNothingRan(s);
  });

  it("streaming: no resolver and no onEnter is called; the HTML has the translation and loading: true", async () => {
    const s = makeStore();
    const { html, errors } = await stream(<App store={s.store} />);
    await flush();
    for (const part of HELD_HTML) expect(html).toContain(part);
    expect(errors).toEqual([]);
    expectNothingRan(s);
  });

  it("a lazy resolve reads loading: true from its first read on, whichever state is read first", async () => {
    const s = makeStore();
    const form = s.store.proxy;
    expect(form.users.items).toHaveLength(0); // the rows first
    expect(form.users.loading).toBe(true);
    expect(form.unread.loading).toBe(true); // `loading` first: the read itself wakes the resolve
    await flush();
    expectNothingRan(s);
  });

  it("an explicit reload() is held as well, and runs once on start()", async () => {
    const s = makeStore();
    s.store.proxy.users.reload();
    await flush();
    expectNothingRan(s);
    expect(s.store.proxy.users.loading).toBe(true);

    s.store.start();
    await flush();
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);
    expect(s.store.proxy.users.length).toBe(1);
  });
});

describe("store.start()", () => {
  it("runs what was held: each resolver once, onEnter once, onReady after the step's resolve lands", async () => {
    const s = makeStore();
    renderToString(<App store={s.store} />);

    s.store.start();
    expect(s.order).toEqual(["enter", "resolve"]); // the flow enters its step: onEnter, then the step's resolver
    expect(s.resolvers.car).toHaveBeenCalledTimes(1); // eager
    expect(s.resolvers.users).toHaveBeenCalledTimes(1); // lazy, read by the render

    await flush();
    expect(s.order).toEqual(["enter", "resolve", "ready"]);
    expect(s.onEnter).toHaveBeenCalledTimes(1);
    expect(s.onReady).toHaveBeenCalledTimes(1);
    expect(s.resolvers.step).toHaveBeenCalledTimes(1);
    expect(s.resolvers.car).toHaveBeenCalledTimes(1);
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);

    const html = renderToString(<App store={s.store} />);
    expect(html).toContain('<ul data-loading="false"><li>Alice</li></ul>');
    expect(html).toContain('<p data-loading="false">Toyota</p>');
    expect(html).toContain('<section data-loading="false">loaded</section>');
  });

  it("does not run a lazy resolve nobody read, nor the resolve of a step that is not active", async () => {
    const s = makeStore();
    renderToString(<App store={s.store} />);
    expect(s.store.proxy.wizard.steps.second.loading).toBe(false); // a step's `loading` does not wake its resolve
    s.store.start();
    await flush();
    expect(s.resolvers.unread).not.toHaveBeenCalled();
    expect(s.resolvers.nextStep).not.toHaveBeenCalled();
  });

  it("called twice changes nothing", async () => {
    const s = makeStore();
    renderToString(<App store={s.store} />);
    s.store.start();
    s.store.start();
    await flush();
    s.store.start();
    await flush();
    expect(s.order).toEqual(["enter", "resolve", "ready"]);
    expect(s.resolvers.car).toHaveBeenCalledTimes(1);
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);
    expect(s.resolvers.unread).not.toHaveBeenCalled();
  });

  it("without a render before it: the eager resolve and the flow run, a lazy one waits for its first read", async () => {
    const s = makeStore();
    s.store.start();
    await flush();
    expect(s.order).toEqual(["enter", "resolve", "ready"]);
    expect(s.resolvers.car).toHaveBeenCalledTimes(1);
    expect(s.resolvers.users).not.toHaveBeenCalled();

    // Started: from here on the store is the client's — a read starts the lazy run a microtask later.
    expect(s.store.proxy.users.loading).toBe(true);
    expect(s.resolvers.users).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);
    await flush();
    expect(s.store.proxy.users.loading).toBe(false);
    expect(s.store.proxy.users.length).toBe(1);
  });
});

describe("server: false in Node behaves like the client", () => {
  it("the eager resolver and the flow entry run from the constructor, the lazy one a microtask after its read", async () => {
    const s = makeStore({ server: false });
    expect(s.resolvers.car).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["enter", "resolve"]);
    expect(s.resolvers.users).not.toHaveBeenCalled();

    const users = s.store.proxy.users;
    expect(users.loading).toBe(true); // due: the run starts on the next microtask
    expect(s.resolvers.users).not.toHaveBeenCalled(); // never inside the read
    await Promise.resolve();
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);

    await flush();
    expect(users.loading).toBe(false);
    expect(users.length).toBe(1);
    expect(s.order).toEqual(["enter", "resolve", "ready"]);
    expect(s.resolvers.unread).not.toHaveBeenCalled();
    expect(s.resolvers.nextStep).not.toHaveBeenCalled();
  });

  it("a render's reads start the lazy run right after it; start() has nothing left to do", async () => {
    const s = makeStore({ server: false });
    const html = renderToString(<App store={s.store} />);
    for (const part of HELD_HTML) expect(html).toContain(part); // the client's first render is the server's HTML
    expect(s.resolvers.users).not.toHaveBeenCalled();
    await flush();
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);

    s.store.start();
    await flush();
    expect(s.order).toEqual(["enter", "resolve", "ready"]);
    expect(s.resolvers.car).toHaveBeenCalledTimes(1);
    expect(s.resolvers.users).toHaveBeenCalledTimes(1);
  });
});

describe("server mode: a paginated list", () => {
  const ROWS = Array.from({ length: 5 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));

  function pagedStore(options: Record<string, unknown> = {}) {
    const resolver = vi.fn(async (_values: unknown, _store: unknown, ctx: any) => ({
      items: ROWS.slice(ctx.page.offset, ctx.page.offset + ctx.page.pageSize),
      total: ROWS.length,
    }));
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: resolver as any, pagination: { pageSize: 2 } },
        }),
      },
      ...options,
    } as any) as any;
    return { store, resolver, list: store.proxy.users };
  }

  it("makes no request and reads loading / isInitialLoading true", async () => {
    const byLoading = pagedStore();
    expect(byLoading.list.loading).toBe(true);
    expect(byLoading.list.isInitialLoading).toBe(true);

    const byInitial = pagedStore(); // `isInitialLoading` alone wakes the list
    expect(byInitial.list.isInitialLoading).toBe(true);
    expect(byInitial.list.loading).toBe(true);

    const byItems = pagedStore();
    expect(byItems.list.items).toHaveLength(0);
    expect(byItems.list.loading).toBe(true);

    await flush();
    for (const s of [byLoading, byInitial, byItems]) expect(s.resolver).not.toHaveBeenCalled();
  });

  it("a reload() is held too; start() fetches the current page once", async () => {
    const s = pagedStore();
    expect(s.list.isInitialLoading).toBe(true);
    s.list.reload();
    await flush();
    expect(s.resolver).not.toHaveBeenCalled();

    s.store.start();
    await flush();
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.resolver.mock.calls[0][2].page).toMatchObject({ page: 1, pageSize: 2, offset: 0 });
    expect(s.list.items.map((item: any) => item.id)).toEqual(["u1", "u2"]);
    expect(s.list.loading).toBe(false);
    expect(s.list.isInitialLoading).toBe(false);
  });

  it("server: false fetches the first page after the read, never inside it", async () => {
    const s = pagedStore({ server: false });
    expect(s.list.isInitialLoading).toBe(true);
    expect(s.resolver).not.toHaveBeenCalled();
    await flush();
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.list.isInitialLoading).toBe(false);
    expect(s.list.length).toBe(2);
  });
});

describe("server mode: context", () => {
  it("store.context is there from the constructor, for the store and for the code it runs", async () => {
    const seen: string[] = [];
    const make = (accountId: string, options: Record<string, unknown> = {}) =>
      new Palistor({
        config: {
          car: {
            resolve: {
              resolver: async (_values: unknown, store: any) => { seen.push(`resolver:${store.context.accountId}`); return {}; },
              onError: vi.fn(),
              options: { lazy: false },
            },
            brand: { value: "" },
          },
          wizard: defineFlow({
            steps: [defineStep("first", { onEnter: (_values: unknown, store: any) => { seen.push(`enter:${store.context.accountId}`); } })],
          }),
        },
        context: { accountId },
        ...options,
      } as any) as any;

    const server = make("server");
    expect(server.context).toEqual({ accountId: "server" });
    expect(seen).toEqual([]);
    server.start();
    expect(seen).toEqual(["enter:server", "resolver:server"]);

    seen.length = 0;
    make("client", { server: false }); // both run inside the constructor
    expect(seen).toEqual(["enter:client", "resolver:client"]);
  });

  it("a resolve waiting for its contextDeps reads loading: false; with the key in the constructor it reads true", async () => {
    const make = (context?: Record<string, unknown>) => {
      const lazy = vi.fn(async () => ({ brand: "Toyota" }));
      const eager = vi.fn(async () => ({ name: "Ann" }));
      const store = new Palistor({
        config: {
          car: { resolve: { resolver: lazy, onError: vi.fn(), contextDeps: ["accountId"] }, brand: { value: "" } },
          owner: {
            resolve: { resolver: eager, onError: vi.fn(), contextDeps: ["accountId"], options: { lazy: false } },
            name: { value: "" },
          },
        },
        ...(context ? { context } : {}),
      } as any) as any;
      return { store, lazy, eager, form: store.proxy };
    };

    const waiting = make();
    expect(waiting.form.car.loading).toBe(false);
    expect(waiting.form.owner.loading).toBe(false);
    waiting.store.start();
    await flush();
    expect(waiting.lazy).not.toHaveBeenCalled();
    expect(waiting.eager).not.toHaveBeenCalled();
    expect(waiting.form.car.loading).toBe(false);
    expect(waiting.form.owner.loading).toBe(false);

    const ready = make({ accountId: "acc1" });
    expect(ready.form.car.loading).toBe(true);
    expect(ready.form.owner.loading).toBe(true);
    await flush();
    expect(ready.lazy).not.toHaveBeenCalled();
    expect(ready.eager).not.toHaveBeenCalled();
    ready.store.start();
    await flush();
    expect(ready.lazy).toHaveBeenCalledTimes(1);
    expect(ready.eager).toHaveBeenCalledTimes(1);
  });
});
