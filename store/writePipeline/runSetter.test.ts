import { describe, it, expect, vi } from "vitest";
import { runSetter } from "./runSetter";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { buildValuesCache } from "../valuesCache/valuesCache";

function makeState(value: unknown): FieldState {
  return { value, isVisible: true, isRequired: false, isDisabled: false, isReadOnly: false };
}

describe("runSetter", () => {
  it("применяет патч от setter к зависимым полям", () => {
    const targetNode: AnyConfigNode = { value: "4111" };
    const node: AnyConfigNode = {
      value: "card",
      setter: (v: unknown) => (v === "bank" ? { cardNumber: "" } : {}),
    };
    const root: AnyConfigNode = { paymentType: node, cardNumber: targetNode };
    const nodeState = new WeakMap<object, FieldState>([
      [node, makeState("card")],
      [targetNode, makeState("4111")],
    ]);
    const cache = buildValuesCache(root, nodeState);

    const changed = runSetter(node, "bank", root, nodeState, cache, undefined);

    expect(nodeState.get(targetNode)!.value).toBe("");
    expect(changed.has(targetNode)).toBe(true);
  });

  it("логирует ошибку и возвращает пустой Set если setter вернул не-объект", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const node: AnyConfigNode = { value: "x", setter: () => null as unknown as Record<string, unknown> };
    const root: AnyConfigNode = { field: node };
    const nodeState = new WeakMap<object, FieldState>([[node, makeState("x")]]);
    const cache = buildValuesCache(root, nodeState);

    const changed = runSetter(node, "y", root, nodeState, cache, undefined);

    expect(changed.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("передаёт текущие значения и previousValue в setter", () => {
    const setterSpy = vi.fn(() => ({}));
    const otherNode: AnyConfigNode = { value: "active" };
    const node: AnyConfigNode = { value: "x", setter: setterSpy };
    const root: AnyConfigNode = { source: node, status: otherNode };
    const nodeState = new WeakMap<object, FieldState>([
      [node, makeState("x")],
      [otherNode, makeState("active")],
    ]);
    const cache = buildValuesCache(root, nodeState);

    runSetter(node, "y", root, nodeState, cache, undefined, "prev");

    expect(setterSpy).toHaveBeenCalledWith("y", { source: "x", status: "active" }, "prev");
  });

  it("скоупит values и patch к родительской группе (вложенный setter)", () => {
    // Структура: root → group → { trigger (setter), target }
    const targetNode: AnyConfigNode = { value: "" };
    const triggerNode: AnyConfigNode = {
      value: false,
      setter: (v: unknown, values: Record<string, unknown>) => {
        // setter должен видеть sibling-значения группы, а не root
        if (v) return { target: values.shared ?? "fallback" };
        return {};
      },
    };
    const sharedNode: AnyConfigNode = { value: "group-val" };
    const groupNode: AnyConfigNode = { trigger: triggerNode, target: targetNode, shared: sharedNode };
    const root: AnyConfigNode = { group: groupNode };
    const nodeState = new WeakMap<object, FieldState>([
      [triggerNode, makeState(false)],
      [targetNode, makeState("")],
      [sharedNode, makeState("group-val")],
    ]);
    const cache = buildValuesCache(root, nodeState);

    // parentNode = groupNode, parentPath = "group"
    const changed = runSetter(triggerNode, true, groupNode, nodeState, cache, "group");

    expect(nodeState.get(targetNode)!.value).toBe("group-val");
    expect(changed.has(targetNode)).toBe(true);
  });
});
