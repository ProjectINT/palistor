import { describe, it, expect } from "vitest";
import { recomputeDirtyTargeted } from "./recomputeDirtyTargeted";
import type { FieldState } from "../compute/index";

// ─── Helpers to build minimal config trees ───────────────────────────────────

function makeLeaf(value: unknown = ""): { value: unknown } {
  return { value };
}

function makeState(value: unknown, dirty = false): FieldState {
  return {
    value,
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    dirty,
    revalidate: false,
  };
}

/**
 * Build the WeakMaps (nodeState, initialValueMap, nodeParents, nodePaths)
 * for a flat config: { root → { fieldA, fieldB } }
 */
function buildFlatMaps(
  root: Record<string, object>,
  leaves: Record<string, { value: unknown }>,
  initialValues: Record<string, unknown>,
) {
  const nodeState = new WeakMap<object, FieldState>();
  const initialValueMap = new WeakMap<object, unknown>();
  const nodeParents = new WeakMap<object, object>();
  const nodePaths = new WeakMap<object, string>();

  nodePaths.set(root, "");

  for (const key of Object.keys(leaves)) {
    const leaf = leaves[key];
    nodeState.set(leaf, makeState(leaf.value));
    initialValueMap.set(leaf, initialValues[key] ?? leaf.value);
    nodeParents.set(leaf, root);
    nodePaths.set(leaf, key);
  }

  // Root group state
  nodeState.set(root, makeState(undefined, false));

  return { nodeState, initialValueMap, nodeParents, nodePaths };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("recomputeDirtyTargeted", () => {
  describe("leaf dirty computation", () => {
    it("marks leaf dirty when value differs from initial", () => {
      const leaf = makeLeaf("changed");
      const root = { field: leaf };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root,
        { field: leaf },
        { field: "" },
      );

      const changed = new Set<object>([leaf]);
      const result = recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(nodeState.get(leaf)?.dirty).toBe(true);
      expect(result.changed.has(leaf)).toBe(true);
    });

    it("marks leaf clean when value matches initial", () => {
      const leaf = makeLeaf("");
      const root = { field: leaf };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root,
        { field: leaf },
        { field: "" },
      );
      // Pre-set dirty = true to verify it gets cleared
      nodeState.set(leaf, { ...nodeState.get(leaf)!, dirty: true });

      const changed = new Set<object>([leaf]);
      const result = recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(nodeState.get(leaf)?.dirty).toBe(false);
      expect(result.changed.has(leaf)).toBe(true);
    });

    it("does not add leaf to changed when dirty did not change", () => {
      const leaf = makeLeaf("x");
      const root = { field: leaf };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root,
        { field: leaf },
        { field: "" },
      );
      // Pre-set dirty = true (matches what will be computed)
      nodeState.set(leaf, { ...nodeState.get(leaf)!, dirty: true });

      const changed = new Set<object>([leaf]);
      const result = recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(result.changed.has(leaf)).toBe(false);
    });
  });

  describe("group dirty aggregation", () => {
    it("group dirty = OR of children dirty", () => {
      const leafA = makeLeaf("changed");
      const leafB = makeLeaf("");
      const root = { a: leafA, b: leafB };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root,
        { a: leafA, b: leafB },
        { a: "", b: "" },
      );

      const changed = new Set<object>([leafA]);
      recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(nodeState.get(root)?.dirty).toBe(true);
    });

    it("group becomes clean when all children clean", () => {
      const leafA = makeLeaf("");
      const root = { a: leafA };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root,
        { a: leafA },
        { a: "" },
      );
      // Pre-set everything dirty
      nodeState.set(leafA, { ...nodeState.get(leafA)!, dirty: true });
      nodeState.set(root, { ...nodeState.get(root)!, dirty: true });

      const changed = new Set<object>([leafA]);
      recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(nodeState.get(root)?.dirty).toBe(false);
    });
  });

  describe("nested groups — bubble-up", () => {
    it("dirty bubbles up from leaf through nested group to root", () => {
      // root → address → city
      const city = makeLeaf("Moscow");
      const address = { city };
      const root = { address };

      const nodeState = new WeakMap<object, FieldState>();
      const initialValueMap = new WeakMap<object, unknown>();
      const nodeParents = new WeakMap<object, object>();
      const nodePaths = new WeakMap<object, string>();

      nodePaths.set(root, "");
      nodePaths.set(address, "address");
      nodePaths.set(city, "address.city");
      nodeParents.set(city, address);
      nodeParents.set(address, root);

      nodeState.set(city, makeState("Moscow"));
      nodeState.set(address, makeState(undefined, false));
      nodeState.set(root, makeState(undefined, false));
      initialValueMap.set(city, "");

      const changed = new Set<object>([city]);
      recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(nodeState.get(city)?.dirty).toBe(true);
      expect(nodeState.get(address)?.dirty).toBe(true);
      expect(nodeState.get(root)?.dirty).toBe(true);
    });

    it("dirty clears up the chain when leaf returns to initial", () => {
      const city = makeLeaf("");
      const address = { city };
      const root = { address };

      const nodeState = new WeakMap<object, FieldState>();
      const initialValueMap = new WeakMap<object, unknown>();
      const nodeParents = new WeakMap<object, object>();
      const nodePaths = new WeakMap<object, string>();

      nodePaths.set(root, "");
      nodePaths.set(address, "address");
      nodePaths.set(city, "address.city");
      nodeParents.set(city, address);
      nodeParents.set(address, root);

      // Pre-set all dirty = true
      nodeState.set(city, makeState("", true));
      nodeState.set(address, makeState(undefined, true));
      nodeState.set(root, makeState(undefined, true));
      initialValueMap.set(city, "");

      const changed = new Set<object>([city]);
      recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(nodeState.get(city)?.dirty).toBe(false);
      expect(nodeState.get(address)?.dirty).toBe(false);
      expect(nodeState.get(root)?.dirty).toBe(false);
    });
  });

  describe("entity paths — skipped without error", () => {
    it("does not throw when changedNodes contains entity-path nodes", () => {
      const entityLeaf = makeLeaf("Alice");
      const root = {};

      const nodeState = new WeakMap<object, FieldState>();
      const initialValueMap = new WeakMap<object, unknown>();
      const nodeParents = new WeakMap<object, object>();
      const nodePaths = new WeakMap<object, string>();

      nodePaths.set(root, "");
      nodePaths.set(entityLeaf, "_entity_.u1.name");
      nodeParents.set(entityLeaf, {} /* entity group */);

      nodeState.set(entityLeaf, makeState("Alice"));
      nodeState.set(root, makeState(undefined, false));
      initialValueMap.set(entityLeaf, "");

      const changed = new Set<object>([entityLeaf]);

      expect(() =>
        recomputeDirtyTargeted(
          changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths,
        ),
      ).not.toThrow();
    });
  });

  describe("list dirty", () => {
    it("detects list as dirty when itemIds differ from initialItemIds", () => {
      const list: unknown[] = [{}]; // length 1 — valid list node
      const leafInRoot = makeLeaf("x");
      const root = { items: list, field: leafInRoot };

      const nodeState = new WeakMap<object, FieldState>();
      const initialValueMap = new WeakMap<object, unknown>();
      const nodeParents = new WeakMap<object, object>();
      const nodePaths = new WeakMap<object, string>();
      const listStates = new WeakMap<object, { itemIds: string[]; initialItemIds: string[] }>();

      nodePaths.set(root, "");
      nodePaths.set(leafInRoot, "field");
      nodeParents.set(leafInRoot, root);

      nodeState.set(leafInRoot, makeState("x"));
      nodeState.set(root, makeState(undefined, false));
      initialValueMap.set(leafInRoot, ""); // leaf is dirty: "x" != ""
      listStates.set(list, { itemIds: ["a", "b"], initialItemIds: ["a"] });

      const changed = new Set<object>([leafInRoot]);
      recomputeDirtyTargeted(
        changed, root as any, nodeState, initialValueMap, nodeParents, nodePaths, listStates,
      );

      expect(nodeState.get(root)?.dirty).toBe(true);
    });
  });

  describe("anyDirty return value", () => {
    it("returns anyDirty=false when root is not dirty", () => {
      const leaf = makeLeaf("");
      const root = { field: leaf };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root, { field: leaf }, { field: "" },
      );

      const result = recomputeDirtyTargeted(
        new Set<object>([leaf]), root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      expect(result.anyDirty).toBe(false);
    });

    it("returns anyDirty=true when root becomes dirty", () => {
      const leaf = makeLeaf("dirty-value");
      const root = { field: leaf };
      const { nodeState, initialValueMap, nodeParents, nodePaths } = buildFlatMaps(
        root, { field: leaf }, { field: "" },
      );

      const result = recomputeDirtyTargeted(
        new Set<object>([leaf]), root as any, nodeState, initialValueMap, nodeParents, nodePaths,
      );

      // After leaf marked dirty, root group gets updated, then anyDirty reflects root.dirty
      expect(result.anyDirty).toBe(nodeState.get(root)?.dirty ?? false);
    });
  });
});
