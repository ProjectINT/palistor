/**
 * `usePersist` over `initialData` (experiments/SsrPlan.md, Stage 3), Cube
 * only. The two meet in a fixed order: the constructor applies the server's
 * data, so the first render (and hydration) shows it; `usePersist` reads the
 * storage in an effect, after mount, and lays the saved draft over it.
 *
 * The draft wins where it has a value, the data stays where it has none. The
 * data remains the dirty baseline, so the restored form is dirty and `reset()`
 * returns to what the server sent. A stored list replaces the membership.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Palistor, defineList, useForm, usePersist } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const idsOf = (list: any): string[] => list.items.map((item: any) => item.id);

/** An in-memory storage driver, optionally holding a saved snapshot under "form". */
function memoryDriver(stored?: unknown) {
  const storage = new Map<string, string>();
  if (stored !== undefined) storage.set("form", JSON.stringify(stored));
  return {
    storage,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  };
}

const saved = (driver: { storage: Map<string, string> }) => {
  const raw = driver.storage.get("form");
  return raw === undefined ? undefined : JSON.parse(raw);
};

const SERVER = {
  email: "server@x",
  name: "Server name",
  car: { brand: "Toyota" },
  users: [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }],
};

/** The draft a user left: one field, one group leaf, and a list with a renamed row, a new row and one row removed. */
const DRAFT = {
  email: "draft@x",
  car: { brand: "Draft brand" },
  users: [{ id: "u2", name: "Bob (draft)" }, { id: "u9", name: "New" }],
};

/** `car` and `users` have resolvers: their results come as initialData. */
function formStore(options: Record<string, unknown> = {}) {
  const resolvers = {
    car: vi.fn(async () => ({ brand: "fetched brand" })),
    users: vi.fn(async () => [{ id: "f1", name: "fetched user" }]),
  };
  const store = new Palistor({
    config: {
      email: { value: "" },
      name: { value: "" },
      car: { resolve: { resolver: resolvers.car, onError: vi.fn() }, brand: { value: "" } },
      users: defineList<any>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver: resolvers.users, onError: vi.fn() } as any,
      }),
    },
    initialData: SERVER,
    ...options,
  } as any) as any;
  return { store, resolvers };
}

type Driver = ReturnType<typeof memoryDriver>;

function Form({ store, driver }: { store: any; driver: Driver }) {
  usePersist(store, { key: "form", driver, debounce: 0 });
  const form = useForm(store) as any;
  return (
    <form>
      <span data-testid="email">{form.email.value}</span>
      <span data-testid="name">{form.name.value}</span>
      <span data-testid="brand">{form.car.brand.value}</span>
      <ul data-testid="users">{form.users.map((user: any) => <li key={user.id}>{user.name.value}</li>)}</ul>
    </form>
  );
}

const shown = () => ({
  email: screen.getByTestId("email").textContent,
  name: screen.getByTestId("name").textContent,
  brand: screen.getByTestId("brand").textContent,
  users: [...screen.getByTestId("users").querySelectorAll("li")].map((li) => li.textContent),
});

/** Mounts the form and lets usePersist's hydration land. */
async function mount(stored?: unknown) {
  const driver = memoryDriver(stored);
  const made = formStore();
  render(<Form store={made.store} driver={driver} />);
  const firstRender = shown();
  await act(async () => { await flush(); });
  return { ...made, driver, firstRender };
}

afterEach(cleanup);

describe("usePersist over initialData", () => {
  it("the first render shows the server's data; after mount the saved draft is laid over it", async () => {
    const { store, firstRender } = await mount(DRAFT);
    expect(firstRender).toEqual({ email: "server@x", name: "Server name", brand: "Toyota", users: ["Alice", "Bob"] });
    // Stored values win; `name`, which the draft lacks, keeps the server's value.
    expect(shown()).toEqual({ email: "draft@x", name: "Server name", brand: "Draft brand", users: ["Bob (draft)", "New"] });
    expect(store.getValues()).toEqual({
      email: "draft@x",
      name: "Server name",
      car: { brand: "Draft brand" },
      users: [{ id: "u2", name: "Bob (draft)" }, { id: "u9", name: "New" }],
    });
  });

  it("the restored form is dirty against the server's data, and reset() returns to it", async () => {
    const { store } = await mount(DRAFT);
    const form = store.proxy;
    expect(form.dirty).toBe(true);
    expect(form.email.dirty).toBe(true);
    expect(form.car.dirty).toBe(true);
    expect(form.name.dirty).toBe(false);

    act(() => store.reset());
    expect(form.dirty).toBe(false);
    expect(store.getValues()).toMatchObject({ email: "server@x", name: "Server name", car: { brand: "Toyota" } });
    expect(shown()).toMatchObject({ email: "server@x", name: "Server name", brand: "Toyota" });
  });

  it("a stored list replaces the initial membership; a stored row is merged over the server's row", async () => {
    const { store } = await mount(DRAFT);
    const users = store.proxy.users;
    expect(idsOf(users)).toEqual(["u2", "u9"]);
    expect(users.dirty).toBe(false); // the restored membership is the list's baseline, as after any persist hydration

    // The row the server also sent is dirty against the server's version, and resets to it.
    expect(users.getById("u2").dirty).toBe(true);
    expect(users.getById("u9").dirty).toBe(false);
    act(() => users.getById("u2").reset());
    expect(users.getById("u2").name.value).toBe("Bob");
    expect(shown().users).toEqual(["Bob", "New"]);
  });

  it("the resolves that got initialData stay resolved under the draft: no resolver is called", async () => {
    const { store, resolvers } = await mount(DRAFT);
    expect(store.proxy.users.resolveStatus).toBe("resolved");
    expect(store.proxy.car.loading).toBe(false);
    await act(async () => { await flush(); });
    expect(resolvers.car).not.toHaveBeenCalled();
    expect(resolvers.users).not.toHaveBeenCalled();
  });

  it("with nothing stored the server's data stays, not dirty, and the next edit is saved on top of it", async () => {
    const { store, driver, firstRender } = await mount();
    expect(shown()).toEqual(firstRender);
    expect(store.getValues()).toEqual(SERVER);
    expect(store.proxy.dirty).toBe(false);

    await act(async () => {
      store.proxy.name.value = "Typed name";
      await flush();
    });
    expect(saved(driver)).toMatchObject({ ...SERVER, name: "Typed name" });
  });
});

describe("usePersist over initialData, hydrating server HTML", () => {
  let container: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("hydration sees the server's data (no mismatch); the draft lands after it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRecoverableError = vi.fn();
    try {
      const server = formStore({ server: true });
      const html = renderToString(<Form store={server.store} driver={memoryDriver(DRAFT)} />);
      expect(html).toContain("server@x");
      expect(html).not.toContain("draft@x"); // the server never reads the storage

      container = document.createElement("div");
      document.body.appendChild(container);
      container.innerHTML = html;
      const client = formStore();
      await act(async () => {
        root = hydrateRoot(container!, <Form store={client.store} driver={memoryDriver(DRAFT)} />, { onRecoverableError });
        await flush();
      });

      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(shown()).toEqual({ email: "draft@x", name: "Server name", brand: "Draft brand", users: ["Bob (draft)", "New"] });
      expect(client.store.proxy.dirty).toBe(true);
      expect(client.resolvers.car).not.toHaveBeenCalled();
      expect(client.resolvers.users).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
