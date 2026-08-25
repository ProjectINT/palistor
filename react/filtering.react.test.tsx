/**
 * Filtering through useForm (tracking proxy).
 *
 * - a component rendering `list.values` re-renders on a keystroke in a client
 *   (`where`) filter field without ever reading the filter;
 * - a component reading only `filter.isActive` re-renders when a field flips
 *   between empty and set;
 * - `filter.<field>` binds to an input like any leaf proxy and stays in sync;
 * - `filter.isPending` re-renders across a debounce gap.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Vehicle = { id: string; name: string };

const DATA: Vehicle[] = [
  { id: "v1", name: "Alpha" },
  { id: "v2", name: "Beta" },
  { id: "v3", name: "Alpine" },
];

function makeStore(extra?: Record<string, unknown>) {
  return new Palistor({
    config: {
      vehicles: defineList<Vehicle>({
        template: { id: { value: "" }, name: { value: "" } },
        filter: {
          search: {
            value: "",
            where: (v: any, q: string) =>
              String(v.name).toLowerCase().includes(String(q).toLowerCase()),
          },
          ...(extra ?? {}),
        },
        resolve: { resolver: async () => DATA },
      }),
    } as any,
  });
}

describe("filtering + useForm", () => {
  it("a component rendering list.values re-renders on a client filter keystroke", async () => {
    const store = makeStore();
    let renders = 0;

    function Rows() {
      const form = useForm(store) as any;
      renders++;
      const rows: any[] = form.vehicles.values ?? [];
      return (
        <ul data-testid="rows">
          {rows.map((v: any) => (
            <li key={v.id}>{v.name.value}</li>
          ))}
        </ul>
      );
    }

    render(<Rows />);
    await act(async () => {
      await flushPromises();
    });
    expect(screen.getByTestId("rows").children.length).toBe(3);

    const before = renders;
    await act(async () => {
      (store.proxy.vehicles as any).filter.search.value = "alp";
      await flushPromises();
    });
    expect(renders).toBeGreaterThan(before);
    expect(screen.getByTestId("rows").children.length).toBe(2);
  });

  it("filter.<field> binds like a leaf proxy; isActive re-renders on empty↔set flips", async () => {
    const store = makeStore();

    function Toolbar() {
      const form = useForm(store) as any;
      const filter = form.vehicles.filter;
      return (
        <div>
          <input
            data-testid="search"
            value={filter.search.value}
            onChange={(e) => filter.search.onValueChange(e.target.value)}
          />
          <span data-testid="active">{String(filter.isActive)}</span>
          <span data-testid="count">{filter.activeCount}</span>
        </div>
      );
    }

    render(<Toolbar />);
    await act(async () => {
      await flushPromises();
    });
    expect(screen.getByTestId("active").textContent).toBe("false");

    await act(async () => {
      (store.proxy.vehicles as any).filter.search.value = "alp";
      await flushPromises();
    });
    expect((screen.getByTestId("search") as HTMLInputElement).value).toBe("alp");
    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(screen.getByTestId("count").textContent).toBe("1");

    await act(async () => {
      (store.proxy.vehicles as any).filter.clear();
      await flushPromises();
    });
    expect(screen.getByTestId("active").textContent).toBe("false");
  });

  it("filter.isPending re-renders across a debounce gap", async () => {
    const resolver = vi.fn(async () => DATA);
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" } },
          filter: { search: { value: "", debounce: 40 } },
          resolve: { resolver },
        }),
      } as any,
    });

    function Spinner() {
      const form = useForm(store) as any;
      // touch the list so the lazy resolve starts
      void form.vehicles.length;
      return <span data-testid="pending">{String(form.vehicles.filter.isPending)}</span>;
    }

    render(<Spinner />);
    await act(async () => {
      await flushPromises();
    });
    expect(screen.getByTestId("pending").textContent).toBe("false");
    expect(resolver).toHaveBeenCalledTimes(1);

    await act(async () => {
      (store.proxy.vehicles as any).filter.search.value = "al";
    });
    expect(screen.getByTestId("pending").textContent).toBe("true");

    await act(async () => {
      await delay(70);
      await flushPromises();
    });
    expect(screen.getByTestId("pending").textContent).toBe("false");
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
