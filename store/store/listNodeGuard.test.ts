/**
 * Array guard tests.
 *
 * A config with a ListNode (an array of length 1 or 2) must not break any
 * of the modified tree walkers.
 */
import { describe, it, expect } from "vitest";
import { registerNodes } from "./registerNodes";
import { buildNodeMaps } from "./nodeMap";
import { buildValuesCache } from "../valuesCache/valuesCache";
import { applyPatch } from "../applyPatch/applyPatch";
import { initResolveStates } from "../resolvePipeline/initResolveStates";
import { recomputeDirtyTargeted } from "../dirtyTracking/recomputeDirtyTargeted";
import { initGroupSubmitting } from "../init/initGroupSubmitting";
import { collectDefaults } from "../resetPipeline/collectDefaults";
import { captureInitialValues } from "../dirtyTracking/captureInitialValues";
import { collectInitialSnapshot } from "../dirtyTracking/collectInitialSnapshot";
import { isListNode } from "./NodeRegistry/nodeUtils";
import type { AnyConfigNode } from "./types";
import type { FieldState } from "../compute";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const translate = (k: string) => k;

function makeState(value: unknown): FieldState {
  return {
    value,
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    dirty: false,
    revalidate: false,
  };
}

/** Config with a regular field + a length-1 ListNode */
const makeConfigWithList1 = () => ({
  name: { value: "" },
  users: [{ id: { value: "" }, title: { value: "" } }],
} as unknown as AnyConfigNode);

/** Config with a regular field + a length-2 ListNode (template + listConfig) */
const makeConfigWithList2 = () => ({
  name: { value: "" },
  users: [
    { id: { value: "" }, title: { value: "" } },
    { resolve: { resolver: async () => [] } },
  ],
} as unknown as AnyConfigNode);

// ─── isListNode ───────────────────────────────────────────────────────────────

describe("isListNode", () => {
  it("array of length 1 → true", () => {
    expect(isListNode([{}])).toBe(true);
  });

  it("array of length 2 → true", () => {
    expect(isListNode([{}, {}])).toBe(true);
  });

  it("empty array → false", () => {
    expect(isListNode([])).toBe(false);
  });

  it("array of length 3 → false", () => {
    expect(isListNode([{}, {}, {}])).toBe(false);
  });

  it("plain object → false", () => {
    expect(isListNode({ value: "" })).toBe(false);
  });

  it("null → false", () => {
    expect(isListNode(null)).toBe(false);
  });
});

// ─── registerNodes doesn't break on a ListNode ───────────────────────────────────

describe("registerNodes — array guard", () => {
  it("registers regular leaves, ignores the ListNode (length 1)", () => {
    const config = makeConfigWithList1();
    const computeNodes: any[] = [];
    const nodeState = new WeakMap<object, FieldState>();
    const groupComputeMap = new WeakMap();

    expect(() =>
      registerNodes(config, undefined, computeNodes, nodeState, "", groupComputeMap, translate),
    ).not.toThrow();

    // Only 'name' must be registered
    expect(computeNodes).toHaveLength(1);
    expect(computeNodes[0].path).toBe("name");
  });

  it("registers regular leaves, ignores the ListNode (length 2)", () => {
    const config = makeConfigWithList2();
    const computeNodes: any[] = [];
    const nodeState = new WeakMap<object, FieldState>();
    const groupComputeMap = new WeakMap();

    expect(() =>
      registerNodes(config, undefined, computeNodes, nodeState, "", groupComputeMap, translate),
    ).not.toThrow();

    expect(computeNodes).toHaveLength(1);
    expect(computeNodes[0].path).toBe("name");
  });
});

// ─── buildNodeMaps doesn't break on a ListNode ───────────────────────────────────

describe("buildNodeMaps — array guard", () => {
  it("builds mappings for regular nodes, skips the ListNode", () => {
    const config = makeConfigWithList1();
    const nodePaths = new WeakMap<object, string>();
    const nodeParents = new WeakMap<object, object>();

    expect(() => buildNodeMaps(config, nodePaths, nodeParents)).not.toThrow();

    const nameNode = (config as any).name;
    expect(nodePaths.get(nameNode)).toBe("name");
  });
});

// ─── buildValuesCache doesn't break on a ListNode──────────────────────────────

describe("buildValuesCache — array guard", () => {
  it("builds the cache for regular fields, initializes the ListNode as []", () => {
    const config = makeConfigWithList1();
    const nameNode = (config as any).name;
    const nodeState = new WeakMap<object, FieldState>();
    nodeState.set(nameNode, makeState("Alice"));

    let cache: ReturnType<typeof buildValuesCache> | undefined;
    expect(() => { cache = buildValuesCache(config, nodeState); }).not.toThrow();

    expect(cache!.values.name).toBe("Alice");
    // Phase 2B: list nodes are initialised as empty arrays (not undefined)
    expect(cache!.values.users).toEqual([]);
  });
});

// ─── applyPatch doesn't break on a ListNode ────────────────────────────────────────

describe("applyPatch — array guard", () => {
  it("applies the patch to regular fields, ignores the ListNode in the patch", () => {
    const config = makeConfigWithList1();
    const nameNode = (config as any).name;
    const nodeState = new WeakMap<object, FieldState>();
    nodeState.set(nameNode, makeState(""));

    const changed = new Set<object>();
    expect(() =>
      applyPatch(config, nodeState, { name: "Bob", users: [{ id: "u1" }] } as any, changed),
    ).not.toThrow();

    expect(nodeState.get(nameNode)!.value).toBe("Bob");
    expect(changed.has(nameNode)).toBe(true);
  });
});

// ─── initResolveStates doesn't break on a ListNode────────────────────────────

describe("initResolveStates — array guard", () => {
  it("collects resolve nodes, including a ListResolveEntry for a ListNode with a resolver", () => {
    const config = makeConfigWithList2();
    const resolveStates = new Map();

    let entries: ReturnType<typeof initResolveStates> | undefined;
    expect(() => { entries = initResolveStates(config, resolveStates); }).not.toThrow();

    // A resolver inside listConfig[1] is collected as a ListResolveEntry
    expect(entries!).toHaveLength(1);
    expect((entries![0] as any).isListNode).toBe(true);
  });
});

// ─── recomputeDirty doesn't break on a ListNode ──────────────────────────────────

describe("recomputeDirtyTargeted — array guard", () => {
  it("recomputes dirty for regular fields, skips the ListNode", () => {
    const config = makeConfigWithList1() as any;
    const nameNode = config.name;
    const nodeState = new WeakMap<object, FieldState>();
    nodeState.set(nameNode, makeState("changed"));
    nodeState.set(config, makeState(undefined));
    const initialValueMap = new WeakMap<object, unknown>();
    initialValueMap.set(nameNode, "original");
    const nodeParents = new WeakMap<object, object>();
    nodeParents.set(nameNode, config);
    const nodePaths = new WeakMap<object, string>();
    nodePaths.set(config, "");
    nodePaths.set(nameNode, "name");

    let result: ReturnType<typeof recomputeDirtyTargeted> | undefined;
    expect(() => {
      result = recomputeDirtyTargeted(
        new Set<object>([nameNode]),
        config,
        nodeState,
        initialValueMap,
        nodeParents,
        nodePaths,
      );
    }).not.toThrow();

    expect(result!.anyDirty).toBe(true);
    expect(result!.changed.has(nameNode)).toBe(true);
  });
});

// ─── initGroupSubmitting doesn't break on a ListNode───────────────────────────

describe("initGroupSubmitting — array guard", () => {
  it("initializes submitting for regular groups, skips the ListNode", () => {
    const config = makeConfigWithList1();
    const nodeState = new WeakMap<object, FieldState>();

    expect(() => initGroupSubmitting(config, nodeState)).not.toThrow();
  });
});

// ─── collectDefaults doesn't break on a ListNode ────────────────────────────────

describe("collectDefaults — array guard", () => {
  it("collects defaults for regular fields, skips the ListNode", () => {
    const config = makeConfigWithList1();

    let defaults: ReturnType<typeof collectDefaults> | undefined;
    expect(() => { defaults = collectDefaults(config); }).not.toThrow();

    expect(defaults!.name).toBe("");
    expect(defaults!.users).toBeUndefined();
  });
});

// ─── captureInitialValues doesn't break on a ListNode─────────────────────────

describe("captureInitialValues — array guard", () => {
  it("captures initial values for regular fields, skips the ListNode", () => {
    const config = makeConfigWithList1();
    const nameNode = (config as any).name;
    const nodeState = new WeakMap<object, FieldState>();
    nodeState.set(nameNode, makeState("hello"));
    const initialValueMap = new WeakMap<object, unknown>();

    expect(() =>
      captureInitialValues(config, nodeState, initialValueMap),
    ).not.toThrow();

    expect(initialValueMap.get(nameNode)).toBe("hello");
  });
});

// ─── collectInitialSnapshot doesn't break on a ListNode───────────────────────

describe("collectInitialSnapshot — array guard", () => {
  it("builds the snapshot for regular fields, skips the ListNode", () => {
    const config = makeConfigWithList1();
    const nameNode = (config as any).name;
    const initialValueMap = new WeakMap<object, unknown>();
    initialValueMap.set(nameNode, "snap");

    let snapshot: ReturnType<typeof collectInitialSnapshot> | undefined;
    expect(() => { snapshot = collectInitialSnapshot(config, initialValueMap); }).not.toThrow();

    expect(snapshot!.name).toBe("snap");
    expect(snapshot!.users).toBeUndefined();
  });
});
