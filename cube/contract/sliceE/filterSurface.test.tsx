/**
 * Filter surface beyond store/filtering.test.ts. New in the contract (Phase
 * 2.3); every case follows from store's design (FilteringPlan.md) and is green
 * on store:
 *
 *  - filter fields are ordinary leaves: formatter, setter (patches siblings in
 *    the block), computed flags over the filter's own values, own onChange;
 *  - a filter is view state outside the form: the root onChange, getValues()
 *    and the resolver's `values` never see it;
 *  - `list.filter` keys: the fields, then the seven builtins;
 *  - a filtered list nested in a form group;
 *  - a resolver-less list never goes pending;
 *  - the projection follows a row edited through the item's own field;
 *  - useForm: a rows component follows a `where` keystroke, a toolbar reading
 *    only the filter does not re-render on row data.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Palistor, defineList, useForm } from "@impl";

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Vehicle = { id: string; name: string; brand_id: string };

const VEHICLES: Vehicle[] = [
  { id: "v1", name: "Alpha", brand_id: "b1" },
  { id: "v2", name: "Beta", brand_id: "b2" },
  { id: "v3", name: "Alpine", brand_id: "b1" },
];

const template = { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } };
const byName = (v: any, q: string) => String(v.name).toLowerCase().includes(q.toLowerCase());

describe("filter fields are ordinary leaves", () => {
  it("formatter runs on a field write and the projection sees the formatted value", async () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template,
          filter: { search: { value: "", formatter: (v: string) => v.trim(), where: byName } },
          resolve: { resolver: async () => VEHICLES },
        }),
      } as any,
    });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "  alp  ";
    expect(list.filter.search.value).toBe("alp");
    expect(list.map((v: any) => v.id)).toEqual(["v1", "v3"]);
  });

  it("a setter patches its sibling fields inside the block", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template,
          filter: {
            brand: { value: null as string | null, setter: () => ({ model: null }) },
            model: { value: "m1" as string | null },
          },
        }),
      } as any,
    });
    const filter = (store.proxy.vehicles as any).filter;
    filter.brand.value = "b1";
    expect(filter.model.value).toBe(null);
  });

  it("computed flags read the filter's own values", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template,
          filter: {
            brand: null as string | null,
            model: { value: null as string | null, isDisabled: (v: any) => !v.brand },
          },
        }),
      } as any,
    });
    const filter = (store.proxy.vehicles as any).filter;
    expect(filter.model.isDisabled).toBe(true);
    filter.brand.value = "b1";
    expect(filter.model.isDisabled).toBe(false);
  });

  it("a field's own onChange fires; the form's root onChange does not", async () => {
    const own = vi.fn();
    const root = vi.fn();
    const store = new Palistor({
      config: {
        onChange: root,
        name: { value: "" },
        vehicles: defineList<Vehicle>({
          template,
          filter: { search: { value: "", onChange: own } },
        }),
      } as any,
    });
    (store.proxy.vehicles as any).filter.search.value = "x";
    await flushPromises();
    expect(own).toHaveBeenCalledTimes(1);
    expect(own.mock.calls[0][0]).toMatchObject({ fieldKey: "search", newValue: "x", previousValue: "" });
    expect(root).not.toHaveBeenCalled();

    (store.proxy as any).name.value = "n";
    await flushPromises();
    expect(root).toHaveBeenCalledTimes(1);
  });
});

describe("a filter is outside the form", () => {
  it("the resolver's values and getValues() never contain the filter", async () => {
    let seen: Record<string, unknown> | null = null;
    const store = new Palistor({
      config: {
        name: { value: "n" },
        vehicles: defineList<Vehicle>({
          template,
          filter: { search: "" },
          resolve: {
            resolver: async (values: any) => {
              seen = { ...values };
              return VEHICLES;
            },
          },
        }),
      } as any,
    });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(Object.keys(seen!)).toEqual(["name", "vehicles"]);
    expect(Object.keys(store.getValues())).toEqual(["name", "vehicles"]);
    // store.proxy.values is not checked here: store leaks a `$filters` key into
    // it (cube/core/filter.test.ts).
  });

  it("list.filter's keys are the fields, then the seven builtins", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template,
          filter: { search: "", brand: { value: null, where: () => true } },
        }),
      } as any,
    });
    expect(Object.keys((store.proxy.vehicles as any).filter)).toEqual([
      "search", "brand", "values", "set", "reset", "clear", "isActive", "activeCount", "isPending",
    ]);
  });

  it("a filtered list inside a form group filters and resolves with ctx", async () => {
    const resolver = vi.fn(async (_v: any, _s: any, ctx: any) =>
      VEHICLES.filter((x) => !ctx.filter.values.brand || x.brand_id === ctx.filter.values.brand));
    const store = new Palistor({
      config: {
        ops: {
          vehicles: defineList<Vehicle>({
            template,
            filter: { brand: null as string | null, search: { value: "", where: byName } },
            resolve: { resolver },
          }),
        },
      } as any,
    });
    const list = (store.proxy as any).ops.vehicles;
    void list.items;
    await flushPromises();
    expect(list.length).toBe(3);

    list.filter.brand.value = "b1";
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(list.map((v: any) => v.id)).toEqual(["v1", "v3"]);

    list.filter.search.value = "pine";
    expect(list.map((v: any) => v.id)).toEqual(["v3"]);
    expect(list.fullLength).toBe(2);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("a resolver-less list with a debounced server field never goes pending", async () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({ template, filter: { search: { value: "", debounce: 30 } } }),
      } as any,
    });
    const list = store.proxy.vehicles as any;
    list.filter.search.value = "a";
    expect(list.filter.search.value).toBe("a");
    expect(list.filter.isPending).toBe(false);
    await delay(50);
    expect(list.filter.isPending).toBe(false);
  });
});

describe("the projection follows the rows", () => {
  it("a row edited through the item's own field enters or leaves the visible set", async () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template,
          filter: { search: { value: "", where: byName } },
          resolve: { resolver: async () => VEHICLES },
        }),
      } as any,
    });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp";
    expect(list.map((v: any) => v.id)).toEqual(["v1", "v3"]);
    list.getById("v2").name.value = "Alpaca";
    expect(list.map((v: any) => v.id)).toEqual(["v1", "v2", "v3"]);
    list.getById("v1").name.value = "Omega";
    expect(list.map((v: any) => v.id)).toEqual(["v2", "v3"]);
    expect(list.fullLength).toBe(3);
  });
});

describe("filtering + useForm precision", () => {
  function makeStore() {
    return new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template,
          filter: { search: { value: "", where: byName } },
          resolve: { resolver: async () => VEHICLES },
        }),
      } as any,
    });
  }

  it("a rows component follows a keystroke; a toolbar reading only the filter ignores row edits", async () => {
    const store = makeStore();
    let rowsRenders = 0;
    let toolbarRenders = 0;

    function Rows() {
      const form = useForm(store) as any;
      rowsRenders++;
      return <ul data-testid="rows">{form.vehicles.items.map((v: any) => <li key={v.id}>{v.id}</li>)}</ul>;
    }
    function Toolbar() {
      const form = useForm(store) as any;
      toolbarRenders++;
      const filter = form.vehicles.filter;
      return <span data-testid="state">{`${filter.search.value}|${filter.activeCount}`}</span>;
    }

    render(<><Rows /><Toolbar /></>);
    await act(async () => { await flushPromises(); });
    expect(screen.getByTestId("rows").children.length).toBe(3);

    const toolbarBefore = toolbarRenders;
    await act(async () => { store.set({ id: "v2", name: "Bravo" }); });
    expect(toolbarRenders).toBe(toolbarBefore);

    const rowsBefore = rowsRenders;
    await act(async () => { (store.proxy.vehicles as any).filter.search.value = "alp"; });
    expect(rowsRenders).toBeGreaterThan(rowsBefore);
    expect(screen.getByTestId("rows").children.length).toBe(2);
    expect(screen.getByTestId("state").textContent).toBe("alp|1");
  });
});
