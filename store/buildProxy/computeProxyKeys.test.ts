import { describe, it, expect } from "vitest";
import { computeProxyKeys } from "./computeProxyKeys";
import type { FieldState } from "../compute";
import type { AnyConfigNode } from "../collectValues";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNodeState(entries: [AnyConfigNode, Partial<FieldState>][]): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) {
    map.set(node, state as FieldState);
  }
  return map;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("computeProxyKeys", () => {
  describe("leaf node (has 'value')", () => {
    it("returns FIELD_STATE_PROPS + onValueChange", () => {
      const node: AnyConfigNode = { value: "", label: "Email" };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).toContain("value");
      expect(keys).toContain("label");
      expect(keys).toContain("isRequired");
      expect(keys).toContain("isVisible");
      expect(keys).toContain("error");
      expect(keys).toContain("onValueChange");
    });

    it("includes componentProps keys", () => {
      const node: AnyConfigNode = {
        value: "",
        componentProps: { size: "lg", variant: "bordered" },
      };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).toContain("size");
      expect(keys).toContain("variant");
      expect(keys).toContain("onValueChange");
    });

    it("does not include componentProps keys if componentProps is absent", () => {
      const node: AnyConfigNode = { value: "test" };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).not.toContain("size");
    });

    it("does not include internal config keys", () => {
      const node: AnyConfigNode = {
        value: "",
        validate: () => undefined,
        formatter: (v: any) => v,
      };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).not.toContain("validate");
      expect(keys).not.toContain("formatter");
    });
  });

  describe("group node (no 'value')", () => {
    it("returns child object keys, filtering out internal/config keys", () => {
      const child1: AnyConfigNode = { value: "" };
      const child2: AnyConfigNode = { value: "x" };
      const node: AnyConfigNode = {
        email: child1,
        name: child2,
        validate: () => undefined, // internal, should not appear
      };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).toContain("email");
      expect(keys).toContain("name");
      expect(keys).not.toContain("validate");
    });

    it("includes FIELD_STATE_PROPS from nodeState when state is present", () => {
      const node: AnyConfigNode = { email: { value: "" } };
      const nodeState = makeNodeState([[node, { isVisible: true, isRequired: false } as any]]);
      const keys = computeProxyKeys(node, nodeState);
      expect(keys).toContain("isVisible");
      expect(keys).toContain("isRequired");
      expect(keys).toContain("email");
    });

    it("skips FIELD_STATE_PROPS that are undefined in state", () => {
      const node: AnyConfigNode = { email: { value: "" } };
      const nodeState = makeNodeState([[node, { isVisible: true } as any]]);
      const keys = computeProxyKeys(node, nodeState);
      expect(keys).toContain("isVisible");
      // isRequired is undefined in state, should not appear
      expect(keys).not.toContain("isRequired");
    });

    it("excludes non-object children (primitive config values)", () => {
      const node: AnyConfigNode = {
        email: { value: "" },
        somePrimitive: "not-an-object" as any,
      };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).toContain("email");
      expect(keys).not.toContain("somePrimitive");
    });

    it("excludes resolve-related internal keys", () => {
      const node: AnyConfigNode = {
        email: { value: "" },
        resolve: { resolver: async () => ({}) },
        deps: ["email"],
        onChange: () => {},
      };
      const keys = computeProxyKeys(node, new WeakMap());
      expect(keys).toContain("email");
      expect(keys).not.toContain("resolve");
      expect(keys).not.toContain("deps");
      expect(keys).not.toContain("onChange");
    });
  });
});
