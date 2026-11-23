/**
 * Contract (slice J, Phase 2.8): a group resolve with `options.suspense`
 * under React <Suspense>, through the useForm boundary. store never tested
 * it in React (README: "With Suspense — automatic").
 *
 * What both implementations do: a component suspends when it renders while
 * the run is pending — mounted during the run, or re-rendered by something
 * it reads (the group's `loading`). A component that reads only the group's
 * children is not re-rendered by the run starting, so it keeps its content
 * until the result lands.
 *
 * Runs in both vitest projects: `store` proves the test itself is right,
 * `cube` shows parity. Imports only from "@impl".
 */

import { describe, it, expect, vi } from "vitest";
import React, { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { Palistor, useForm } from "@impl";
import { LOADING_ON_FIRST_READ } from "../impl";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** What the screen shows: the fallback, or the component's text. */
const shown = () => (screen.queryByTestId("fallback") ? "fallback" : screen.getByTestId("car").textContent);

/** `null`: no options block at all. */
function carStore(suspense: boolean | null = true) {
  const runs: Array<ReturnType<typeof deferred<any>>> = [];
  const store = new Palistor({
    config: {
      userId: { value: "a" },
      car: {
        resolve: {
          resolver: vi.fn((values: any) => { void values.userId; const d = deferred<any>(); runs.push(d); return d.promise; }),
          onError: vi.fn(),
          ...(suspense === null ? {} : { options: { suspense } }),
        },
        brand: { value: "default" },
      },
    } as any,
  });
  return { store, runs };
}

/** Starts the lazy run outside React. */
async function startRun(store: any) {
  try { void store.proxy.car.brand; } catch { /* idle: never throws */ }
  await flush();
}

class Boundary extends React.Component<{ children: React.ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? <div data-testid="car">boundary</div> : this.props.children; }
}

function mount(Car: React.FC) {
  return render(
    <Boundary>
      <Suspense fallback={<div data-testid="fallback">loading</div>}><Car /></Suspense>
    </Boundary>,
  );
}

describe("group resolve under <Suspense>", () => {
  it("a component mounted while the run is pending shows the fallback, then the result", async () => {
    const { store, runs } = carStore();
    await startRun(store);
    function Car() {
      const form = useForm(store) as any;
      return <div data-testid="car">{form.car.brand.value}</div>;
    }
    mount(Car);
    expect(shown()).toBe("fallback");
    await act(async () => { runs[0].resolve({ brand: "Toyota" }); await flush(); });
    expect(shown()).toBe("Toyota");
  });

  it("the first render starts the run without suspending; a re-render on `loading` suspends", async () => {
    const { store, runs } = carStore();
    let renders = 0;
    function Car() {
      const form = useForm(store) as any;
      renders++;
      const loading = form.car.loading;
      return <div data-testid="car">{String(loading)}:{form.car.brand.value}</div>;
    }
    mount(Car);
    expect(shown()).toBe(`${LOADING_ON_FIRST_READ}:default`); // Cube: the run this read made due already reads as loading
    await act(async () => { await flush(); });
    expect(shown()).toBe("fallback");
    await act(async () => { runs[0].resolve({ brand: "Toyota" }); await flush(); });
    expect(shown()).toBe("false:Toyota");
    expect(renders).toBeGreaterThanOrEqual(3);
  });

  it("a resolver error ends the fallback with the defaults; nothing reaches an error boundary", async () => {
    const { store, runs } = carStore();
    await startRun(store);
    function Car() {
      const form = useForm(store) as any;
      return <div data-testid="car">{form.car.brand.value}</div>;
    }
    mount(Car);
    expect(shown()).toBe("fallback");
    await act(async () => { runs[0].reject(new Error("boom")); await flush(); });
    expect(shown()).toBe("default");
  });

  it("a component reading only the children keeps its content while a restart runs", async () => {
    const { store, runs } = carStore();
    await startRun(store);
    runs[0].resolve({ brand: "A" });
    await flush();
    function Car() {
      const form = useForm(store) as any;
      return <div data-testid="car">{form.car.brand.value}</div>;
    }
    mount(Car);
    expect(shown()).toBe("A");
    await act(async () => { (store.proxy as any).userId.value = "b"; await flush(); });
    expect(runs).toHaveLength(2);
    expect(shown()).toBe("A");
    await act(async () => { runs[1].resolve({ brand: "B" }); await flush(); });
    expect(shown()).toBe("B");
  });

  it("without suspense the component renders through the run and shows `loading`", async () => {
    const { store, runs } = carStore(null);
    function Car() {
      const form = useForm(store) as any;
      return <div data-testid="car">{String(form.car.loading)}:{form.car.brand.value}</div>;
    }
    mount(Car);
    expect(shown()).toBe(`${LOADING_ON_FIRST_READ}:default`); // Cube: the run this read made due already reads as loading
    await act(async () => { await flush(); });
    expect(shown()).toBe("true:default");
    await act(async () => { runs[0].resolve({ brand: "Toyota" }); await flush(); });
    expect(shown()).toBe("false:Toyota");
  });

  it("a sibling under its own useForm and outside the Suspense boundary never suspends", async () => {
    const { store, runs } = carStore();
    await startRun(store);
    function Car() {
      const form = useForm(store) as any;
      return <div data-testid="car">{form.car.brand.value}</div>;
    }
    function User() {
      const form = useForm(store) as any;
      return <div data-testid="user">{form.userId.value}</div>;
    }
    render(
      <>
        <User />
        <Suspense fallback={<div data-testid="fallback">loading</div>}><Car /></Suspense>
      </>,
    );
    expect(screen.getByTestId("user").textContent).toBe("a");
    expect(shown()).toBe("fallback");
    await act(async () => { runs[0].resolve({ brand: "Toyota" }); await flush(); });
    expect(shown()).toBe("Toyota");
    expect(screen.getByTestId("user").textContent).toBe("a");
  });
});
