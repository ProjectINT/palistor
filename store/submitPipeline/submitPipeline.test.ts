import { describe, it, expect, vi } from "vitest";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { getSubValues } from "./getSubValues";
import { collectLeafStates } from "./collectLeafStates";
import { applyLeafBeforeSubmit } from "./applyLeafBeforeSubmit";
import { Palistor } from "../store/palistor";

// ─── Хелперы ─────────────────────────────────────────────────────────────────

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

function makeCache(values: Record<string, unknown>) {
  return {
    values,
    nodeSlot: new WeakMap(),
    groupSlot: new WeakMap(),
  };
}

function makeNodeState(entries: Array<[object, FieldState]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) map.set(node, state);
  return map;
}

// ─── getSubValues ─────────────────────────────────────────────────────────────

describe("getSubValues", () => {
  it("возвращает весь кеш для корневого узла", () => {
    const root: AnyConfigNode = { name: { value: "" } };
    const cache = makeCache({ name: "Alice" });
    const nodePaths = new WeakMap<object, string>();

    const result = getSubValues(cache, root, root, nodePaths);

    expect(result).toEqual({ name: "Alice" });
  });

  it("возвращает поддерево по пути для вложенной группы", () => {
    const sub: AnyConfigNode = { city: { value: "" } };
    const root: AnyConfigNode = { address: sub };
    const cache = makeCache({ address: { city: "Moscow" } });
    const nodePaths = new WeakMap<object, string>([[sub, "address"]]);

    const result = getSubValues(cache, sub, root, nodePaths);

    expect(result).toEqual({ city: "Moscow" });
  });

  it("возвращает snapshot — мутации не влияют на кеш", () => {
    const root: AnyConfigNode = { x: { value: "" } };
    const cache = makeCache({ x: 1 });
    const nodePaths = new WeakMap<object, string>();

    const result = getSubValues(cache, root, root, nodePaths);
    result["x"] = 999;

    expect(cache.values["x"]).toBe(1);
  });

  it("возвращает пустой объект если путь не найден в кеше", () => {
    const sub: AnyConfigNode = { field: { value: "" } };
    const root: AnyConfigNode = { nested: sub };
    const cache = makeCache({});
    const nodePaths = new WeakMap<object, string>([[sub, "missing.path"]]);

    const result = getSubValues(cache, sub, root, nodePaths);

    expect(result).toEqual({});
  });
});

// ─── collectLeafStates ───────────────────────────────────────────────────────

describe("collectLeafStates", () => {
  it("собирает листовые узлы с их путями", () => {
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

  it("рекурсивно обходит вложенные группы с составными путями", () => {
    const cityNode: AnyConfigNode = { value: "" };
    const group: AnyConfigNode = { address: { city: cityNode } };
    const nodeState = makeNodeState([[cityNode, makeState({ value: "SPb" })]]);

    const leaves = collectLeafStates(group, nodeState);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].path).toBe("address.city");
  });

  it("пропускает узел если нет state в nodeState", () => {
    const leaf: AnyConfigNode = { value: "" };
    const form: AnyConfigNode = { field: leaf };
    const nodeState = new WeakMap<object, FieldState>();

    const leaves = collectLeafStates(form, nodeState);

    expect(leaves).toHaveLength(0);
  });
});

// ─── applyLeafBeforeSubmit ───────────────────────────────────────────────────

describe("applyLeafBeforeSubmit", () => {
  it("применяет beforeSubmit трансформацию к листу", () => {
    const leaf: AnyConfigNode = {
      value: "",
      beforeSubmit: (v: unknown) => String(v).trim(),
    };
    const form: AnyConfigNode = { name: leaf };

    const result = applyLeafBeforeSubmit(form, { name: "  Alice  " });

    expect(result.name).toBe("Alice");
  });

  it("передаёт текущий snapshot как второй аргумент beforeSubmit", () => {
    const transformFn = vi.fn((v: unknown) => v);
    const leaf: AnyConfigNode = { value: "", beforeSubmit: transformFn };
    const form: AnyConfigNode = { field: leaf };
    const values = { field: "val" };

    applyLeafBeforeSubmit(form, values);

    expect(transformFn).toHaveBeenCalledWith("val", values);
  });

  it("не трогает листы без beforeSubmit", () => {
    const leaf: AnyConfigNode = { value: "" };
    const form: AnyConfigNode = { name: leaf };

    const result = applyLeafBeforeSubmit(form, { name: "Bob" });

    expect(result.name).toBe("Bob");
  });

  it("рекурсивно обходит вложенные группы", () => {
    const leaf: AnyConfigNode = {
      value: "",
      beforeSubmit: (v: unknown) => Number(v) * 2,
    };
    const form: AnyConfigNode = { nested: { score: leaf } };

    const result = applyLeafBeforeSubmit(form, { nested: { score: 5 } });

    expect((result.nested as Record<string, unknown>)["score"]).toBe(10);
  });
});

// ─── SubmitPipeline (через Palistor) ──────────────────────────────────────────

describe("SubmitPipeline", () => {
  it("возвращает success:true если нет ошибок и вызывает onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue("ok");
    const root: AnyConfigNode = { x: { value: 1 }, onSubmit };
    const store = new Palistor({ config: root });

    const result = await store.submitPipeline.execute(root);

    expect(result).toEqual({ success: true, result: "ok" });
    expect(onSubmit).toHaveBeenCalledWith({ x: 1 }, expect.any(Object), undefined);
  });

  it("возвращает success:false при наличии ошибок валидации", async () => {
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

  it("устанавливает submitting=false в finally даже при ошибке onSubmit", async () => {
    const root: AnyConfigNode = {
      onSubmit: vi.fn().mockRejectedValue(new Error("server error")),
    };
    const store = new Palistor({ config: root });

    await expect(store.submitPipeline.execute(root)).rejects.toThrow("server error");

    expect(store.nodes.nodeState.get(root)?.submitting).toBe(false);
  });

  it("вызывает afterSubmit с результатом и reset-экшеном", async () => {
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

// ─── Leaf submit — интеграционные тесты (через proxy) ────────────────────────

describe("Leaf submit (integration via proxy)", () => {
  it("3.7: leaf submit() вызывает onSubmit(value, store, parent)", async () => {
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

  it("3.8: leaf submitting флаг устанавливается во время выполнения submit", async () => {
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

  it("3.9: leaf submit() возвращает errors при ошибке валидации", async () => {
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

  it("3.10: leaf onSubmit получает parent proxy с доступом к соседним полям", async () => {
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

  it("3.11: store.context доступен внутри leaf onSubmit", async () => {
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

  it("3.12: leaf submit() не мешает group-level submit pipeline", async () => {
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

  it("3.13: group onSubmit получает parent как третий аргумент (backward-compatible)", async () => {
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
