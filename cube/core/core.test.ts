/**
 * The Cube core on its own (no facade): the four README scenarios the sketch
 * was checked against in CubeExperiment.md. Contract parity lives in
 * cube/contract/; this file only guards the core between contract slices.
 */

import { describe, it, expect, vi } from "vitest";
import { Cube, Hub, type CubeConfig } from "./index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const root = (config: CubeConfig) => new Cube(config, null, "", new Hub()).node;

describe("Cube core", () => {
  it("computed isVisible follows its dependency", () => {
    const form = root({
      showAddress: { value: false },
      address: { isVisible: (v: any) => v.showAddress, city: { value: "" } },
    });

    expect(form.address.isVisible).toBe(false);
    form.showAddress.value = true;
    expect(form.address.isVisible).toBe(true);
  });

  it("write pipeline: formatter → store → setter patches a sibling", () => {
    const form = root({
      phone: {
        value: "",
        formatter: (raw: string) => raw.replace(/\D/g, ""),
        setter: (value: string) => ({ hasPhone: value.length > 0 }),
      },
      hasPhone: { value: false },
    });

    form.phone.onValueChange("+1 (555) 01");
    expect(form.phone.value).toBe("155501");
    expect(form.hasPhone.value).toBe(true);
    expect(form.dirty).toBe(true);
  });

  it("resolve: optimistic first, real after, restart when a dependency moves", async () => {
    const calls: string[] = [];
    const form = root({
      email: { value: "a@x" },
      userInfo: {
        resolve: {
          resolver: async (v: any) => { calls.push(v.email); return { name: "User " + v.email }; },
          optimisticResolver: () => ({ name: "Loading…" }),
        },
        name: { value: "" },
      },
    });

    void form.userInfo.name; // the first read wakes the lazy resolve on the next microtask
    await Promise.resolve();
    expect(form.userInfo.name.value).toBe("Loading…");
    await flush();
    expect(form.userInfo.name.value).toBe("User a@x");

    form.email.value = "b@x";
    await flush();
    expect(form.userInfo.name.value).toBe("User b@x");
    expect(calls).toEqual(["a@x", "b@x"]);
  });

  it("two lists over one registry share a row", () => {
    const form = root({
      users: [{ name: { value: "" } }],
      admins: [{ name: { value: "" } }],
    });

    form.users.setItems([{ id: "1", name: "Ann" }, { id: "2", name: "Bob" }]);
    form.admins.setItems([{ id: "1", name: "Ann" }]);
    form.admins.items[0].name.value = "Anna";

    expect(form.users.items[0].name.value).toBe("Anna");
    expect(form.users.getValues()).toEqual([{ id: "1", name: "Anna" }, { id: "2", name: "Bob" }]);
    expect(form.admins.getValues()).toEqual([{ id: "1", name: "Anna" }]);
  });

  it("a memo over a shared row sees a write made through the other list", () => {
    const seen = vi.fn((v: any) => v.name === "Anna");
    const form = root({
      users: [{ name: { value: "" }, badge: { value: "", isVisible: seen } }],
      admins: [{ name: { value: "" } }],
    });
    form.users.setItems([{ id: "1", name: "Ann" }]);
    form.admins.setItems(["1"]);

    expect(form.users.items[0].badge.isVisible).toBe(false);
    form.admins.items[0].name.value = "Anna";
    expect(form.users.items[0].badge.isVisible).toBe(true);
  });
});

describe("Cube core: Phase 1 holes (cube-only behavior)", () => {
  it("a group child cannot take a name the group node uses: construction throws", () => {
    // store accepted such configs and made the child unreachable (its group
    // proxy answers these names before child lookup). Intentional change.
    for (const name of ["submit", "values", "setValues", "submitting", "revalidate", "onValueChange"]) {
      expect(() => root({ form: { [name]: { value: "" } } })).toThrow(
        new RegExp(`"form\\.${name}": a child cannot be named "${name}"`),
      );
    }
  });

  it("list remove / setItems release the dropped items' registry views and resolves", () => {
    const hub = new Hub();
    const form = new Cube(
      { users: [{ name: { value: "", resolve: { resolver: async () => "x" } } }] },
      null, "", hub,
    ).node;
    const viewsOf = (id: string) => hub.registry.viewCount(id);

    form.users.setItems([{ id: "1", name: "a" }, { id: "2", name: "b" }, { id: "3", name: "c" }]);
    for (const item of form.users.items) void item.name; // open each item: its subtree (and the leaf resolve) is lazy
    expect(hub.resolving.size).toBe(3);
    expect(viewsOf("2")).toBe(1);

    form.users.remove("2");
    expect(viewsOf("2")).toBe(0);
    expect(hub.resolving.size).toBe(2);

    form.users.setItems(["1"]);
    expect(viewsOf("3")).toBe(0);
    expect(hub.resolving.size).toBe(1);
  });
});
