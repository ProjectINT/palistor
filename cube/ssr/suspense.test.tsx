// @vitest-environment node
/**
 * `suspense: true` in server mode (experiments/SsrPlan.md, Stage 1), Cube
 * only. A group or a list with `options.suspense` and no data has no run to
 * wait for on the server: reading it throws an error carrying Next.js's
 * "bail out to client-side rendering" digest. React sends the boundary's
 * fallback and marks the boundary for a client render; no resolver is called.
 */
import { describe, it, expect, vi } from "vitest";
import { Suspense, type ReactElement } from "react";
import { Writable } from "node:stream";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { Palistor, defineList, useForm } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const BAILOUT = "BAILOUT_TO_CLIENT_SIDE_RENDERING";
/** React's marker of a Suspense boundary the server gave up on: the client renders it. */
const CLIENT_RENDERED = "<!--$!-->";

/** Streams the element and collects the whole output once everything is ready; `errors` is what reached onError. */
function stream(element: ReactElement): Promise<{ html: string; errors: any[] }> {
  return new Promise((resolve, reject) => {
    const errors: any[] = [];
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

/** A `suspense: true` group; `resolve` adds to its resolve config. */
function carStore(options: Record<string, unknown> = {}, resolve: Record<string, unknown> = {}) {
  const resolver = vi.fn(async () => ({ brand: "Toyota" }));
  const store = new Palistor({
    config: {
      car: {
        resolve: { resolver, onError: vi.fn(), options: { suspense: true }, ...resolve },
        brand: { value: "no brand" },
      },
    },
    ...options,
  } as any) as any;
  return { store, resolver };
}

/** A `suspense: true` list, paginated or not. */
function usersStore(options: Record<string, unknown> = {}, paginated = false) {
  const rows = [{ id: "u1", name: "Alice" }];
  const resolver = vi.fn(async () => (paginated ? { items: rows, total: 1 } : rows));
  const store = new Palistor({
    config: {
      users: defineList({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: {
          resolver: resolver as any,
          options: { suspense: true },
          ...(paginated ? { pagination: { pageSize: 10 } } : {}),
        },
      }),
    },
    ...options,
  } as any) as any;
  return { store, resolver };
}

function Car({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  return <b>{form.car.brand.value}</b>;
}

function Users({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  return <ul>{form.users.items.map((user: any) => <li key={user.id}>{user.name.value}</li>)}</ul>;
}

const carPage = (store: unknown) => <Suspense fallback={<i>car-fallback</i>}><Car store={store} /></Suspense>;
const usersPage = (store: unknown) => <Suspense fallback={<i>users-fallback</i>}><Users store={store} /></Suspense>;

describe("suspense: true in server mode, no data", () => {
  it("a group: the stream has the fallback, the resolver is not called, the error has the bailout digest", async () => {
    const { store, resolver } = carStore();
    const { html, errors } = await stream(carPage(store));
    await flush();

    expect(html).toContain("<i>car-fallback</i>");
    expect(html).toContain(CLIENT_RENDERED);
    expect(html).not.toContain("<b>");
    expect(resolver).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0].digest).toBe(BAILOUT);
  });

  it("a list: the stream has the fallback, the resolver is not called, the error has the bailout digest", async () => {
    const { store, resolver } = usersStore();
    const { html, errors } = await stream(usersPage(store));
    await flush();

    expect(html).toContain("<i>users-fallback</i>");
    expect(html).toContain(CLIENT_RENDERED);
    expect(html).not.toContain("<ul>");
    expect(resolver).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].digest).toBe(BAILOUT);
  });

  it("a paginated list: the same bailout, no page is requested", async () => {
    const { store, resolver } = usersStore({}, true);
    const { html, errors } = await stream(usersPage(store));
    await flush();

    expect(html).toContain("<i>users-fallback</i>");
    expect(html).not.toContain("<ul>");
    expect(resolver).not.toHaveBeenCalled();
    expect(errors.map((e) => e.digest)).toEqual([BAILOUT]);
  });

  it("an eager group bails out as well", async () => {
    const { store, resolver } = carStore({}, { options: { suspense: true, lazy: false } });
    const { html, errors } = await stream(carPage(store));
    await flush();

    expect(html).toContain("<i>car-fallback</i>");
    expect(resolver).not.toHaveBeenCalled();
    expect(errors.map((e) => e.digest)).toEqual([BAILOUT]);
  });

  it("only its own boundary is left to the client: the rest of the page is rendered", async () => {
    const { store } = carStore();
    const { html, errors } = await stream(<main><h1>page</h1>{carPage(store)}</main>);

    expect(html).toContain("<h1>page</h1>");
    expect(html).toContain("<i>car-fallback</i>");
    expect(errors).toHaveLength(1);
  });

  it("renderToString sends the fallback too and does not throw", async () => {
    const { store, resolver } = carStore();
    const html = renderToString(carPage(store));
    await flush();

    expect(html).toContain("<i>car-fallback</i>");
    expect(html).toContain(CLIENT_RENDERED);
    expect(html).not.toContain("<b>");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("without a <Suspense> boundary above there is nothing to fall back to: the render fails with the bailout error", async () => {
    const { store, resolver } = carStore();

    let thrown: any;
    try { renderToString(<Car store={store} />); } catch (error) { thrown = error; }
    expect(thrown?.digest).toBe(BAILOUT);

    // A stream reports it as a shell error: no HTML at all.
    const shell = await stream(<Car store={store} />).then(() => null, (error) => error);
    expect(shell?.digest).toBe(BAILOUT);
    await flush();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("reading `loading` alone does not bail out: the component renders its own skeleton", async () => {
    const { store, resolver } = usersStore();
    function Skeleton() {
      const form = useForm(store) as any;
      return form.users.loading ? <em>skeleton</em> : <ul>{form.users.items.length}</ul>;
    }
    const { html, errors } = await stream(<Suspense fallback={<i>users-fallback</i>}><Skeleton /></Suspense>);
    await flush();

    expect(html).toContain("<em>skeleton</em>");
    expect(html).not.toContain("<i>users-fallback</i>");
    expect(errors).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("suspense: true in server mode, nothing to wait for", () => {
  it("a group waiting for its contextDeps renders its defaults: no bailout, no fallback", async () => {
    const { store, resolver } = carStore({}, { contextDeps: ["accountId"] });
    const { html, errors } = await stream(carPage(store));
    await flush();

    expect(html).toContain("<b>no brand</b>");
    expect(html).not.toContain("<i>car-fallback</i>");
    expect(errors).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("once store.start() brought the data, the content is rendered", async () => {
    const car = carStore();
    const users = usersStore();
    renderToString(carPage(car.store)); // the read that makes the lazy run due
    renderToString(usersPage(users.store));
    car.store.start();
    users.store.start();
    await flush();

    const carOut = await stream(carPage(car.store));
    expect(carOut.html).toContain("<b>Toyota</b>");
    expect(carOut.errors).toEqual([]);
    const usersOut = await stream(usersPage(users.store));
    expect(usersOut.html).toContain("<ul><li>Alice</li></ul>");
    expect(usersOut.errors).toEqual([]);
    expect(car.resolver).toHaveBeenCalledTimes(1);
    expect(users.resolver).toHaveBeenCalledTimes(1);
  });
});

describe("suspense: true with server: false in Node", () => {
  it("a group: no bailout error; the first read renders the defaults and starts the run, as on the client", async () => {
    const { store, resolver } = carStore({ server: false });
    const { html, errors } = await stream(carPage(store));
    await flush();

    expect(errors).toEqual([]);
    expect(html).toContain("<b>no brand</b>");
    expect(html).not.toContain("<i>car-fallback</i>");
    expect(html).not.toContain(CLIENT_RENDERED);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("a list: no bailout error; the first read renders the empty list and starts the run", async () => {
    const { store, resolver } = usersStore({ server: false });
    const { html, errors } = await stream(usersPage(store));
    await flush();

    expect(errors).toEqual([]);
    expect(html).toContain("<ul></ul>");
    expect(html).not.toContain("<i>users-fallback</i>");
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
