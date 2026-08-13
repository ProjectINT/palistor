/**
 * React reactivity for the list resolve-error surface.
 *
 * `list.error` / `list.resolveStatus` are only useful if a component reading
 * them re-renders when the resolve state flips. The tracking proxy registers
 * the `ListState` object for these keys (see createTrackingProxy); without that
 * registration the value reads correctly exactly once and then goes stale —
 * which is why render counts are asserted, not just the final text.
 */

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

describe("list.error reactivity", () => {
  it("re-renders on success→error and on error→success via reload()", async () => {
    const boom = new Error("network down");
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt++;
      // fail, succeed, fail — exercising both transitions.
      if (attempt === 2) return [{ id: "u1", name: "Alice" }];
      throw boom;
    });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    let renders = 0;
    function View() {
      renders++;
      const form = useForm(store) as any;
      const list = form.users;
      return (
        <div>
          <span data-testid="error">{String(!!list.error)}</span>
          <span data-testid="status">{list.resolveStatus}</span>
          <span data-testid="count">{list.length}</span>
          <button data-testid="retry" onClick={() => list.reload()}>
            retry
          </button>
        </div>
      );
    }

    render(<View />);
    await act(async () => {
      await flushPromises();
    });

    // ── error appears ────────────────────────────────────────────────────────
    const afterFirstError = renders;
    expect(afterFirstError).toBeGreaterThan(1);
    expect(screen.getByTestId("error").textContent).toBe("true");
    expect(screen.getByTestId("status").textContent).toBe("error");

    // ── error disappears on a successful reload ──────────────────────────────
    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
      await flushPromises();
    });

    expect(renders).toBeGreaterThan(afterFirstError);
    expect(screen.getByTestId("error").textContent).toBe("false");
    expect(screen.getByTestId("status").textContent).toBe("resolved");
    expect(screen.getByTestId("count").textContent).toBe("1");

    // ── and comes back when the next reload fails ────────────────────────────
    const afterSuccess = renders;
    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
      await flushPromises();
    });

    expect(renders).toBeGreaterThan(afterSuccess);
    expect(screen.getByTestId("error").textContent).toBe("true");
    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("re-renders a per-entity list on error and on recovery", async () => {
    const boom = new Error("boom");
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw boom;
      return [{ id: "c1", phone: "+1" }];
    });

    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList({
              template: { id: { value: "" }, phone: { value: "" } },
              resolve: { resolver, onError: vi.fn() },
            }),
          },
        }),
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    let renders = 0;
    function Contacts() {
      renders++;
      const form = useForm(store) as any;
      const list = form.users.items[0].contacts;
      return (
        <div>
          <span data-testid="error">{String(!!list.error)}</span>
          <span data-testid="count">{list.length}</span>
          <button data-testid="retry" onClick={() => list.reload()}>
            retry
          </button>
        </div>
      );
    }

    render(<Contacts />);
    await act(async () => {
      await flushPromises();
    });

    const afterError = renders;
    expect(afterError).toBeGreaterThan(1);
    expect(screen.getByTestId("error").textContent).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
      await flushPromises();
    });

    expect(renders).toBeGreaterThan(afterError);
    expect(screen.getByTestId("error").textContent).toBe("false");
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("re-renders a component that reads ONLY list.error / list.resolveStatus", async () => {
    // The guard for the tracking-proxy branch: no `items`/`length` read here,
    // so the ListState lands in the tracked set only if `error`/`resolveStatus`
    // register it themselves. The resolve is kicked off from outside React.
    const boom = new Error("boom");
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async () => {
              throw boom;
            },
            onError: vi.fn(),
          },
        }),
      } as any,
    });

    let renders = 0;
    function View() {
      renders++;
      const form = useForm(store) as any;
      const list = form.users;
      return (
        <div>
          <span data-testid="error">{String(!!list.error)}</span>
          <span data-testid="status">{list.resolveStatus}</span>
        </div>
      );
    }

    render(<View />);
    expect(screen.getByTestId("error").textContent).toBe("false");
    const beforeResolve = renders;

    await act(async () => {
      // Trigger from outside the component — nothing in the render path reads
      // items/length, so this is the only way the resolve starts.
      (store.proxy as any).users.reload();
      await flushPromises();
    });

    expect(renders).toBeGreaterThan(beforeResolve);
    expect(screen.getByTestId("error").textContent).toBe("true");
    expect(screen.getByTestId("status").textContent).toBe("error");
  });

  it("a component reading only list.error does not re-render on unrelated field changes", async () => {
    const store = new Palistor({
      config: {
        filter: { value: "" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: async () => [{ id: "u1", name: "Alice" }], onError: vi.fn() },
        }),
      } as any,
    });

    let renders = 0;
    function View() {
      renders++;
      const form = useForm(store) as any;
      return <span data-testid="error">{String(!!form.users.error)}</span>;
    }

    render(<View />);
    await act(async () => {
      await flushPromises();
    });

    const settled = renders;
    await act(async () => {
      (store.proxy as any).filter.value = "abc";
      await flushPromises();
    });

    expect(renders).toBe(settled);
  });
});
