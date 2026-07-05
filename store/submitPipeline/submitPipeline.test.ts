import { describe, it, expect, vi } from "vitest";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { collectLeafStates } from "./collectLeafStates";
import { applyLeafBeforeSubmit } from "./applyLeafBeforeSubmit";
import { Palistor } from "../store/palistor";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<FieldState> = {}): FieldState {
  return {
    value: "",
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    ...overrides,
  };
}

function makeNodeState(entries: Array<[object, FieldState]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) map.set(node, state);
  return map;
}

// ─── collectLeafStates ───────────────────────────────────────────────────────

describe("collectLeafStates", () => {
  it("collects leaf nodes with their paths", () => {
    const nameNode: AnyConfigNode = { value: "" };
    const ageNode: AnyConfigNode = { value: 0 };
    const form: AnyConfigNode = { name: nameNode, age: ageNode };
    const nodeState = makeNodeState([
      [nameNode, makeState({ value: "Bob" })],
      [ageNode, makeState({ value: 30 })],
    ]);

    const leaves = collectLeafStates(form, nodeState);

    expect(leaves).toHaveLength(2);
    expect(leaves.find((l) => l.path === "name")?.state.value).toBe("Bob");
    expect(leaves.find((l) => l.path === "age")?.state.value).toBe(30);
  });

  it("recursively walks nested groups with composite paths", () => {
    const cityNode: AnyConfigNode = { value: "" };
    const group: AnyConfigNode = { address: { city: cityNode } };
    const nodeState = makeNodeState([[cityNode, makeState({ value: "SPb" })]]);

    const leaves = collectLeafStates(group, nodeState);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].path).toBe("address.city");
  });

  it("skips a node with no state in nodeState", () => {
    const leaf: AnyConfigNode = { value: "" };
    const form: AnyConfigNode = { field: leaf };
    const nodeState = new WeakMap<object, FieldState>();

    const leaves = collectLeafStates(form, nodeState);

    expect(leaves).toHaveLength(0);
  });
});

// ─── applyLeafBeforeSubmit ───────────────────────────────────────────────────

describe("applyLeafBeforeSubmit", () => {
  it("applies the beforeSubmit transform to a leaf", () => {
    const leaf: AnyConfigNode = {
      value: "",
      beforeSubmit: (v: unknown) => String(v).trim(),
    };
    const form: AnyConfigNode = { name: leaf };

    const result = applyLeafBeforeSubmit(form, { name: "  Alice  " });

    expect(result.name).toBe("Alice");
  });

  it("passes the current snapshot as beforeSubmit's second argument", () => {
    const transformFn = vi.fn((v: unknown) => v);
    const leaf: AnyConfigNode = { value: "", beforeSubmit: transformFn };
    const form: AnyConfigNode = { field: leaf };
    const values = { field: "val" };

    applyLeafBeforeSubmit(form, values);

    expect(transformFn).toHaveBeenCalledWith("val", values);
  });

  it("does not touch leaves without beforeSubmit", () => {
    const leaf: AnyConfigNode = { value: "" };
    const form: AnyConfigNode = { name: leaf };

    const result = applyLeafBeforeSubmit(form, { name: "Bob" });

    expect(result.name).toBe("Bob");
  });

  it("recursively walks nested groups", () => {
    const leaf: AnyConfigNode = {
      value: "",
      beforeSubmit: (v: unknown) => Number(v) * 2,
    };
    const form: AnyConfigNode = { nested: { score: leaf } };

    const result = applyLeafBeforeSubmit(form, { nested: { score: 5 } });

    expect((result.nested as Record<string, unknown>)["score"]).toBe(10);
  });
});

// ─── SubmitPipeline (via Palistor) ────────────────────────────────────────────

describe("SubmitPipeline", () => {
  it("returns success:true when there are no errors and calls onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue("ok");
    const root: AnyConfigNode = { x: { value: 1 }, onSubmit };
    const store = new Palistor({ config: root });

    const result = await store.submitPipeline.execute(root);

    expect(result).toEqual({ success: true, result: "ok" });
    expect(onSubmit).toHaveBeenCalledWith({ x: 1 }, expect.any(Object), undefined);
  });

  it("returns success:false when validation errors exist", async () => {
    const root: AnyConfigNode = {
      field: { value: "", isRequired: true },
    };
    const store = new Palistor({ config: root });

    const result = await store.submitPipeline.execute(root);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("sets submitting=false in finally even when onSubmit throws", async () => {
    const root: AnyConfigNode = {
      onSubmit: vi.fn().mockRejectedValue(new Error("server error")),
    };
    const store = new Palistor({ config: root });

    await expect(store.submitPipeline.execute(root)).rejects.toThrow("server error");

    expect(store.nodes.nodeState.get(root)?.submitting).toBe(false);
  });

  it("calls afterSubmit with the result and a reset action", async () => {
    const afterSubmit = vi.fn();
    const root: AnyConfigNode = {
      onSubmit: vi.fn().mockResolvedValue(42),
      afterSubmit,
    };
    const store = new Palistor({ config: root });

    await store.submitPipeline.execute(root);

    expect(afterSubmit).toHaveBeenCalledWith(42, { reset: expect.any(Function) });
  });
});

// ─── Leaf submit — integration tests (via the proxy) ─────────────────────────

describe("Leaf submit (integration via proxy)", () => {
  it("3.7: leaf submit() calls onSubmit(value, store, parent)", async () => {
    const onSubmitSpy = vi.fn();
    const config = {
      isActive: { value: false, onSubmit: onSubmitSpy },
      name: { value: "Alice" },
    };
    const store = new Palistor({ config });
    store.proxy.isActive.value = true;
    const result = await store.proxy.isActive.submit();
    expect(result.success).toBe(true);
    expect(onSubmitSpy).toHaveBeenCalledWith(
      true,
      store,
      expect.anything(),
    );
  });

  it("3.8: the leaf submitting flag is set while the submit runs", async () => {
    let capturedSubmitting: boolean | undefined;
    const config = {
      toggle: {
        value: false,
        onSubmit: () => {
          capturedSubmitting = store.proxy.toggle.submitting;
          return Promise.resolve();
        },
      },
    };
    const store = new Palistor({ config });
    store.proxy.toggle.value = true;
    expect(store.proxy.toggle.submitting).toBe(false);
    await store.proxy.toggle.submit();
    expect(capturedSubmitting).toBe(true);
    expect(store.proxy.toggle.submitting).toBe(false);
  });

  it("3.9: leaf submit() returns errors on a validation failure", async () => {
    const config = {
      email: {
        value: "",
        validate: (v: string) => (!v ? "Required" : undefined),
        onSubmit: vi.fn(),
      },
    };
    const store = new Palistor({ config });
    const result = await store.proxy.email.submit();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].message).toBe("Required");
    }
  });

  it("3.10: the leaf onSubmit receives a parent proxy with sibling access", async () => {
    const spy = vi.fn();
    const config = {
      isActive: {
        value: true,
        onSubmit: (value: unknown, _store: unknown, parent: any) => {
          spy(value, parent.name.value);
        },
      },
      name: { value: "Alice" },
    };
    const store = new Palistor({ config });
    const result = await store.proxy.isActive.submit();
    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith(true, "Alice");
  });

  it("3.11: store.context is available inside the leaf onSubmit", async () => {
    const spy = vi.fn();
    const config = {
      toggle: {
        value: false,
        onSubmit: (_value: unknown, storeArg: any) => { spy(storeArg.context.accountId); },
      },
    };
    const store = new Palistor({ config });
    store.setContext({ accountId: "acc-42" });
    store.proxy.toggle.value = true;
    await store.proxy.toggle.submit();
    expect(spy).toHaveBeenCalledWith("acc-42");
  });

  it("3.12: leaf submit() does not interfere with the group-level submit pipeline", async () => {
    const leafSubmitSpy = vi.fn();
    const groupSubmitSpy = vi.fn().mockResolvedValue("ok");
    const config = {
      toggle: { value: true, onSubmit: leafSubmitSpy },
      onSubmit: groupSubmitSpy,
    };
    const store = new Palistor({ config });

    const leafResult = await store.proxy.toggle.submit();
    expect(leafResult.success).toBe(true);
    expect(leafSubmitSpy).toHaveBeenCalledWith(true, store, expect.anything());

    const groupResult = await store.submit();
    expect(groupSubmitSpy).toHaveBeenCalled();
    expect(groupResult.success).toBe(true);
  });

  it("3.13: the group onSubmit receives parent as the third argument (backward-compatible)", async () => {
    const spy = vi.fn();
    const config = {
      name: { value: "Alice" },
      onSubmit: spy,
    };
    const store = new Palistor({ config });
    await store.submit();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alice" }),
      store,
      undefined,
    );
  });
});
