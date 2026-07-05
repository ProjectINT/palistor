import { describe, it, expect } from "vitest";
import { NodeRegistry } from "./NodeRegistry/nodeRegistry";
import type { AnyConfigNode } from "./types";

// ─── Test configs ─────────────────────────────────────────────────────────────

const flat = {
  email: { value: "" },
  name: { value: "Alice" },
  age: { value: 0 },
} as unknown as AnyConfigNode;

const nested = {
  email: { value: "" },
  passport: {
    number: { value: "" },
    issueDate: { value: "" },
  },
  address: {
    city: {
      name: { value: "" },
    },
  },
} as unknown as AnyConfigNode;

const withComputed = {
  paymentType: { value: "card" },
  passport: {
    isVisible: (values: any) => values.paymentType === "bank",
    number: { value: "" },
  },
} as unknown as AnyConfigNode;

const translate = (v: string) => v;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NodeRegistry", () => {
  describe("constructor — node initialization", () => {
    it("registers all leaf nodes", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const leafPaths = reg.computeNodes.map((e) => e.path);
      expect(leafPaths).toContain("email");
      expect(leafPaths).toContain("name");
      expect(leafPaths).toContain("age");
    });

    it("sets the initial state for leaves", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const emailState = reg.nodeState.get((flat as any).email);
      expect(emailState).toBeDefined();
      expect(emailState!.value).toBe("");
      expect(emailState!.isVisible).toBe(true);
    });

    it("applies initialValues from the constructor", () => {
      const reg = new NodeRegistry(flat, { name: "Bob" }, translate);
      const nameState = reg.nodeState.get((flat as any).name);
      expect(nameState!.value).toBe("Bob");
    });

    it("builds nodePaths for every node of the nested structure", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.nodePaths.get((nested as any).passport.number)).toBe("passport.number");
      expect(reg.nodePaths.get((nested as any).address.city.name)).toBe("address.city.name");
    });

    it("builds nodeParents for child nodes", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.nodeParents.get((nested as any).passport.number)).toBe((nested as any).passport);
      expect(reg.nodeParents.get((nested as any).passport)).toBe(nested);
    });

    it("initializes submitting for the root and nested groups", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const rootState = reg.nodeState.get(nested);
      expect(rootState).toBeDefined();
      expect(rootState!.submitting).toBe(false);
      const passportState = reg.nodeState.get((nested as any).passport);
      expect(passportState!.submitting).toBe(false);
    });

    it("registers leaves at nested levels", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const paths = reg.computeNodes.map((e) => e.path);
      expect(paths).toContain("email");
      expect(paths).toContain("passport.number");
      expect(paths).toContain("passport.issueDate");
      expect(paths).toContain("address.city.name");
    });
  });

  describe("getState / setState", () => {
    it("getState returns a leaf node's state", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const state = reg.getState((flat as any).email);
      expect(state).toBeDefined();
      expect(state!.value).toBe("");
    });

    it("getState returns undefined for an unregistered node", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.getState({})).toBeUndefined();
    });

    it("setState updates a node's state", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const node = (flat as any).email;
      const current = reg.getState(node)!;
      reg.setState(node, { ...current, value: "new@test.com" });
      expect(reg.getState(node)!.value).toBe("new@test.com");
    });
  });

  describe("getPath / getParent", () => {
    it("getPath returns the node's dot-path", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getPath((nested as any).passport.number)).toBe("passport.number");
      expect(reg.getPath((nested as any).email)).toBe("email");
    });

    it("getPath returns undefined for the root node", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getPath(nested)).toBeUndefined();
    });

    it("getParent returns the direct parent", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getParent((nested as any).passport.number)).toBe((nested as any).passport);
      expect(reg.getParent((nested as any).passport)).toBe(nested);
    });

    it("getParent returns undefined for the root node", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getParent(nested)).toBeUndefined();
    });
  });

  describe("getGroupPath", () => {
    it("leaf node → the parent group's path", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getGroupPath((nested as any).passport.number)).toBe("passport");
    });

    it("root-level leaf → an empty string", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.getGroupPath((flat as any).email)).toBe("");
    });

    it("group node → its own path", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getGroupPath((nested as any).passport)).toBe("passport");
    });

    it("root group → an empty string", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getGroupPath(nested)).toBe("");
    });
  });

  describe("findByPath", () => {
    it("finds a leaf by exact path", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.findByPath("passport.number")).toBe((nested as any).passport.number);
      expect(reg.findByPath("email")).toBe((nested as any).email);
    });

    it("returns undefined for a missing path", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.findByPath("nonexistent")).toBeUndefined();
    });

    it("returns undefined for a group path (groups without computed props are not in computeNodes)", () => {
      // Groups without computed props never enter computeNodes
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.findByPath("passport")).toBeUndefined();
    });
  });

  describe("isLeafNode / isGroupNode", () => {
    it("isLeafNode returns true for a leaf node", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.isLeafNode((flat as any).email)).toBe(true);
    });

    it("isLeafNode returns false for a group node", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.isLeafNode((nested as any).passport)).toBe(false);
    });

    it("isGroupNode returns true for a group node", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.isGroupNode((nested as any).passport)).toBe(true);
    });

    it("isGroupNode returns false for a leaf node", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.isGroupNode((flat as any).email)).toBe(false);
    });
  });

  describe("forEachCompute", () => {
    it("iterates over all leaves", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const collected: string[] = [];
      reg.forEachCompute((entry) => collected.push(entry.path));
      expect(collected).toContain("email");
      expect(collected).toContain("passport.number");
      expect(collected).toContain("passport.issueDate");
      expect(collected).toContain("address.city.name");
    });
  });

  describe("groupComputeMap and proxyCache", () => {
    it("groupComputeMap is populated at initialization", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const passportLeaves = reg.groupComputeMap.get((nested as any).passport);
      expect(passportLeaves).toBeDefined();
      expect(passportLeaves!.length).toBeGreaterThan(0);
    });

    it("proxyCache starts empty (filled lazily via buildProxy)", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      // proxyCache is empty — no proxies created yet
      expect(reg.proxyCache.get((flat as any).email)).toBeUndefined();
    });
  });

  describe("nodes with computed props on a group", () => {
    it("a group with isVisible enters computeNodes", () => {
      const reg = new NodeRegistry(withComputed, {}, translate);
      const paths = reg.computeNodes.map((e) => e.path);
      // passport is a group node with an isVisible function → must be in computeNodes
      expect(paths).toContain("passport");
    });
  });
});
