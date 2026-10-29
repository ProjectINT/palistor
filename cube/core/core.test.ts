/**
 * The Cube core on its own (no facade): the four README scenarios the sketch
 * was checked against in CubeExperiment.md. Contract parity lives in
 * cube/contract/; this file only guards the core between contract slices.
 */

import { describe, it, expect } from "vitest";
import { Cube, ListCube, type Values } from "./index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("Cube core", () => {
  it("computed isVisible follows its dependency", () => {
    const cube: any = new Cube({
      showAddress: { value: false },
      address: { isVisible: (v: Values) => v.showAddress, city: { value: "" } },
    });

    expect(cube.address.isVisible).toBe(false);
    cube.showAddress.value = true;
    expect(cube.address.isVisible).toBe(true);
  });

  it("write pipeline: formatter → store → setter patches a sibling", () => {
    const cube: any = new Cube({
      phone: {
        value: "",
        formatter: (raw: string) => raw.replace(/\D/g, ""),
        setter: (value: string) => ({ hasPhone: value.length > 0 }),
      },
      hasPhone: { value: false },
    });

    cube.phone.onValueChange("+1 (555) 01");
    expect(cube.phone.value).toBe("155501");
    expect(cube.hasPhone.value).toBe(true);
    expect(cube.dirty).toBe(true);
  });

  it("resolve: optimistic first, real after, restart when a dependency moves", async () => {
    const calls: string[] = [];
    const cube: any = new Cube({
      email: { value: "a@x" },
      userInfo: {
        resolve: {
          resolver: async (v: Values) => { calls.push(v.email); return { name: "User " + v.email }; },
          optimisticResolver: () => ({ name: "Loading…" }),
        },
        name: { value: "" },
      },
    });

    expect(cube.userInfo.name.value).toBe("Loading…");
    await flush();
    expect(cube.userInfo.name.value).toBe("User a@x");

    cube.email.value = "b@x";
    await flush();
    expect(cube.userInfo.name.value).toBe("User b@x");
    expect(calls).toEqual(["a@x", "b@x"]);
  });

  it("two lists over one registry share a row", () => {
    const cube: any = new Cube({
      users: [{ id: { value: "" }, name: { value: "" } }],
      admins: [{ id: { value: "" }, name: { value: "" } }],
    });
    const users = cube.users as ListCube;
    const admins = cube.admins as ListCube;

    users.setItems([{ id: "1", name: "Ann" }, { id: "2", name: "Bob" }]);
    admins.setItems([{ id: "1", name: "Ann" }]);
    (admins.items[0] as any).name.value = "Anna";

    expect((users.items[0] as any).name.value).toBe("Anna");
    expect(cube.getValues()).toEqual({
      users: [{ id: "1", name: "Anna" }, { id: "2", name: "Bob" }],
      admins: [{ id: "1", name: "Anna" }],
    });
  });
});
