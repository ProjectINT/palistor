/**
 * Фаза 0.5: тесты array guard.
 *
 * Конфиг с ListNode (массив длины 1 или 2) не ломает ни один
 * из модифицированных tree-walker-ов.
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

// ─── Хелперы ─────────────────────────────────────────────────────────────────

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

/** Конфиг с обычным полем + ListNode длины 1 */
const makeConfigWithList1 = () => ({
  name: { value: "" },
  users: [{ id: { value: "" }, title: { value: "" } }],
} as unknown as AnyConfigNode);

/** Конфиг с обычным полем + ListNode длины 2 (template + listConfig) */
const makeConfigWithList2 = () => ({
  name: { value: "" },
  users: [
    { id: { value: "" }, title: { value: "" } },
    { resolve: { resolver: async () => [] } },
  ],
} as unknown as AnyConfigNode);

// ─── isListNode ───────────────────────────────────────────────────────────────

describe("isListNode", () => {
  it("массив длины 1 → true", () => {
    expect(isListNode([{}])).toBe(true);
  });

  it("массив длины 2 → true", () => {
    expect(isListNode([{}, {}])).toBe(true);
  });

  it("пустой массив → false", () => {
    expect(isListNode([])).toBe(false);
  });

  it("массив длины 3 → false", () => {
    expect(isListNode([{}, {}, {}])).toBe(false);
  });

  it("обычный объект → false", () => {
    expect(isListNode({ value: "" })).toBe(false);
  });

  it("null → false", () => {
    expect(isListNode(null)).toBe(false);
  });
});

// ─── registerNodes не ломается на ListNode ────────────────────────────────────

describe("registerNodes — array guard", () => {
  it("регистрирует обычные листы, игнорирует ListNode (длина 1)", () => {
    const config = makeConfigWithList1();
    const leafNodes: any[] = [];
    const nodeState = new WeakMap<object, FieldState>();
    const groupLeafMap = new WeakMap();

    expect(() =>
      registerNodes(config, undefined, leafNodes, nodeState, "", groupLeafMap, translate),
    ).not.toThrow();

    // Только 'name' должен быть зарегистрирован
    expect(leafNodes).toHaveLength(1);
    expect(leafNodes[0].path).toBe("name");
  });

  it("регистрирует обычные листы, игнорирует ListNode (длина 2)", () => {
    const config = makeConfigWithList2();
    const leafNodes: any[] = [];
    const nodeState = new WeakMap<object, FieldState>();
    const groupLeafMap = new WeakMap();

    expect(() =>
      registerNodes(config, undefined, leafNodes, nodeState, "", groupLeafMap, translate),
    ).not.toThrow();

    expect(leafNodes).toHaveLength(1);
    expect(leafNodes[0].path).toBe("name");
  });
});

// ─── buildNodeMaps не ломается на ListNode ────────────────────────────────────

describe("buildNodeMaps — array guard", () => {
  it("строит маппинги для обычных узлов, пропускает ListNode", () => {
    const config = makeConfigWithList1();
    const nodePaths = new WeakMap<object, string>();
    const nodeParents = new WeakMap<object, object>();

    expect(() => buildNodeMaps(config, nodePaths, nodeParents)).not.toThrow();

    const nameNode = (config as any).name;
    expect(nodePaths.get(nameNode)).toBe("name");
  });
});

// ─── buildValuesCache не ломается на ListNode ─────────────────────────────────

describe("buildValuesCache — array guard", () => {
  it("строит кеш для обычных полей, инициализирует ListNode как []", () => {
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

// ─── applyPatch не ломается на ListNode ──────────────────────────────────────

describe("applyPatch — array guard", () => {
  it("применяет патч к обычным полям, игнорирует ListNode в патче", () => {
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

// ─── initResolveStates не ломается на ListNode ───────────────────────────────

describe("initResolveStates — array guard", () => {
  it("собирает resolve-ноды, включая ListResolveEntry для ListNode с resolver", () => {
    const config = makeConfigWithList2();
    const resolveStates = new Map();

    let entries: ReturnType<typeof initResolveStates> | undefined;
    expect(() => { entries = initResolveStates(config, resolveStates); }).not.toThrow();

    // Phase 2C: resolver внутри listConfig[1] собирается как ListResolveEntry
    expect(entries!).toHaveLength(1);
    expect((entries![0] as any).isListNode).toBe(true);
  });
});

// ─── recomputeDirty не ломается на ListNode ───────────────────────────────────

describe("recomputeDirtyTargeted — array guard", () => {
  it("пересчитывает dirty для обычных полей, пропускает ListNode", () => {
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

// ─── initGroupSubmitting не ломается на ListNode ──────────────────────────────

describe("initGroupSubmitting — array guard", () => {
  it("инициализирует submitting для обычных групп, пропускает ListNode", () => {
    const config = makeConfigWithList1();
    const nodeState = new WeakMap<object, FieldState>();

    expect(() => initGroupSubmitting(config, nodeState)).not.toThrow();
  });
});

// ─── collectDefaults не ломается на ListNode ─────────────────────────────────

describe("collectDefaults — array guard", () => {
  it("собирает дефолты для обычных полей, пропускает ListNode", () => {
    const config = makeConfigWithList1();

    let defaults: ReturnType<typeof collectDefaults> | undefined;
    expect(() => { defaults = collectDefaults(config); }).not.toThrow();

    expect(defaults!.name).toBe("");
    expect(defaults!.users).toBeUndefined();
  });
});

// ─── captureInitialValues не ломается на ListNode ────────────────────────────

describe("captureInitialValues — array guard", () => {
  it("захватывает initial values для обычных полей, пропускает ListNode", () => {
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

// ─── collectInitialSnapshot не ломается на ListNode ──────────────────────────

describe("collectInitialSnapshot — array guard", () => {
  it("строит снапшот для обычных полей, пропускает ListNode", () => {
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
