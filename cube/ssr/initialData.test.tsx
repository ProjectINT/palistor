/**
 * The `initialData` constructor option (experiments/SsrPlan.md, Stage 3), Cube
 * only: results the server already has, in the shape of `store.getValues()`.
 *
 *  A. Acceptance criterion: a store given `initialData: X` is in the state of
 *     a store whose resolver returned `X` — values, dirty baseline, resolve
 *     status, list membership, and what `reset()` returns to. One test per
 *     kind of node with `resolve`: a leaf, a group, a list.
 *  B. Server render and hydration: the HTML carries the data, no resolver is
 *     called on either side, React reports no mismatch.
 *  C. What the data does not reach: a key it lacks, and a group resolve when
 *     the data holds only lists.
 *  D. Dev warnings: a key that is not in the config, a row without an id.
 *
 * jsdom has `window`, so the server store asks for `server: true`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Palistor, defineList, useForm } from "../index";
import { cubeOf } from "../core";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A list node answers `resolveStatus` itself; a leaf and a group answer it through their cube. */
const statusOf = (node: unknown): string => (cubeOf(node) as any).resolveStatus;

const idsOf = (list: any): string[] => list.items.map((item: any) => item.id);

/** Both stores answer `read` the same way, and the answer is `expected`. */
function expectSameState<T>(seeded: any, fetched: any, read: (store: any) => T, expected: T) {
  expect(read(seeded)).toEqual(expected);
  expect(read(fetched)).toEqual(expected);
}

// ─── A. Acceptance criterion ─────────────────────────────────────────────────

describe("initialData: X leaves the state the resolver's result X leaves", () => {
  it("a leaf with resolve", async () => {
    const X = "Server title";
    const make = (options: Record<string, unknown> = {}) => {
      const resolver = vi.fn(async () => X);
      const store = new Palistor({
        config: { title: { value: "", resolve: { resolver, onError: vi.fn() } }, note: { value: "n" } },
        ...options,
      } as any) as any;
      return { store, resolver };
    };
    const seeded = make({ initialData: { title: X } });
    const fetched = make();
    void fetched.store.proxy.title.value;
    await flush();
    expect(fetched.resolver).toHaveBeenCalledTimes(1);

    const read = (store: any) => ({
      values: store.getValues(),
      dirty: store.proxy.dirty,
      titleDirty: store.proxy.title.dirty,
      status: statusOf(store.proxy.title),
      loading: store.proxy.title.loading,
    });
    const loaded = { values: { title: X, note: "n" }, dirty: false, titleDirty: false, status: "resolved", loading: false };
    expectSameState(seeded.store, fetched.store, read, loaded);

    for (const { store } of [seeded, fetched]) {
      store.proxy.title.value = "edited";
      expect(store.proxy.title.dirty).toBe(true);
      store.reset();
    }
    expectSameState(seeded.store, fetched.store, read, loaded);

    await flush();
    expect(seeded.resolver).not.toHaveBeenCalled();
    expect(fetched.resolver).toHaveBeenCalledTimes(1);
  });

  it("a group with resolve (a partial result: the other leaves keep their defaults)", async () => {
    const X = { brand: "Toyota", engine: { hp: 150 } };
    const make = (options: Record<string, unknown> = {}) => {
      const resolver = vi.fn(async () => X);
      const store = new Palistor({
        config: {
          owner: { value: "o" },
          car: {
            resolve: { resolver, onError: vi.fn() },
            brand: { value: "" },
            model: { value: "no model" },
            engine: { hp: { value: 0 }, fuel: { value: "petrol" } },
          },
        },
        ...options,
      } as any) as any;
      return { store, resolver };
    };
    const seeded = make({ initialData: { car: X } });
    const fetched = make();
    void fetched.store.proxy.car.brand.value;
    await flush();
    expect(fetched.resolver).toHaveBeenCalledTimes(1);

    const read = (store: any) => ({
      values: store.getValues(),
      dirty: store.proxy.dirty,
      carDirty: store.proxy.car.dirty,
      status: statusOf(store.proxy.car),
      loading: store.proxy.car.loading,
    });
    const loaded = {
      values: { owner: "o", car: { brand: "Toyota", model: "no model", engine: { hp: 150, fuel: "petrol" } } },
      dirty: false,
      carDirty: false,
      status: "resolved",
      loading: false,
    };
    expectSameState(seeded.store, fetched.store, read, loaded);

    for (const { store } of [seeded, fetched]) {
      store.proxy.car.brand.value = "edited";
      store.proxy.car.engine.hp.value = 1;
      store.proxy.car.model.value = "edited too";
      expect(store.proxy.car.dirty).toBe(true);
      store.reset();
    }
    expectSameState(seeded.store, fetched.store, read, loaded);

    await flush();
    expect(seeded.resolver).not.toHaveBeenCalled();
    expect(fetched.resolver).toHaveBeenCalledTimes(1);
  });

  it("a list with resolve", async () => {
    const X = [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
    const make = (options: Record<string, unknown> = {}) => {
      const resolver = vi.fn(async () => X);
      const store = new Palistor({
        config: {
          users: defineList<any>({
            template: { id: { value: "" }, name: { value: "" }, role: { value: "user" } },
            resolve: { resolver, onError: vi.fn() } as any,
          }),
        },
        ...options,
      } as any) as any;
      return { store, resolver };
    };
    const seeded = make({ initialData: { users: X } });
    const fetched = make();
    void fetched.store.proxy.users.items;
    await flush();
    expect(fetched.resolver).toHaveBeenCalledTimes(1);

    const read = (store: any) => {
      const users = store.proxy.users;
      return {
        values: store.getValues(),
        ids: idsOf(users),
        length: users.length,
        registry: ["u1", "u2"].map((id) => store.entityRegistry.get(id)),
        dirty: store.proxy.dirty,
        listDirty: users.dirty,
        rowDirty: users.getById("u1").dirty,
        status: users.resolveStatus,
        loading: users.loading,
      };
    };
    const loaded = {
      // A row key the data lacks reads the template default, as after a resolve.
      values: { users: [{ id: "u1", name: "Alice", role: "user" }, { id: "u2", name: "Bob", role: "user" }] },
      ids: ["u1", "u2"],
      length: 2,
      registry: X,
      dirty: false,
      listDirty: false,
      rowDirty: false,
      status: "resolved",
      loading: false,
    };
    expectSameState(seeded.store, fetched.store, read, loaded);

    // A row edit is dirty against the data; the row's reset returns to it.
    for (const { store } of [seeded, fetched]) {
      const row = store.proxy.users.getById("u1");
      row.name.value = "edited";
      expect(row.dirty).toBe(true);
      row.reset();
    }
    expectSameState(seeded.store, fetched.store, read, loaded);

    // The membership baseline is the data's ids: a removal and an addition make the list dirty.
    // Whatever the form reset then does with a root list, it does the same in both stores.
    const edit = (store: any) => {
      const users = store.proxy.users;
      users.remove("u2");
      users.add({ id: "u3", name: "Carol" });
      const dirty = { list: users.dirty, form: store.proxy.dirty };
      store.reset();
      return { dirty, afterReset: { values: store.getValues(), ids: idsOf(users), listDirty: users.dirty } };
    };
    const seededEdit = edit(seeded.store);
    expect(seededEdit.dirty).toEqual({ list: true, form: true });
    expect(seededEdit).toEqual(edit(fetched.store));

    await flush();
    expect(seeded.resolver).not.toHaveBeenCalled();
    expect(fetched.resolver).toHaveBeenCalledTimes(1);
  });
});

// ─── B. Server render and hydration ──────────────────────────────────────────

const PAGE_DATA = {
  title: "Server title",
  car: { brand: "Toyota" },
  users: [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }],
};

/** A lazy leaf, an eager group and a lazy list, each with a resolver that would answer something else. */
function pageStore(options: Record<string, unknown> = {}) {
  const resolvers = {
    title: vi.fn(async () => "fetched title"),
    car: vi.fn(async () => ({ brand: "fetched brand" })),
    users: vi.fn(async () => [{ id: "f1", name: "fetched user" }]),
  };
  const store = new Palistor({
    config: {
      title: { value: "", resolve: { resolver: resolvers.title, onError: vi.fn() } },
      car: {
        resolve: { resolver: resolvers.car, onError: vi.fn(), options: { lazy: false } },
        brand: { value: "no brand" },
      },
      users: defineList<any>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver: resolvers.users, onError: vi.fn() } as any,
      }),
    },
    ...options,
  } as any) as any;
  return { store, resolvers };
}

function Page({ store }: { store: unknown }) {
  const form = useForm(store as any) as any;
  return (
    <main>
      <h1 data-loading={String(form.title.loading)}>{form.title.value}</h1>
      <p data-loading={String(form.car.loading)}>{form.car.brand.value}</p>
      {form.users.loading
        ? <em>users-skeleton</em>
        : <ul>{form.users.items.map((user: any) => <li key={user.id}>{user.name.value}</li>)}</ul>}
    </main>
  );
}

const PAGE_HTML =
  '<main><h1 data-loading="false">Server title</h1><p data-loading="false">Toyota</p>' +
  "<ul><li>Alice</li><li>Bob</li></ul></main>";

describe("initialData under server render and hydration", () => {
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

  async function hydrate(clientOptions: Record<string, unknown>) {
    const server = pageStore({ server: true, initialData: PAGE_DATA });
    const html = renderToString(<Page store={server.store} />);
    container.innerHTML = html;
    const sent = container.firstElementChild;
    const client = pageStore(clientOptions);
    await act(async () => {
      root = hydrateRoot(container, <Page store={client.store} />, { onRecoverableError });
      await flush();
    });
    return { server, client, html, sent };
  }

  it("the server's HTML carries the data with loading false, and no resolver is called", async () => {
    const server = pageStore({ server: true, initialData: PAGE_DATA });
    expect(renderToString(<Page store={server.store} />)).toBe(PAGE_HTML);
    await flush();
    for (const resolver of Object.values(server.resolvers)) expect(resolver).not.toHaveBeenCalled();

    // Nothing was held back for start(): the eager group has its result as well.
    server.store.start();
    await flush();
    for (const resolver of Object.values(server.resolvers)) expect(resolver).not.toHaveBeenCalled();
    expect(server.store.getValues()).toEqual(PAGE_DATA);
  });

  it("a client store given the same data hydrates the HTML: no mismatch, no request after hydration", async () => {
    const { server, client, html, sent } = await hydrate({ initialData: PAGE_DATA });
    expect(html).toBe(PAGE_HTML);
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    await act(async () => { await flush(); });
    for (const resolver of Object.values(client.resolvers)) expect(resolver).not.toHaveBeenCalled();
    for (const resolver of Object.values(server.resolvers)) expect(resolver).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(PAGE_HTML);
    expect(client.store.proxy.dirty).toBe(false);
  });

  it("control: a client store without the data is reported, so the check above can fail", async () => {
    const { client } = await hydrate({});
    expect(onRecoverableError).toHaveBeenCalled();
    expect(client.resolvers.car).toHaveBeenCalledTimes(1);
  });
});

// ─── C. What the data does not reach ─────────────────────────────────────────

describe("initialData: what the data does not reach", () => {
  it("a key the data lacks is untouched: its value stays and its resolve runs on the first read", async () => {
    const resolvers = {
      title: vi.fn(async () => "fetched title"),
      car: vi.fn(async () => ({ brand: "fetched brand" })),
      users: vi.fn(async () => [{ id: "f1", name: "fetched user" }]),
    };
    const store = new Palistor({
      config: {
        note: { value: "default note" },
        title: { value: "", resolve: { resolver: resolvers.title, onError: vi.fn() } },
        car: { resolve: { resolver: resolvers.car, onError: vi.fn() }, brand: { value: "no brand" }, model: { value: "no model" } },
        users: defineList<any>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: resolvers.users, onError: vi.fn() } as any,
        }),
      },
      initialData: { title: "Server title" },
    } as any) as any;
    const form = store.proxy;

    expect(store.getValues()).toEqual({
      note: "default note",
      title: "Server title",
      car: { brand: "no brand", model: "no model" },
      users: [],
    });
    expect(statusOf(form.title)).toBe("resolved");
    expect(statusOf(form.car)).toBe("idle");
    expect(form.users.resolveStatus).toBe("idle");

    void form.title.value;
    void form.car.brand.value;
    void form.users.items;
    await flush();
    expect(resolvers.title).not.toHaveBeenCalled();
    expect(resolvers.car).toHaveBeenCalledTimes(1);
    expect(resolvers.users).toHaveBeenCalledTimes(1);
    expect(store.getValues()).toEqual({
      note: "default note",
      title: "Server title",
      car: { brand: "fetched brand", model: "no model" },
      users: [{ id: "f1", name: "fetched user" }],
    });
  });

  it("the data is applied over initialValues, and both are the baseline reset() returns to", () => {
    const store = new Palistor({
      config: { name: { value: "" }, email: { value: "" }, car: { brand: { value: "" }, model: { value: "" } } },
      initialValues: { name: "Initial name", email: "initial@x", car: { brand: "Initial brand", model: "Initial model" } },
      initialData: { email: "server@x", car: { brand: "Server brand" } },
    } as any) as any;
    const loaded = { name: "Initial name", email: "server@x", car: { brand: "Server brand", model: "Initial model" } };
    expect(store.getValues()).toEqual(loaded);
    expect(store.proxy.dirty).toBe(false);

    store.setValues({ name: "a", email: "b", car: { brand: "c", model: "d" } });
    expect(store.proxy.dirty).toBe(true);
    store.reset();
    expect(store.getValues()).toEqual(loaded);
    expect(store.proxy.dirty).toBe(false);
  });

  it("initialValues answer no resolve (that is why initialData is a separate option): the group's resolver still runs", async () => {
    const resolver = vi.fn(async () => ({ brand: "Fetched brand" }));
    const store = new Palistor({
      config: { car: { resolve: { resolver, onError: vi.fn() }, brand: { value: "" } } },
      initialValues: { car: { brand: "Initial brand" } },
    } as any) as any;
    expect(statusOf(store.proxy.car)).toBe("idle");

    expect(store.proxy.car.brand.value).toBe("Initial brand");
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(store.proxy.car.brand.value).toBe("Fetched brand");
  });

  it("data holding only lists does not mark a group with resolve as resolved: its resolver still runs", async () => {
    const resolver = vi.fn(async () => ({ name: "fetched team" }));
    const store = new Palistor({
      config: {
        team: {
          resolve: { resolver, onError: vi.fn() },
          name: { value: "" },
          members: defineList<any>({ template: { id: { value: "" }, name: { value: "" } } }),
        },
      },
      initialData: { team: { members: [{ id: "m1", name: "Alice" }] } },
    } as any) as any;
    const team = store.proxy.team;

    expect(statusOf(team)).toBe("idle");
    expect(idsOf(team.members)).toEqual(["m1"]); // the list itself got its rows
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1); // the read of `members` woke the group's lazy resolve
    expect(store.getValues()).toEqual({ team: { name: "fetched team", members: [{ id: "m1", name: "Alice" }] } });
  });

  it("the same holds for the root group", async () => {
    const resolver = vi.fn(async () => ({ title: "fetched title" }));
    const store = new Palistor({
      config: {
        resolve: { resolver, onError: vi.fn() },
        title: { value: "" },
        users: defineList<any>({ template: { id: { value: "" }, name: { value: "" } } }),
      },
      initialData: { users: [{ id: "u1", name: "Alice" }] },
    } as any) as any;

    expect(statusOf(store.proxy)).toBe("idle");
    void store.proxy.title.value;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(store.getValues()).toEqual({ title: "fetched title", users: [{ id: "u1", name: "Alice" }] });
  });
});

/**
 * A group's resolve is answered by what a group resolver returns: the value
 * of a leaf somewhere below it, outside lists. A group key by itself answers
 * nothing. Three nested resolves — the root's, `car`'s and `car.engine`'s —
 * show which of them a given data object reaches.
 */
describe("initialData: a group resolve is answered only by a leaf value below it", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  function nestedStore(initialData: Record<string, unknown>) {
    const resolvers = {
      root: vi.fn(async () => ({ title: "fetched title" })),
      car: vi.fn(async () => ({ brand: "fetched brand" })),
      engine: vi.fn(async () => ({ hp: 99 })),
    };
    const store = new Palistor({
      config: {
        resolve: { resolver: resolvers.root, onError: vi.fn() },
        title: { value: "" },
        car: {
          resolve: { resolver: resolvers.car, onError: vi.fn() },
          brand: { value: "" },
          summary: { value: (values: any) => `car: ${values.brand}` },
          engine: { resolve: { resolver: resolvers.engine, onError: vi.fn() }, hp: { value: 0 } },
        },
        team: { members: defineList<any>({ template: { id: { value: "" }, name: { value: "" } } }) },
      },
      initialData,
    } as any) as any;
    // Off the cubes: a read through the public nodes would wake the lazy resolves on the way down.
    const root = cubeOf(store.proxy) as any;
    const statuses = () => ({
      root: root.resolveStatus as string,
      car: root.find("car").resolveStatus as string,
      engine: root.find("car.engine").resolveStatus as string,
    });
    const calls = () => ({
      root: resolvers.root.mock.calls.length,
      car: resolvers.car.mock.calls.length,
      engine: resolvers.engine.mock.calls.length,
    });
    /** One read that passes all three groups, then whatever it started lands. */
    const readDown = async () => {
      void store.proxy.car.engine.hp.value;
      await flush();
    };
    return { store, statuses, calls, readDown };
  }

  it("a list inside a sub-group is still only a list: the root stays idle and its resolver runs on read", async () => {
    const { store, statuses, calls, readDown } = nestedStore({ team: { members: [{ id: "m1", name: "Alice" }] } });
    expect(statuses()).toEqual({ root: "idle", car: "idle", engine: "idle" });
    await flush();
    expect(calls()).toEqual({ root: 0, car: 0, engine: 0 }); // lazy: nothing was read yet

    await readDown();
    expect(calls()).toEqual({ root: 1, car: 1, engine: 1 });
    expect(store.getValues()).toEqual({
      title: "fetched title",
      car: { brand: "fetched brand", summary: "car: fetched brand", engine: { hp: 99 } },
      team: { members: [{ id: "m1", name: "Alice" }] },
    });
  });

  it.each([
    ["an empty group", { car: {} }, 0],
    ["a group holding an empty group", { car: { engine: {} } }, 0],
    ["a group holding only an unknown key (which still warns)", { car: { unknown: 1 } }, 1],
    ["a leaf key set to undefined", { car: { brand: undefined } }, 0],
    ["a computed leaf, which takes no value", { car: { summary: "ignored" } }, 0],
  ])("%s answers no resolve: every resolver still runs on read", async (_title, data, warnings) => {
    const { store, statuses, calls, readDown } = nestedStore(data);
    expect(statuses()).toEqual({ root: "idle", car: "idle", engine: "idle" });
    expect(warn).toHaveBeenCalledTimes(warnings);
    if (warnings) expect(warn.mock.calls[0][0]).toBe('[palistor] initialData: "car.unknown" is not in the config; ignored.');

    await readDown();
    expect(calls()).toEqual({ root: 1, car: 1, engine: 1 });
    expect(store.getValues().car).toEqual({ brand: "fetched brand", summary: "car: fetched brand", engine: { hp: 99 } });
  });

  it("a leaf two levels down answers every resolve above it: its own group's, `car`'s and the root's", async () => {
    const { store, statuses, calls, readDown } = nestedStore({ car: { engine: { hp: 150 } } });
    expect(statuses()).toEqual({ root: "resolved", car: "resolved", engine: "resolved" });

    await readDown();
    expect(calls()).toEqual({ root: 0, car: 0, engine: 0 });
    expect(store.getValues()).toEqual({
      title: "",
      car: { brand: "", summary: "car: ", engine: { hp: 150 } },
      team: { members: [] },
    });
    expect(store.proxy.dirty).toBe(false);
  });

  it("a leaf of the group itself answers that group and the ones above, not the one below", async () => {
    const { statuses, calls, readDown } = nestedStore({ car: { brand: "Toyota" } });
    expect(statuses()).toEqual({ root: "resolved", car: "resolved", engine: "idle" });

    await readDown();
    expect(calls()).toEqual({ root: 0, car: 0, engine: 1 });
  });
});

// ─── D. Dev warnings ─────────────────────────────────────────────────────────

describe("initialData: dev warnings", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  const config = () => ({
    title: { value: "" },
    car: { brand: { value: "" } },
    users: defineList<any>({ template: { id: { value: "" }, name: { value: "" } } }),
  });

  it("data that matches the config warns about nothing", () => {
    new Palistor({ config: config(), initialData: PAGE_DATA } as any);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a key that is not in the config is named by its path and ignored", () => {
    const store = new Palistor({
      config: config(),
      initialData: { title: "Server title", nope: 1, car: { brand: "Toyota", wheels: 4 } },
    } as any) as any;
    const messages = warn.mock.calls.map((call: unknown[]) => call[0]);
    expect(messages).toHaveLength(2);
    expect(messages).toContain('[palistor] initialData: "nope" is not in the config; ignored.');
    expect(messages).toContain('[palistor] initialData: "car.wheels" is not in the config; ignored.');
    expect(store.getValues()).toEqual({ title: "Server title", car: { brand: "Toyota" }, users: [] });
  });

  it.each([
    ["an array", [{ title: "Server title" }]],
    ["a string", "Server title"],
    ["a number", 42],
  ])("initialData that is not an object (%s) is reported and ignored", (_title, initialData) => {
    const store = new Palistor({ config: config(), initialData } as any) as any;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[palistor] initialData must be an object in the shape of getValues(); ignored.");
    expect(store.getValues()).toEqual({ title: "", car: { brand: "" }, users: [] });
    expect(store.proxy.dirty).toBe(false);
  });

  it("a row without an id is reported once per list: its temporary id differs between server and client", () => {
    const make = () => new Palistor({
      config: config(),
      initialData: { users: [{ id: "u1", name: "Alice" }, { name: "Anonymous" }, { id: "", name: "Blank id" }] },
    } as any) as any;
    const store = make();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[palistor\] initialData: a row of list "users" has no id\./);

    const ids = idsOf(store.proxy.users);
    expect(ids[0]).toBe("u1");
    expect(ids[1]).toMatch(/^_tmp_/);
    expect(ids[2]).toMatch(/^_tmp_/);
    expect(store.proxy.users.items.map((item: any) => item.name.value)).toEqual(["Alice", "Anonymous", "Blank id"]);

    // What the warning is about: a second store built from the same data (the client's) gets other ids.
    const client = idsOf(make().proxy.users);
    expect(client[0]).toBe("u1");
    expect(client[1]).not.toBe(ids[1]);
  });
});
