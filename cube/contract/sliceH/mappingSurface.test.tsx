/**
 * fieldMapping surface beyond store's fieldMapping tests. New in the contract
 * (Phase 2.6); every case is what store's proxies do by design (each GET/SET
 * went through `externalToInternal`, each ownKeys through `fieldMapping`) and
 * is green on store:
 *
 *  - list items (entity nodes) and the leaves reached through them answer and
 *    spread the external names; so does the useForm(entity, template) view;
 *  - an entity leaf write through a renamed `value` lands in the row;
 *  - a renamed `onValueChange` is the same stable setter;
 *  - `{ isInvalid: "error" }`: a group's `error` is its validity flag, a
 *    list's `error` stays the resolve error;
 *  - pagination getters are not mappable: a paginated list keeps `isFetching`
 *    next to a mapped `loading`;
 *  - a function label renamed to `caption` follows the translator like `label`;
 *  - useForm tracks a read by the external name: a mapped group `isDirty`, a
 *    mapped list `isLoading` and an entity leaf's `error` / `helperText`
 *    re-render the component that read them;
 *  - child identity is never remapped: getValues, submit payloads and the
 *    filter's values keep the config's child keys.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Palistor, defineFieldMapping, defineList, useForm } from "@impl";

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

const mapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
  dirty: "isDirty",
  loading: "isLoading",
});

type User = { id: string; name: string };

function makeUsers(resolver = vi.fn(async () => [{ id: "u1", name: "Ann" }, { id: "u2", name: "Bob" }])) {
  const store = new Palistor({
    config: {
      users: defineList<User>({
        template: {
          id: { value: "" },
          name: { value: "", required: true, helpText: "Full name" } as any,
        },
        resolve: { resolver },
      }),
      editUser: {
        id: { value: "" },
        name: { value: "", required: true, helpText: "Edit name" } as any,
      },
    } as any,
    fieldMapping: mapping,
  });
  return { store, resolver, users: (store.proxy as any).users };
}

describe("entity nodes", () => {
  it("a list item spreads and answers the external names; the internal ones stay readable", async () => {
    const { users } = makeUsers();
    void users.items;
    await flushPromises();
    const item = users.items[0];

    const keys = Object.keys(item);
    expect(keys).toEqual(["id", "name", "isLoading", "submitting", "submit", "values", "isDirty"]);
    expect(item.isDirty).toBe(false);
    expect(item.isLoading).toBe(false);

    item.name.value = "Anna";
    expect(item.isDirty).toBe(true);
    expect(item.dirty).toBe(true);
    expect(users.getById("u1").isDirty).toBe(true);
  });

  it("a leaf reached through an item spreads the external names", async () => {
    const { users } = makeUsers();
    void users.items;
    await flushPromises();
    const name = users.items[0].name;

    const keys = Object.keys({ ...name });
    expect(keys).toContain("required");
    expect(keys).toContain("helpText");
    expect(keys).toContain("helperText");
    expect(keys).toContain("error");
    expect(keys).toContain("isDirty");
    expect(keys).toContain("isLoading");
    expect(keys).not.toContain("isRequired");
    expect(keys).not.toContain("description");
    expect(keys).not.toContain("errorMessage");
    expect(keys).not.toContain("dirty");

    expect(name.required).toBe(true);
    expect(name.helpText).toBe("Full name");
    expect(name.isRequired).toBe(true);
    expect(name.description).toBe("Full name");
    name.value = "Anna";
    expect(name.isDirty).toBe(true);
  });

  it("the useForm(entity, template) view answers the external names of its template", async () => {
    const { store, users } = makeUsers();
    void users.items;
    await flushPromises();
    const { result } = renderHook(() => useForm(users.items[1], (s: any) => s.editUser));

    expect(result.current.name.value).toBe("Bob");
    expect(result.current.name.helpText).toBe("Edit name");
    expect(result.current.name.required).toBe(true);
    expect(Object.keys(result.current)).toContain("isDirty");

    act(() => { result.current.name.value = "Bobby"; });
    expect(result.current.isDirty).toBe(true);
    expect((store.proxy as any).users.getById("u2").name.value).toBe("Bobby");
  });

  it("a write through a renamed value lands in the row", async () => {
    const store = new Palistor({
      config: { users: defineList<User>({ template: { id: { val: "" }, name: { val: "" } } as any }) } as any,
      fieldMapping: { value: "val" },
    });
    const users = (store.proxy as any).users;
    users.add({ id: "u1", name: "Ann" });
    const name = users.items[0].name;
    expect(name.val).toBe("Ann");
    name.val = "Anna";
    expect(name.val).toBe("Anna");
    expect(name.value).toBe("Anna");
    expect(users.getValues()).toEqual([{ id: "u1", name: "Anna" }]);
    expect(Object.keys({ ...name })).toContain("val");
    expect(Object.keys({ ...name })).not.toContain("value");
  });
});

describe("leaves and groups", () => {
  it("a renamed onValueChange is the same stable setter", () => {
    const store = new Palistor({
      config: { email: { value: "" } },
      fieldMapping: { onValueChange: "onUpdate" },
    });
    const email = store.proxy.email as any;
    expect(typeof email.onUpdate).toBe("function");
    expect(email.onUpdate).toBe(email.onUpdate);
    expect(email.onUpdate).toBe(email.onValueChange);
    email.onUpdate("a@b.c");
    expect(email.value).toBe("a@b.c");
    const keys = Object.keys({ ...email });
    expect(keys).toContain("onUpdate");
    expect(keys).not.toContain("onValueChange");
  });

  it("{ isInvalid: 'error' }: a group's error is its validity flag, a list's error stays the resolve error", async () => {
    const store = new Palistor({
      config: {
        profile: {
          name: { value: "", validate: (v: string) => (v ? undefined : "required") },
        },
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: async () => { throw new Error("boom"); } },
        }),
      } as any,
      fieldMapping: { isInvalid: "error" },
    });
    const proxy = store.proxy as any;
    expect(proxy.profile.error).toBe(proxy.profile.isInvalid);
    await store.submit();
    expect(proxy.profile.name.error).toBe(true);
    expect(proxy.profile.error).toBe(proxy.profile.isInvalid);

    expect(proxy.users.error).toBeNull();
    void proxy.users.items;
    await flushPromises();
    expect(proxy.users.error).toBeInstanceOf(Error);
    expect(proxy.users.resolveStatus).toBe("error");
  });

  it("pagination getters are not mapped: isFetching sits next to a mapped loading", async () => {
    let release!: () => void;
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async () => {
              await new Promise<void>((r) => { release = r; });
              return { items: [{ id: "u1", name: "Ann" }], total: 1 };
            },
            pagination: { mode: "paged", pageSize: 10 },
          },
        }),
      } as any,
      fieldMapping: { loading: "isLoading" },
    });
    const users = (store.proxy as any).users;
    void users.items;
    await flushPromises();
    expect(users.isLoading).toBe(true);
    expect(users.isFetching).toBe(true);
    const keys = Object.keys(users);
    expect(keys).toContain("isLoading");
    expect(keys).toContain("isFetching");
    expect(keys).not.toContain("loading");
    release();
    await flushPromises();
    expect(users.isLoading).toBe(false);
    expect(users.isFetching).toBe(false);
    expect(users.items.length).toBe(1);
  });

  it("a label renamed to caption is translated like label", () => {
    const store = new Palistor({
      config: { email: { value: "", caption: (t: (k: string) => string) => t("form.email") } } as any,
      fieldMapping: { label: "caption" },
    });
    const email = store.proxy.email as any;
    expect(email.caption).toBe("form.email");
    store.setTranslator((key: string) => (key === "form.email" ? "E-mail" : key));
    expect(email.caption).toBe("E-mail");
    expect(email.label).toBe("E-mail");
    expect(Object.keys({ ...email })).toContain("caption");
    expect(Object.keys({ ...email })).not.toContain("label");
  });

  it("child identity is never remapped: getValues, the submit payload and the filter's values keep the config's keys", async () => {
    const onSubmit = vi.fn(async () => ({}));
    const store = new Palistor({
      config: {
        profile: { firstName: { value: "Jane", required: true }, onSubmit } as any,
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          filter: { search: { value: "", caption: "Search" } as any },
        }),
      } as any,
      fieldMapping: { isRequired: "required", label: "caption" },
    });
    const proxy = store.proxy as any;
    expect(store.getValues()).toEqual({ profile: { firstName: "Jane" }, users: [] });
    await proxy.profile.submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((onSubmit.mock.calls[0] as unknown[])[0]).toEqual({ firstName: "Jane" });
    expect(proxy.users.filter.values).toEqual({ search: "" });
    expect(Object.keys({ ...proxy.users.filter.search })).toContain("caption");
  });
});

describe("useForm tracks external names", () => {
  it("a mapped group isDirty re-renders the component that read it", () => {
    const store = new Palistor({
      config: { profile: { firstName: { value: "Jane" } } },
      fieldMapping: { dirty: "isDirty" },
    });
    const renders = vi.fn();
    function Comp() {
      renders();
      const form = useForm(store) as any;
      return <span data-testid="d">{String(form.profile.isDirty)}</span>;
    }
    render(<Comp />);
    expect(screen.getByTestId("d").textContent).toBe("false");
    act(() => { (store.proxy as any).profile.firstName.value = "Joan"; });
    expect(screen.getByTestId("d").textContent).toBe("true");
  });

  it("a mapped list isLoading re-renders the component that read it", async () => {
    let release!: () => void;
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async () => {
              await new Promise<void>((r) => { release = r; });
              return [{ id: "u1", name: "Ann" }];
            },
          },
        }),
      } as any,
      fieldMapping: { loading: "isLoading" },
    });
    function Comp() {
      const form = useForm(store) as any;
      return <span data-testid="l">{String(form.users.isLoading)}</span>;
    }
    render(<Comp />);
    void (store.proxy as any).users.items;
    await act(async () => { await flushPromises(); });
    expect(screen.getByTestId("l").textContent).toBe("true");
    await act(async () => { release(); await flushPromises(); });
    expect(screen.getByTestId("l").textContent).toBe("false");
  });

  it("an entity leaf's external error / helperText re-render the item component", async () => {
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: {
            id: { value: "" },
            name: { value: "", validate: (v: string) => (v ? undefined : "Name is required") },
          },
        }),
      } as any,
      fieldMapping: mapping,
    });
    const users = (store.proxy as any).users;
    users.add({ id: "u1", name: "Ann" });
    function Row({ item }: { item: any }) {
      const row = useForm(item) as any;
      return <span data-testid="e">{String(row.name.error ?? false)}|{row.name.helperText ?? "—"}</span>;
    }
    function List() {
      const form = useForm(store) as any;
      return <Row item={form.users.items[0]} />;
    }
    render(<List />);
    expect(screen.getByTestId("e").textContent).toBe("false|—");
    await act(async () => {
      users.items[0].name.value = "";
      await users.items[0].submit();
    });
    expect(screen.getByTestId("e").textContent).toBe("true|Name is required");
  });
});
