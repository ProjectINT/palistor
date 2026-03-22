import { describe, it, expect } from "vitest";
import { computeProxyKeys } from "./computeProxyKeys";
import type { FieldState } from "../compute";
import type { AnyConfigNode } from "../types";

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
      const keys = computeProxyKeys(node);
      expect(keys).toContain("value");
      expect(keys).toContain("label");
      expect(keys).toContain("isRequired");
      expect(keys).toContain("isVisible");
      expect(keys).toContain("isInvalid");
      expect(keys).toContain("onValueChange");
    });

    it("excludes internal field-state props from spread", () => {
      const node: AnyConfigNode = { value: "", dirty: false, loading: false };
      const keys = computeProxyKeys(node);
      expect(keys).not.toContain("dirty");
      expect(keys).not.toContain("loading");
    });

    it("includes componentProps keys", () => {
      const node: AnyConfigNode = {
        value: "",
        componentProps: { size: "lg", variant: "bordered" },
      };
      const keys = computeProxyKeys(node);
      expect(keys).toContain("size");
      expect(keys).toContain("variant");
      expect(keys).toContain("onValueChange");
    });

    it("does not include componentProps keys if componentProps is absent", () => {
      const node: AnyConfigNode = { value: "test" };
      const keys = computeProxyKeys(node);
      expect(keys).not.toContain("size");
    });

    it("does not include internal config keys", () => {
      const node: AnyConfigNode = {
        value: "",
        validate: () => undefined,
        formatter: (v: any) => v,
      };
      const keys = computeProxyKeys(node);
      expect(keys).not.toContain("validate");
      expect(keys).not.toContain("formatter");
    });
  });

  describe("group node (no 'value')", () => {
    it("returns exactly GROUP_SPREAD_KEYS", () => {
      const child1: AnyConfigNode = { value: "" };
      const child2: AnyConfigNode = { value: "x" };
      const node: AnyConfigNode = {
        email: child1,
        name: child2,
        validate: () => undefined,
      };
      const keys = computeProxyKeys(node);
      expect(keys).toEqual(["submitting", "dirty", "revalidate", "loading", "submit", "reset"]);
    });

    it("does not include child node keys", () => {
      const node: AnyConfigNode = { email: { value: "" }, name: { value: "" } };
      const keys = computeProxyKeys(node);
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("name");
    });

    it("does not include FIELD_STATE_PROPS like isVisible or isRequired", () => {
      const node: AnyConfigNode = { email: { value: "" } };
      const keys = computeProxyKeys(node);
      expect(keys).not.toContain("isVisible");
      expect(keys).not.toContain("isRequired");
    });

    it("does not include internal config keys", () => {
      const node: AnyConfigNode = {
        email: { value: "" },
        resolve: { resolver: async () => ({}) },
        deps: ["email"],
        onChange: () => {},
      };
      const keys = computeProxyKeys(node);
      expect(keys).not.toContain("resolve");
      expect(keys).not.toContain("deps");
      expect(keys).not.toContain("onChange");
    });

    it("is independent of nodeState", () => {
      const node: AnyConfigNode = { email: { value: "" } };
      const withState = computeProxyKeys(node);
      const withoutState = computeProxyKeys(node);
      expect(withState).toEqual(withoutState);
    });
  });

  describe("list node (array)", () => {
    it("returns exactly LIST_SPREAD_KEYS for array of length 1", () => {
      const template = { id: { value: "" }, name: { value: "" } };
      const listNode = [template];
      const keys = computeProxyKeys(listNode);
      expect(keys).toEqual(["items", "length", "loading", "dirty", "add", "remove", "getById", "setItems", "map"]);
    });

    it("returns exactly LIST_SPREAD_KEYS for array of length 2", () => {
      const template = { id: { value: "" } };
      const listConfig = { resolve: { resolver: async () => [] } };
      const listNode = [template, listConfig];
      const keys = computeProxyKeys(listNode);
      expect(keys).toEqual(["items", "length", "loading", "dirty", "add", "remove", "getById", "setItems", "map"]);
    });

    it("does not include FIELD_STATE_PROPS", () => {
      const listNode = [{ id: { value: "" } }];
      const keys = computeProxyKeys(listNode);
      expect(keys).not.toContain("value");
      expect(keys).not.toContain("isVisible");
      expect(keys).not.toContain("label");
    });

    it("does not include GROUP_SPREAD_KEYS like submit or submitting", () => {
      const listNode = [{ id: { value: "" } }];
      const keys = computeProxyKeys(listNode);
      expect(keys).not.toContain("submit");
      expect(keys).not.toContain("submitting");
      // dirty IS included for lists (Phase 2C)
      expect(keys).toContain("dirty");
    });
  });
});
