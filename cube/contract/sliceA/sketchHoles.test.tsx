/**
 * Contract for the holes of the Phase 0 sketch that Phase 1 closes
 * (experiments/CubePlan.md, Phase 1). Every case is store behavior: the file
 * runs green on both implementations.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { Palistor, useForm } from "@impl";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("children namespace", () => {
  it("a leaf child named `length` (palirent vehicleForm/parameters) is an ordinary field", () => {
    const store = new Palistor({
      config: {
        type: { value: "car" },
        length: { value: null as number | null, isVisible: (v: any) => v.type === "boat" },
        dims: { length: { value: 1 }, width: { value: 2 } },
      } as any,
    });
    const form = store.proxy as any;

    // store seeds a leaf with `initialValues[key] ?? config.value ?? ""`: null reads as "".
    expect(form.length.value).toBe("");
    expect(form.length.isVisible).toBe(false);
    form.type.value = "boat";
    form.length.value = 12;
    form.dims.length.value = 5;

    expect(form.length.isVisible).toBe(true);
    expect(store.getValues()).toEqual({ type: "boat", length: 12, dims: { length: 5, width: 2 } });
    expect(Object.keys(form.dims)).not.toContain("length");
  });
});

describe("resolve dependencies", () => {
  it("a value read AFTER an await is a dependency too", async () => {
    let calls = 0;
    const store = new Palistor({
      config: {
        a: { value: "x" },
        b: { value: "1" },
        out: {
          resolve: {
            resolver: async (values: any) => {
              calls++;
              const a = values.a;
              await Promise.resolve();
              return { text: `${a}-${values.b}` };
            },
            onError: vi.fn(),
          },
          text: { value: "" },
        },
      } as any,
    });
    const form = store.proxy as any;

    void form.out.text.value;
    await flush();
    expect(form.out.text.value).toBe("x-1");

    form.b.value = "2";
    await flush();
    expect(calls).toBe(2);
    expect(form.out.text.value).toBe("x-2");
  });

  it("a list with `lazy: false` loads right after construction", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Ann" }]);
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }, { resolve: { resolver, onError: vi.fn(), options: { lazy: false } } }],
      } as any,
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    await flush();
    expect((store.proxy as any).users.items[0].name.value).toBe("Ann");
  });
});

describe("useForm boundary", () => {
  it("spread through useForm gives the store proxy's keys and subscribes to the field", () => {
    const store = new Palistor({ config: { email: { value: "", label: "Email" }, other: { value: "" } } });
    let renders = 0;
    let keys: string[] = [];

    function Email() {
      const form = useForm(store);
      renders++;
      const props = { ...form.email };
      keys = Object.keys(props);
      return <span>{props.value}</span>;
    }

    render(<Email />);
    expect(keys).toEqual(Object.keys({ ...store.proxy.email }));
    const mounted = renders;

    act(() => { store.proxy.other.value = "x"; });
    expect(renders).toBe(mounted);
    act(() => { store.proxy.email.value = "a@b"; });
    expect(renders).toBe(mounted + 1);
  });

  it("a component without useForm does not leak its reads into the parent's subscription", () => {
    const store = new Palistor({ config: { a: { value: "" }, b: { value: "" } } });
    let parent = 0;
    let child = 0;

    function Child() {
      child++;
      return <i>{store.proxy.b.value}</i>; // reads the raw proxy: no subscription anywhere
    }
    function Parent() {
      const form = useForm(store);
      parent++;
      return <div>{form.a.value}<Child /></div>;
    }

    render(<Parent />);
    const p = parent;
    const c = child;
    act(() => { store.proxy.b.value = "x"; });
    expect(parent).toBe(p);
    expect(child).toBe(c);
    act(() => { store.proxy.a.value = "y"; });
    expect(parent).toBe(p + 1);
  });

  it("getSnapshot is stable: no React warning across mount and writes", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new Palistor({
      config: { mode: { value: "a" }, field: { value: "", isVisible: (v: any) => v.mode === "a" } },
    });

    function Field() {
      const form = useForm(store);
      return <span>{form.field.isVisible ? form.field.value : "-"}{form.mode.value}</span>;
    }

    render(<><Field /><Field /></>);
    act(() => { store.proxy.mode.value = "b"; });
    act(() => { store.proxy.field.value = "x"; });
    act(() => { store.proxy.mode.value = "a"; });

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
