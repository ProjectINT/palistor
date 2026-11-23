/**
 * Hydration (experiments/SsrPlan.md, Stage 1), Cube only. The server renders
 * the HTML from a store in server mode; the browser hydrates it with a second
 * store built from the same config and options. The client's first render
 * must be the server's: a resolve that will start reads `loading: true` on
 * both sides, and the translator is there from the constructor. React reports
 * no mismatch, and every resolver runs once, in the browser only.
 *
 * jsdom has `window`, so the server store asks for `server: true` and the
 * client one is in client mode by default. Resolvers wait on a gate, as a
 * request does: nothing lands between the store's creation and hydration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense, type ReactElement } from "react";
import { Writable } from "node:stream";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { Palistor, defineFlow, defineList, defineStep, useForm } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type T = (key: string) => string;
const t: T = (key) => `T:${key}`;

/** The same config and options on both sides; only `server` differs. */
function makeStore(options: Record<string, unknown> = {}) {
  const gates = { users: deferred(), car: deferred(), step: deferred(), paged: deferred() };
  const order: string[] = [];
  const resolvers = {
    users: vi.fn(() => gates.users.promise),
    car: vi.fn(() => gates.car.promise),
    step: vi.fn(() => { order.push("resolve"); return gates.step.promise; }),
    paged: vi.fn(() => gates.paged.promise),
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
      wizard: defineFlow({
        steps: [
          defineStep("first", {
            data: { value: "no data" },
            onEnter,
            onReady,
            resolve: { resolver: resolvers.step, onError: vi.fn() },
          }),
          defineStep("second", {}),
        ],
      }),
      orders: defineList({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver: resolvers.paged as any, pagination: { pageSize: 2 } },
      }),
    },
    translator: t,
    ...options,
  } as any) as any;
  return { store, gates, resolvers, onEnter, onReady, order };
}

type Made = ReturnType<typeof makeStore>;
type View = (props: { store: unknown }) => ReactElement;

function Label({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  return <label>{form.title.label}</label>;
}

/** The usual list code: a skeleton while `loading`, the rows otherwise. */
function Users({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  if (form.users.loading) return <em>users-skeleton</em>;
  return <ul>{form.users.items.map((user: any) => <li key={user.id}>{user.name.value}</li>)}</ul>;
}

function Car({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  return <p data-loading={String(form.car.loading)}>{form.car.brand.value}</p>;
}

function Wizard({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  const step = form.wizard.steps.first;
  return <section data-loading={String(form.wizard.loading)} data-step={String(step.loading)}>{step.data.value}</section>;
}

function Orders({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  if (form.orders.isInitialLoading) return <em>orders-skeleton</em>;
  return <ol>{form.orders.items.map((order: any) => <li key={order.id}>{order.name.value}</li>)}</ol>;
}

function Page({ store }: { store: unknown }) {
  return <main><Label store={store} /><Users store={store} /><Car store={store} /><Wizard store={store} /><Orders store={store} /></main>;
}

let container: HTMLElement;
let root: Root | null = null;
let consoleError: ReturnType<typeof vi.spyOn>;
const onRecoverableError = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  onRecoverableError.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  consoleError.mockRestore();
});

/**
 * Server render with a `server: true` store, then hydration with a store that
 * has no `server` option. Returns both, the server's HTML, and the element the
 * server sent, to tell hydration (the node is kept) from a client re-render.
 */
async function hydrate(View: View, clientOptions: Record<string, unknown> = {}) {
  const server = makeStore({ server: true });
  const html = renderToString(<View store={server.store} />);
  container.innerHTML = html;
  const sent = container.firstElementChild;

  const client = makeStore(clientOptions);
  await act(async () => {
    root = hydrateRoot(container, <View store={client.store} />, { onRecoverableError });
  });
  return { server, client, html, sent };
}

function expectCleanHydration() {
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
}

function expectServerRanNothing(server: Made) {
  for (const resolver of Object.values(server.resolvers)) expect(resolver).not.toHaveBeenCalled();
  expect(server.onEnter).not.toHaveBeenCalled();
  expect(server.onReady).not.toHaveBeenCalled();
}

describe("hydration of server-mode HTML by a client store", () => {
  it("a label through `translator`: the translation is in the HTML and hydrates as it is", async () => {
    const { html, sent } = await hydrate(Label);
    expect(html).toBe("<label>T:title.label</label>");
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expectCleanHydration();
  });

  it("a lazy list read through `loading` and `items`: the skeleton hydrates, the resolver runs once, on the client", async () => {
    const { server, client, html, sent } = await hydrate(Users);
    expect(html).toBe("<em>users-skeleton</em>");
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expectCleanHydration();
    expect(client.resolvers.users).toHaveBeenCalledTimes(1); // started right after the first render

    await act(async () => { client.gates.users.resolve([{ id: "u1", name: "Alice" }]); await flush(); });
    expect(container.innerHTML).toBe("<ul><li>Alice</li></ul>");
    expect(client.resolvers.users).toHaveBeenCalledTimes(1);
    expect(server.resolvers.users).not.toHaveBeenCalled();
    expectCleanHydration();
  });

  it("an eager group: `loading: true` and the defaults hydrate, the resolver runs once, on the client", async () => {
    const { server, client, html, sent } = await hydrate(Car);
    expect(html).toBe('<p data-loading="true">no brand</p>');
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expectCleanHydration();

    await act(async () => { client.gates.car.resolve({ brand: "Toyota" }); await flush(); });
    expect(container.innerHTML).toBe('<p data-loading="false">Toyota</p>');
    expect(client.resolvers.car).toHaveBeenCalledTimes(1);
    expect(server.resolvers.car).not.toHaveBeenCalled();
    expectCleanHydration();
  });

  it("a flow whose first step has a resolve: the step is entered once, on the client", async () => {
    const { server, client, html, sent } = await hydrate(Wizard);
    expect(html).toBe('<section data-loading="true" data-step="true">no data</section>');
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expectCleanHydration();
    expect(client.order).toEqual(["enter", "resolve"]);

    await act(async () => { client.gates.step.resolve({ data: "loaded" }); await flush(); });
    expect(container.innerHTML).toBe('<section data-loading="false" data-step="false">loaded</section>');
    expect(client.order).toEqual(["enter", "resolve", "ready"]);
    expect(client.resolvers.step).toHaveBeenCalledTimes(1);
    expect(server.order).toEqual([]);
    expectCleanHydration();
  });

  it("a paginated list read through `isInitialLoading`: the skeleton hydrates, the first page is fetched once", async () => {
    const { server, client, html, sent } = await hydrate(Orders);
    expect(html).toBe("<em>orders-skeleton</em>");
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expectCleanHydration();

    await act(async () => {
      client.gates.paged.resolve({ items: [{ id: "o1", name: "First" }, { id: "o2", name: "Second" }], total: 5 });
      await flush();
    });
    expect(container.innerHTML).toBe("<ol><li>First</li><li>Second</li></ol>");
    expect(client.resolvers.paged).toHaveBeenCalledTimes(1);
    expect(server.resolvers.paged).not.toHaveBeenCalled();
    expectCleanHydration();
  });

  it("the whole page: no recoverable error, no console.error, each resolver called once on the client and never on the server", async () => {
    const { server, client, html, sent } = await hydrate(Page);
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expectCleanHydration();

    await act(async () => {
      client.gates.users.resolve([{ id: "u1", name: "Alice" }]);
      client.gates.car.resolve({ brand: "Toyota" });
      client.gates.step.resolve({ data: "loaded" });
      client.gates.paged.resolve({ items: [{ id: "o1", name: "First" }], total: 1 });
      await flush();
    });
    expect(container.innerHTML).toBe(
      "<main><label>T:title.label</label><ul><li>Alice</li></ul>" +
      '<p data-loading="false">Toyota</p>' +
      '<section data-loading="false" data-step="false">loaded</section>' +
      "<ol><li>First</li></ol></main>",
    );
    for (const resolver of Object.values(client.resolvers)) expect(resolver).toHaveBeenCalledTimes(1);
    expect(client.onEnter).toHaveBeenCalledTimes(1);
    expect(client.onReady).toHaveBeenCalledTimes(1);
    expectServerRanNothing(server);
    expectCleanHydration();
  });

  it("control: a client store that renders something else is reported, so the checks above can fail", async () => {
    await hydrate(Label, { translator: (key: string) => `other:${key}` });
    expect(onRecoverableError).toHaveBeenCalled();
    expect(container.innerHTML).toBe("<label>other:title.label</label>");
  });
});

describe("a suspense: true boundary the server left to the client", () => {
  /** Streams the way Next.js does: a thrown error's digest is what its boundary carries to the client. */
  function streamWithDigests(element: ReactElement): Promise<string> {
    return new Promise((resolve, reject) => {
      let html = "";
      const sink = new Writable({
        write(chunk, _encoding, done) { html += Buffer.from(chunk).toString("utf8"); done(); },
      });
      sink.on("finish", () => resolve(html));
      const { pipe } = renderToPipeableStream(element, {
        onAllReady() { pipe(sink); },
        onShellError: reject,
        onError: (error: any) => error?.digest,
      });
    });
  }

  function carStore(options: Record<string, unknown> = {}) {
    const gate = deferred();
    const resolver = vi.fn(() => gate.promise);
    const store = new Palistor({
      config: {
        car: { resolve: { resolver, onError: vi.fn(), options: { suspense: true } }, brand: { value: "no brand" } },
      },
      ...options,
    } as any) as any;
    return { store, resolver, gate };
  }

  function Brand({ store }: { store: unknown }) {
    const form = useForm(store as any) as any;
    return <b>{form.car.brand.value}</b>;
  }
  const page = (store: unknown) => <Suspense fallback={<i>car-fallback</i>}><Brand store={store} /></Suspense>;

  it("is rendered by the client, the resolver runs once; React's one notice about it carries the bailout digest", async () => {
    const server = carStore({ server: true });
    container.innerHTML = await streamWithDigests(page(server.store));
    expect(container.innerHTML).toContain("<i>car-fallback</i>");

    const client = carStore();
    await act(async () => {
      root = hydrateRoot(container, page(client.store), { onRecoverableError });
    });
    await act(async () => { client.gate.resolve({ brand: "Toyota" }); await flush(); });

    expect(container.innerHTML).toBe("<b>Toyota</b>");
    expect(client.resolver).toHaveBeenCalledTimes(1);
    expect(server.resolver).not.toHaveBeenCalled();
    // Not a mismatch: React tells that the server gave the boundary up. Next.js drops the notice by this digest.
    expect(onRecoverableError.mock.calls.map(([error]) => error.digest)).toEqual(["BAILOUT_TO_CLIENT_SIDE_RENDERING"]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
