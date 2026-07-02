/**
 * Регрессия: isVisible ГРУППЫ, зависящий от листа ДРУГОЙ sibling-группы,
 * должен пересчитываться при targeted recompute.
 *
 * Баг: compute-запись группового узла (с isVisible) лежит в groupComputeMap
 * под РОДИТЕЛЕМ, но кросс-групповая зависимость писалась на own-path группы.
 * При изменении листа соседней группы recompute трогал только детей группы,
 * но не её собственный isVisible-энтри (он под родителем), и isVisible
 * оставался устаревшим. Фикс: реципиент зависимости = путь родительской
 * группы (владельца compute-записи). См. GroupDepsMap.getTrackingWrap.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "../../store";

describe("cross-group group isVisible — targeted recompute", () => {
  it("isVisible группы реагирует на лист соседней sibling-группы", () => {
    const store = new Palistor({
      config: {
        a: { kind: { value: "" } },
        b: {
          x: { value: "" },
          isVisible: (values: any) => values.a.kind === "yes",
        },
      } as any,
    });

    const bNode = (store as any).rootConfig.b;
    // Изначально a.kind !== "yes" → b скрыт.
    expect(store.nodes.nodeState.get(bNode)?.isVisible).toBe(false);
    expect((store.proxy as any).b.isVisible).toBe(false);

    // Пишем в лист другой группы — b.isVisible должен стать true.
    (store.proxy as any).a.kind.value = "yes";
    expect((store.proxy as any).b.isVisible).toBe(true);

    // И обратно — реактивность работает в обе стороны.
    (store.proxy as any).a.kind.value = "no";
    expect((store.proxy as any).b.isVisible).toBe(false);
  });

  it("isVisible группы реагирует на лист во ВЛОЖЕННОЙ соседней группе", () => {
    const store = new Palistor({
      config: {
        source: {
          inner: { flag: { value: "off" } },
        },
        target: {
          y: { value: "" },
          isVisible: (values: any) => values.source.inner.flag === "on",
        },
      } as any,
    });

    const targetNode = (store as any).rootConfig.target;
    expect(store.nodes.nodeState.get(targetNode)?.isVisible).toBe(false);

    (store.proxy as any).source.inner.flag.value = "on";
    expect((store.proxy as any).target.isVisible).toBe(true);
  });
});
