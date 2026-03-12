import { describe, it, expect, vi } from "vitest";
import { recomputeAndNotify } from "../recomputeAndNotify";

describe("recomputeAndNotify", () => {
  it("вызывает recomputeAll и передаёт результат в notifyChanged", () => {
    const nodeA = {};
    const nodeB = {};
    const recomputeAll = vi.fn(() => new Set<object>([nodeA]));
    const notifyChanged = vi.fn();

    recomputeAndNotify(new Set(), recomputeAll, notifyChanged);

    expect(recomputeAll).toHaveBeenCalledOnce();
    expect(notifyChanged).toHaveBeenCalledWith(expect.any(Set));
    const notifiedSet = notifyChanged.mock.calls[0][0] as Set<object>;
    expect(notifiedSet.has(nodeA)).toBe(true);
  });

  it("объединяет changed с результатом recomputeAll", () => {
    const nodeA = {};
    const nodeB = {};
    const recomputeAll = vi.fn(() => new Set<object>([nodeA]));
    const notifyChanged = vi.fn();

    recomputeAndNotify(new Set([nodeB]), recomputeAll, notifyChanged);

    const notifiedSet = notifyChanged.mock.calls[0][0] as Set<object>;
    expect(notifiedSet.has(nodeA)).toBe(true);
    expect(notifiedSet.has(nodeB)).toBe(true);
  });

  it("работает с пустыми множествами", () => {
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();

    recomputeAndNotify(new Set(), recomputeAll, notifyChanged);

    expect(notifyChanged).toHaveBeenCalledWith(new Set());
  });
});
