/**
 * Translator switch, cube-only behavior (store differs, see CubeExperiment.md
 * «Фаза 2.2»): everything computed with `t` is recomputed on a switch, and
 * only nodes whose output depends on the translator re-render. The shared
 * behavior is in cube/contract/sliceD/useTranslator.react.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { Palistor, useForm, useTranslator } from "../index";

type T = (key: string) => string;
const tA: T = (k) => `A:${k}`;
const tB: T = (k) => `B:${k}`;

const makeStore = () =>
  new Palistor({
    config: {
      name: {
        value: "",
        label: (t: T) => t("name"),
        validate: (v: string, _values: unknown, t: T) => (!v ? t("required") : undefined),
      },
      agree: { value: false, isDisabled: (_values: unknown, t: T) => t("locale") === "B:locale" },
      plain: { value: "x" },
    } as any,
  });

describe("translator switch (cube-only)", () => {
  it("validate messages and t-dependent flags are recomputed (store kept the old ones until the next write)", async () => {
    const store = makeStore();
    const host = renderHook(({ t }) => useTranslator(store as any, t), { initialProps: { t: tA } });
    await act(async () => { await store.submit(); });
    const form = store.proxy as any;
    expect(form.name.errorMessage).toBe("A:required");
    expect(form.agree.isDisabled).toBe(false);

    act(() => host.rerender({ t: tB }));
    expect(form.name.errorMessage).toBe("B:required");
    expect(form.agree.isDisabled).toBe(true);
  });

  it("only readers of translated output re-render; a label reader renders once per switch", () => {
    const store = makeStore();
    const renders = { plain: 0, label: 0 };
    function Plain() { const f = useForm(store) as any; renders.plain++; return <i>{f.plain.value}</i>; }
    function Label() { const f = useForm(store) as any; renders.label++; return <b>{f.name.label}</b>; }
    render(<><Plain /><Label /></>);
    const host = renderHook(({ t }) => useTranslator(store as any, t), { initialProps: { t: tA } });
    const before = { ...renders };

    act(() => host.rerender({ t: tB }));
    expect(renders.plain).toBe(before.plain);
    expect(renders.label).toBe(before.label + 1);
  });
});
