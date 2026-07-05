import { describe, it, expect, vi } from "vitest";
import { walkFull } from "./walkFull";
import type { AnyConfigNode } from "../store/types";

const config = {
  name: { value: "", label: "Name", validate: () => undefined },
  email: { value: "" },
  address: {
    city: { value: "Moscow" },
    street: { value: "Tverskaya" },
    nested: {
      zip: { value: "101000" },
    },
  },
  users: [{ template: {} }], // ListNode
  onSubmit: async () => {},  // CONFIG_PROP — must be skipped
} as unknown as AnyConfigNode;

describe("walkFull", () => {
  it("collects all leaf paths", () => {
    const paths: string[] = [];
    walkFull(config, {
      onLeaf(_node, _key, path) {
        paths.push(path);
      },
    });
    expect(paths).toEqual([
      "name",
      "email",
      "address.city",
      "address.street",
      "address.nested.zip",
    ]);
  });

  it("calls onGroupEnter/onGroupExit for groups", () => {
    const entered: string[] = [];
    const exited: string[] = [];
    walkFull(config, {
      onLeaf() {},
      onGroupEnter(_node, _key, path) { entered.push(path); },
      onGroupExit(_node, _key, path) { exited.push(path); },
    });
    expect(entered).toContain("address");
    expect(entered).toContain("address.nested");
    expect(exited).toContain("address");
    expect(exited).toContain("address.nested");
  });

  it("onGroupEnter returning false skips subtree", () => {
    const visited: string[] = [];
    walkFull(config, {
      onLeaf(_node, _key, path) { visited.push(path); },
      onGroupEnter(_node, key) {
        if (key === "address") return false;
      },
    });
    expect(visited).not.toContain("address.city");
    expect(visited).not.toContain("address.street");
    expect(visited).not.toContain("address.nested.zip");
    expect(visited).toContain("name");
    expect(visited).toContain("email");
  });

  it("calls onList for array nodes", () => {
    const lists: string[] = [];
    walkFull(config, {
      onLeaf() {},
      onList(_node, _key, path) { lists.push(path); },
    });
    expect(lists).toContain("users");
  });

  it("skips CONFIG_PROPS (onSubmit not visited)", () => {
    const onLeaf = vi.fn();
    const onGroupEnter = vi.fn();
    const onList = vi.fn();
    walkFull(config, { onLeaf, onGroupEnter, onList });
    const allPaths = [
      ...onLeaf.mock.calls.map(c => c[2]),
      ...onGroupEnter.mock.calls.map(c => c[2]),
      ...onList.mock.calls.map(c => c[2]),
    ];
    expect(allPaths).not.toContain("onSubmit");
  });

  it("skips null and primitives without error", () => {
    const node = {
      name: { value: "test" },
      __memo: null,
      count: 42,
    } as unknown as AnyConfigNode;
    const paths: string[] = [];
    expect(() => walkFull(node, {
      onLeaf(_n, _k, path) { paths.push(path); },
    })).not.toThrow();
    expect(paths).toEqual(["name"]);
  });
});
