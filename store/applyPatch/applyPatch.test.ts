import { describe, it, expect } from "vitest";
import { applyPatch } from "./applyPatch";
import type { FieldState } from "../compute";
import type { AnyConfigNode } from "../store/types";

// ─── Хелперы ─────────────────────────────────────────────────────────────────

function makeState(value: unknown): FieldState {
  return {
    value,
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
  };
}

function makeNodeState(entries: Array<[object, FieldState]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) map.set(node, state);
  return map;
}

// ─── applyPatch ──────────────────────────────────────────────────────────────

describe("applyPatch", () => {
  it("обновляет листовой узел", () => {
    const leaf: AnyConfigNode = { value: "old" };
    const root: AnyConfigNode = { field: leaf };
    const nodeState = makeNodeState([[leaf, makeState("old")]]);

    const changed = applyPatch(root, nodeState, { field: "new" }, new Set());

    expect(nodeState.get(leaf)!.value).toBe("new");
    expect(changed.has(leaf)).toBe(true);
  });

  it("не обновляет если значение не изменилось", () => {
    const leaf: AnyConfigNode = { value: "same" };
    const root: AnyConfigNode = { field: leaf };
    const nodeState = makeNodeState([[leaf, makeState("same")]]);

    const changed = applyPatch(root, nodeState, { field: "same" }, new Set());

    expect(changed.size).toBe(0);
  });

  it("рекурсивно обходит вложенные группы", () => {
    const cityNode: AnyConfigNode = { value: "" };
    const zipNode: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = {
      address: { city: cityNode, zip: zipNode },
    };
    const nodeState = makeNodeState([
      [cityNode, makeState("")],
      [zipNode, makeState("")],
    ]);

    const changed = applyPatch(root, nodeState, {
      address: { city: "Moscow" },
    }, new Set());

    expect(nodeState.get(cityNode)!.value).toBe("Moscow");
    expect(nodeState.get(zipNode)!.value).toBe(""); // не тронут
    expect(changed.has(cityNode)).toBe(true);
    expect(changed.has(zipNode)).toBe(false);
  });

  it("обновляет несколько полей за один вызов", () => {
    const nameNode: AnyConfigNode = { value: "" };
    const emailNode: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { name: nameNode, email: emailNode };
    const nodeState = makeNodeState([
      [nameNode, makeState("")],
      [emailNode, makeState("")],
    ]);

    const changed = applyPatch(root, nodeState, {
      name: "Alice",
      email: "alice@test.com",
    }, new Set());

    expect(nodeState.get(nameNode)!.value).toBe("Alice");
    expect(nodeState.get(emailNode)!.value).toBe("alice@test.com");
    expect(changed.size).toBe(2);
  });

  it("пропускает ключи из CONFIG_PROPS (value, label, validate…)", () => {
    const leaf: AnyConfigNode = { value: "x" };
    const root: AnyConfigNode = { field: leaf };
    const nodeState = makeNodeState([[leaf, makeState("x")]]);

    // "value" — это CONFIG_PROP, должен быть пропущен как ключ патча
    const changed = applyPatch(root, nodeState, { value: "hack" }, new Set());

    expect(changed.size).toBe(0);
  });

  it("пропускает несуществующие ключи", () => {
    const root: AnyConfigNode = { field: { value: "x" } };
    const nodeState = makeNodeState([[root.field as AnyConfigNode, makeState("x")]]);

    // nonexistent — нет в конфиге, должен быть пропущен
    const changed = applyPatch(root, nodeState, { nonexistent: "y" }, new Set());

    expect(changed.size).toBe(0);
  });

  it("не трогает массивы как групповые узлы", () => {
    const leaf: AnyConfigNode = { value: [1, 2] };
    const root: AnyConfigNode = { items: leaf };
    const nodeState = makeNodeState([[leaf, makeState([1, 2])]]);

    // Патч передаёт массив — он не должен восприниматься как группа
    const changed = applyPatch(root, nodeState, { items: [3, 4] }, new Set());

    expect(nodeState.get(leaf)!.value).toEqual([3, 4]);
    expect(changed.has(leaf)).toBe(true);
  });

  it("добавляет в существующий changed Set", () => {
    const leaf1: AnyConfigNode = { value: "a" };
    const leaf2: AnyConfigNode = { value: "b" };
    const root: AnyConfigNode = { f1: leaf1, f2: leaf2 };
    const nodeState = makeNodeState([
      [leaf1, makeState("a")],
      [leaf2, makeState("b")],
    ]);

    const existing = new Set<object>([leaf1]);
    const changed = applyPatch(root, nodeState, { f2: "B" }, existing);

    // Должен содержать и leaf1 (из existing), и leaf2 (из патча)
    expect(changed.has(leaf1)).toBe(true);
    expect(changed.has(leaf2)).toBe(true);
    expect(changed.size).toBe(2);
  });
});
