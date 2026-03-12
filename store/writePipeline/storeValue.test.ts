import { describe, it, expect } from "vitest";
import { storeValue } from "./storeValue";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

function makeState(value: unknown): FieldState {
  return { value, isVisible: true, isRequired: false, isDisabled: false, isReadOnly: false };
}

describe("storeValue", () => {
  it("обновляет value в nodeState иммутабельно", () => {
    const node: AnyConfigNode = { value: "" };
    const original = makeState("old");
    const nodeState = new WeakMap([[node, original]]);

    expect(storeValue(node, "new", nodeState)).toBe(true);
    expect(nodeState.get(node)!.value).toBe("new");
    expect(original.value).toBe("old"); // не мутирован
  });

  it("возвращает false если узел не зарегистрирован", () => {
    const node: AnyConfigNode = { value: "" };
    expect(storeValue(node, "x", new WeakMap())).toBe(false);
  });

  it("сохраняет остальные поля FieldState", () => {
    const node: AnyConfigNode = { value: "" };
    const state: FieldState = {
      value: "old",
      isVisible: true,
      isRequired: true,
      isDisabled: false,
      isReadOnly: false,
      isInvalid: true,
      errorMessage: "required",
    };
    const nodeState = new WeakMap([[node, state]]);

    storeValue(node, "new", nodeState);

    const updated = nodeState.get(node)!;
    expect(updated.isRequired).toBe(true);
    expect(updated.isInvalid).toBe(true);
    expect(updated.errorMessage).toBe("required");
  });
});
