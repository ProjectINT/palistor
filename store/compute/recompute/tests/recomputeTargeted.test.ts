import { describe, it, expect } from "vitest";
import { recomputeTargeted } from "../recomputeTargeted";
import type { AnyConfigNode } from "../../../types";
import type { FieldState } from "../../index";
import type { GroupLeafMap } from "../../../registerNodes";
import type { ValuesCache } from "../../../valuesCache";
import { pairKey } from "../../../groupDeps";

const translate = (...args: any[]) => String(args[0]);

function makeCache(values: Record<string, unknown> = {}): ValuesCache {
  return { values, nodeSlot: new WeakMap() };
}

describe("recomputeTargeted", () => {
  it("пересчитывает группу изменённого узла", () => {
    const fieldNode = { value: "" } as unknown as AnyConfigNode;
    const root = { field: fieldNode } as unknown as AnyConfigNode;

    const nodeParents = new WeakMap<object, object>([[fieldNode, root]]);
    const nodePaths = new WeakMap<object, string>([[root, ""], [fieldNode, "field"]]);
    const groupLeafMap: GroupLeafMap = new WeakMap([
      [root, [{ node: fieldNode, path: "field" }]],
    ]);
    const nodeState = new WeakMap<object, FieldState>();
    const groupDeps = new Set<string>();

    const result = recomputeTargeted(new Set([fieldNode]), {
      rootConfig: root,
      groupLeafMap,
      nodeState,
      nodeParents,
      nodePaths,
      groupDeps,
      valuesCache: makeCache({ field: "" }),
      translate,
    });

    // fieldNode не имел prev-состояния → должен быть в changed
    expect(result.has(fieldNode)).toBe(true);
  });

  it("также пересчитывает группы-реципиенты через BFS", () => {
    const donorField = { value: "" } as unknown as AnyConfigNode;
    const recipientField = { value: "" } as unknown as AnyConfigNode;
    const donorGroup = { d: donorField } as unknown as AnyConfigNode;
    const recipientGroup = { r: recipientField } as unknown as AnyConfigNode;
    const root = { donor: donorGroup, recipient: recipientGroup } as unknown as AnyConfigNode;

    const nodeParents = new WeakMap<object, object>([
      [donorField, donorGroup],
      [recipientField, recipientGroup],
      [donorGroup, root],
      [recipientGroup, root],
    ]);
    const nodePaths = new WeakMap<object, string>([
      [root, ""],
      [donorGroup, "donor"],
      [donorField, "donor.d"],
      [recipientGroup, "recipient"],
      [recipientField, "recipient.r"],
    ]);
    const groupLeafMap: GroupLeafMap = new WeakMap([
      [donorGroup, [{ node: donorField, path: "donor.d" }]],
      [recipientGroup, [{ node: recipientField, path: "recipient.r" }]],
    ]);
    const nodeState = new WeakMap<object, FieldState>();
    // Зависимость: donor → recipient
    const groupDeps = new Set([pairKey("donor", "recipient")]);

    const result = recomputeTargeted(new Set([donorField]), {
      rootConfig: root,
      groupLeafMap,
      nodeState,
      nodeParents,
      nodePaths,
      groupDeps,
      valuesCache: makeCache(),
      translate,
    });

    // Оба узла должны быть пересчитаны
    expect(result.has(donorField)).toBe(true);
    expect(result.has(recipientField)).toBe(true);
  });

  it("возвращает пустой Set, если у группы нет листьев", () => {
    const groupNode = {} as unknown as AnyConfigNode;
    const root = { g: groupNode } as unknown as AnyConfigNode;

    const nodeParents = new WeakMap<object, object>([[groupNode, root]]);
    const nodePaths = new WeakMap<object, string>([[root, ""], [groupNode, "g"]]);
    const groupLeafMap: GroupLeafMap = new WeakMap([[groupNode, []]]);
    const nodeState = new WeakMap<object, FieldState>();

    const result = recomputeTargeted(new Set([groupNode]), {
      rootConfig: root,
      groupLeafMap,
      nodeState,
      nodeParents,
      nodePaths,
      groupDeps: new Set(),
      valuesCache: makeCache(),
      translate,
    });

    expect(result.size).toBe(0);
  });
});
