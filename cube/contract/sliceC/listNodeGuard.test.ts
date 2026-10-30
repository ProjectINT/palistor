/**
 * List nodes in a config: the public rules behind store/store/listNodeGuard.test.ts
 * and store/store/listStateInit.test.ts.
 *
 * Both originals drove the store kernel's walkers (registerNodes, buildNodeMaps,
 * buildValuesCache, applyPatch, collectDefaults, …) one by one. What they
 * guarded, seen from the outside: a config holding list nodes (arrays of
 * length 1 or 2) constructs, the lists start empty and clean, the regular
 * fields next to them keep working, values / patches / reset / submit skip the
 * lists, nested and multiple lists are independent, and the list config
 * (array[1]) is honored.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

const makeConfigWithList1 = () => ({
  name: { value: "" },
  users: [{ id: { value: "" }, title: { value: "" } }],
});

const makeConfigWithList2 = (resolver = async () => [] as any[]) => ({
  name: { value: "" },
  users: [
    { id: { value: "" }, title: { value: "" } },
    { resolve: { resolver, onError: vi.fn() } },
  ],
});

describe("a config with a list node constructs", () => {
  it("length-1 list node: the regular field works, the list is empty and clean", () => {
    const store = new Palistor({ config: makeConfigWithList1() as any });
    const form = store.proxy as any;

    expect(form.name.value).toBe("");
    expect(form.users.length).toBe(0);
    expect(form.users.items).toEqual([]);
    expect(form.users.dirty).toBe(false);
    expect(form.users.loading).toBe(false);
    expect(form.dirty).toBe(false);
  });

  it("length-2 list node (template + list config): same, with the resolve config attached", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", title: "One" }]);
    const store = new Palistor({ config: makeConfigWithList2(resolver) as any });
    const form = store.proxy as any;

    expect(form.name.value).toBe("");
    expect(form.users.length).toBe(0);
    expect(form.users.resolveStatus).toBe("idle");

    void form.users.items; // the resolver from array[1] is honored
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(form.users.items[0].title.value).toBe("One");
  });

  it("a template leaf's config value is the default of every item's field", () => {
    const store = new Palistor({
      config: { items: [{ id: { value: "default-id" }, title: { value: "default-title" } }] } as any,
    });
    (store.proxy as any).items.add({ id: "i1" });
    expect((store.proxy as any).items.items[0].title.value).toBe("default-title");
  });
});

describe("values, patches and reset skip the list node", () => {
  it("getValues() initialises the list as an empty array, next to the regular fields", () => {
    const store = new Palistor({ config: makeConfigWithList1() as any });
    (store.proxy as any).name.value = "Alice";
    expect(store.getValues()).toEqual({ name: "Alice", users: [] });
  });

  it("setValues() applies the regular fields and ignores the list key in the patch", () => {
    const store = new Palistor({ config: makeConfigWithList1() as any });
    expect(() => store.setValues({ name: "Bob", users: [{ id: "u1" }] } as any)).not.toThrow();
    expect((store.proxy as any).name.value).toBe("Bob");
    expect((store.proxy as any).users.length).toBe(0);
  });

  it("reset() restores the regular fields and leaves the root list membership alone", () => {
    const store = new Palistor({ config: makeConfigWithList1() as any });
    (store.proxy as any).name.value = "Bob";
    (store.proxy as any).users.add({ id: "u1", title: "One" });

    store.reset();

    expect((store.proxy as any).name.value).toBe("");
    expect((store.proxy as any).users.length).toBe(1);
  });

  it("the list membership counts towards dirty, the regular fields keep theirs", () => {
    const store = new Palistor({ config: makeConfigWithList1() as any });
    (store.proxy as any).name.value = "changed";
    expect((store.proxy as any).dirty).toBe(true);
    expect((store.proxy as any).users.dirty).toBe(false);
    (store.proxy as any).name.value = "";
    expect((store.proxy as any).dirty).toBe(false);
  });

  it("submit() validates the regular fields and sends the list as plain rows", async () => {
    const onSubmit = vi.fn();
    const store = new Palistor({
      config: {
        name: { value: "", isRequired: true },
        users: [{ id: { value: "" }, title: { value: "" } }],
        onSubmit,
      } as any,
    });
    (store.proxy as any).users.add({ id: "u1", title: "One" });

    const failed = await store.submit();
    expect(failed.success).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    (store.proxy as any).name.value = "Alice";
    const ok = await store.submit();
    expect(ok.success).toBe(true);
    expect(onSubmit.mock.calls[0][0]).toEqual({ name: "Alice", users: [{ id: "u1", title: "One" }] });
  });
});

describe("nested and multiple list nodes", () => {
  it("a list inside a group is reachable at its path", () => {
    const store = new Palistor({
      config: {
        section: {
          title: { value: "Section" },
          users: [{ id: { value: "" } }],
        },
      } as any,
    });
    const form = store.proxy as any;
    expect(form.section.title.value).toBe("Section");
    expect(form.section.users.length).toBe(0);
    form.section.users.add({ id: "u1" });
    expect(form.section.users.items[0].id).toBe("u1");
    expect(store.getValues()).toEqual({ section: { title: "Section", users: [{ id: "u1" }] } });
  });

  it("several lists in one config are independent", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" } }],
        categories: [{ id: { value: "" }, code: { value: "" }, title: { value: "" } }],
      } as any,
    });
    const form = store.proxy as any;
    form.users.add({ id: "u1" });
    form.categories.add({ id: "c1", code: "A", title: "Alpha" });

    expect(form.users.length).toBe(1);
    expect(form.categories.length).toBe(1);
    expect(form.users).not.toBe(form.categories);
    expect(form.categories.items[0].code.value).toBe("A");
    expect(form.users.getValues()).toEqual([{ id: "u1" }]);
  });
});
