/**
 * usePalistor, PalistorProvider, usePalistorContext (experiments/SsrPlan.md,
 * Stages 2 and 5а), Cube only. The hook keeps one store per committed
 * component instance and builds it in the render that first reaches it, from
 * its options and the nearest provider, so the translator, the notifier and
 * the context are in the constructor: that render needs no effect. The store
 * is built held: nothing starts during a render, and an effect calls
 * `store.start()` after the commit, so a render React throws away has
 * requested nothing. After mount an effect sends a changed context,
 * translator or notifier to the same store.
 *
 * jsdom: the stores are in client mode (server mode is cube/ssr/serverMode).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  StrictMode, Suspense, createContext, startTransition, useContext, useEffect, useState, useSyncExternalStore,
  type ReactNode,
} from "react";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  Palistor,
  PalistorProvider,
  defineFlow,
  defineList,
  defineStep,
  useForm,
  usePalistor,
  usePalistorContext,
  useTranslator,
  type FieldProxyNode,
  type InitialData,
  type PalistorOptions,
  type PalistorRef,
  type ProxyStore,
} from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type T = (key: string) => string;
const en: T = (key) => `en:${key}`;
const de: T = (key) => `de:${key}`;

/** A leaf whose label goes through the translator. */
const titleConfig = () => ({
  title: { value: "", label: (t: T) => t("title") },
});

/** A root resolve that reads `store.context.accountId`; lazy, so reading `email` starts it. */
function accountConfig() {
  const seen: unknown[] = [];
  const resolver = vi.fn(async (_values: unknown, store: { context: Record<string, unknown> }) => {
    seen.push(store.context.accountId);
    return { email: `${String(store.context.accountId)}@acme.test` };
  });
  const config = { email: { value: "" }, resolve: { resolver, onError: vi.fn() } };
  return { config, resolver, seen };
}

/** A root resolve that always fails and reports through `ctx.notify`; re-runs when `filter` changes. */
const failingConfig = () => ({
  filter: { value: "" },
  resolve: {
    resolver: async (): Promise<Record<string, unknown>> => { throw new Error("load failed"); },
    deps: ["filter"],
    onError: (_error: unknown, ctx: { notify: (...args: any[]) => void }) => ctx.notify("LOAD_FAILED"),
  },
});

async function failOnce(store: ProxyStore<ReturnType<typeof failingConfig>>, filter: string) {
  await act(async () => {
    store.proxy.filter.value = filter;
    await flush();
  });
}

describe("usePalistor: one store per component instance", () => {
  it("re-renders keep the store, and the options function is called once", () => {
    const options = vi.fn(() => ({ config: titleConfig() }));
    const { result, rerender } = renderHook(() => usePalistor(options));
    const store = result.current;

    rerender();
    rerender();

    expect(store).toBeInstanceOf(Palistor);
    expect(result.current).toBe(store);
    expect(options).toHaveBeenCalledTimes(1);
  });

  it("an options object is read once too: a new object and a new config per render make no new store", () => {
    const { result, rerender } = renderHook(() => usePalistor({ config: titleConfig() }));
    const store = result.current;
    const config = store.rootConfig;

    rerender();

    expect(result.current).toBe(store);
    expect(result.current.rootConfig).toBe(config);
  });

  it("StrictMode (development): React renders the component twice, and still one store is built and what it starts, starts once", async () => {
    const eager = vi.fn(async () => ({ brand: "BMW" }));
    const lazy = vi.fn(async () => ({ name: "Ann" }));
    const onEnter = vi.fn();
    const options = vi.fn(() => ({
      config: {
        car: { resolve: { resolver: eager, onError: vi.fn(), options: { lazy: false } }, brand: { value: "" } },
        user: { resolve: { resolver: lazy, onError: vi.fn() }, name: { value: "" } },
        wizard: defineFlow({ steps: [defineStep("first", { note: { value: "" as string }, onEnter }), defineStep("second", {})] }),
      },
    }));
    const stores = new Set<unknown>();
    let renders = 0;
    function View() {
      renders++;
      const store = usePalistor(options);
      stores.add(store);
      const form = useForm(store);
      return <output>{form.car.brand.value}/{form.user.name.value}</output>;
    }
    const ui = () => <StrictMode><View /></StrictMode>;

    const { container, rerender } = render(ui());
    const rendersOnMount = renders;
    await act(flush);
    rerender(ui());
    await act(flush);

    expect(rendersOnMount).toBeGreaterThan(1); // the development double render did happen
    expect({
      stores: stores.size, // every render pass, the doubled ones included, got the same store
      options: options.mock.calls.length,
      eager: eager.mock.calls.length,
      onEnter: onEnter.mock.calls.length,
      lazy: lazy.mock.calls.length,
    }).toEqual({ stores: 1, options: 1, eager: 1, onEnter: 1, lazy: 1 });
    expect(container.textContent).toBe("BMW/Ann");
  });

  it("two components with the same config get different stores", () => {
    const config = titleConfig();
    const stores: Array<Palistor<typeof config>> = [];
    function Field({ slot }: { slot: number }) {
      const store = usePalistor({ config });
      stores[slot] = store;
      const form = useForm(store);
      return <output data-testid={`field-${slot}`}>{form.title.value}</output>;
    }
    const { getByTestId } = render(<><Field slot={0} /><Field slot={1} /></>);

    expect(stores[0]).not.toBe(stores[1]);

    act(() => { stores[0].proxy.title.value = "first"; });
    expect(getByTestId("field-0").textContent).toBe("first");
    expect(getByTestId("field-1").textContent).toBe("");
    expect(stores[1].getValues()).toEqual({ title: "" });
  });
});

describe("usePalistor: the provider's values are in the constructor", () => {
  it("context is the provider's merged with the store's own, and the store's own keys win", () => {
    const contexts: Array<Record<string, unknown>> = [];
    function Probe() {
      const store = usePalistor({ config: titleConfig(), context: { tenant: "own", accountId: "acc-1" } });
      contexts.push({ ...store.context });
      return null;
    }
    render(
      <PalistorProvider context={{ locale: "en", tenant: "provider" }}>
        <Probe />
      </PalistorProvider>,
    );

    expect(contexts[0]).toEqual({ locale: "en", tenant: "own", accountId: "acc-1" }); // the first render already
  });

  it("without a provider the store has just its own options", () => {
    const { result } = renderHook(() => usePalistor({ config: titleConfig(), context: { accountId: "acc-1" }, translator: en }));
    expect(result.current.context).toEqual({ accountId: "acc-1" });
    expect(result.current.proxy.title.label).toBe("en:title");
  });

  it("the provider's translator is applied in the first render (and in HTML rendered without effects)", () => {
    const labels: Array<string | undefined> = [];
    function Title() {
      const store = usePalistor(() => ({ config: titleConfig() }));
      const form = useForm(store);
      labels.push(form.title.label);
      return <label>{form.title.label}</label>;
    }
    const ui = <PalistorProvider translator={en}><Title /></PalistorProvider>;

    expect(renderToString(ui)).toBe("<label>en:title</label>"); // no effect ever runs here
    labels.length = 0;

    const { container } = render(ui);
    expect(labels[0]).toBe("en:title");
    expect(new Set(labels)).toEqual(new Set(["en:title"])); // never the bare key
    expect(container.textContent).toBe("en:title");
  });

  it("the store's own translator wins over the provider's", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <PalistorProvider translator={en}>{children}</PalistorProvider>;
    const { result } = renderHook(() => usePalistor({ config: titleConfig(), translator: de }), { wrapper });
    expect(result.current.proxy.title.label).toBe("de:title");
  });

  it("the provider's notifier is what resolver onError reaches when the store has none of its own", async () => {
    const provided = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <PalistorProvider notifier={provided}>{children}</PalistorProvider>;
    const { result } = renderHook(() => usePalistor(() => ({ config: failingConfig() })), { wrapper });

    await failOnce(result.current, "a");
    expect(provided).toHaveBeenCalledTimes(1);
    expect(provided).toHaveBeenCalledWith("LOAD_FAILED");
  });

  it("the store's own notifier wins over the provider's", async () => {
    const provided = vi.fn();
    const own = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <PalistorProvider notifier={provided}>{children}</PalistorProvider>;
    const { result } = renderHook(() => usePalistor(() => ({ config: failingConfig(), notifier: own })), { wrapper });

    await failOnce(result.current, "a");
    expect(own).toHaveBeenCalledTimes(1);
    expect(provided).not.toHaveBeenCalled();
  });
});

describe("usePalistor: changes after mount reach the store", () => {
  afterEach(() => { vi.restoreAllMocks(); }); // the spies on Palistor.prototype and on single stores

  it("a changed provider context: the resolver that read the key re-runs and sees the new store.context", async () => {
    const { config, resolver, seen } = accountConfig();
    function Account() {
      const form = useForm(usePalistor({ config }));
      return <output data-testid="email">{form.email.value}</output>;
    }
    const ui = (accountId: string) => <PalistorProvider context={{ accountId }}><Account /></PalistorProvider>;

    const { getByTestId, rerender } = render(ui("acc-1"));
    await act(flush);
    expect(seen).toEqual(["acc-1"]); // the first run already had the provider's context
    expect(getByTestId("email").textContent).toBe("acc-1@acme.test");

    rerender(ui("acc-2"));
    await act(flush);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["acc-1", "acc-2"]);
    expect(getByTestId("email").textContent).toBe("acc-2@acme.test");
  });

  it("a provider re-render with the same context values is not a change: nothing is pushed, nothing re-runs", async () => {
    const { config, resolver } = accountConfig();
    let store!: Palistor<typeof config>;
    function Account() {
      store = usePalistor({ config });
      return <output>{useForm(store).email.value}</output>;
    }
    const ui = () => <PalistorProvider context={{ accountId: "acc-1" }}><Account /></PalistorProvider>;

    const { rerender } = render(ui());
    await act(flush);
    const setContext = vi.spyOn(store, "setContext");

    rerender(ui()); // a new context object, the same values
    await act(flush);
    expect(setContext).not.toHaveBeenCalled();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("an inline options context with the same values is not a change either", () => {
    const config = titleConfig();
    const { result, rerender } = renderHook(() => usePalistor({ config, context: { accountId: "acc-1" } }));
    const setContext = vi.spyOn(result.current, "setContext");

    rerender();
    expect(setContext).not.toHaveBeenCalled();
  });

  it("only the keys that changed are sent, so a key the store got from elsewhere survives", () => {
    const config = titleConfig();
    let store!: Palistor<typeof config>;
    function Probe() {
      store = usePalistor({ config, context: { tenant: "acme" } });
      return null;
    }
    const ui = (accountId: string) => <PalistorProvider context={{ accountId, locale: "en" }}><Probe /></PalistorProvider>;

    const { rerender } = render(ui("acc-1"));
    store.setContext({ locale: "de", extra: true }); // not through the hook
    const setContext = vi.spyOn(store, "setContext");

    rerender(ui("acc-2"));
    expect(setContext.mock.calls).toEqual([[{ accountId: "acc-2" }]]);
    expect(store.context).toEqual({ accountId: "acc-2", locale: "de", extra: true, tenant: "acme" });
  });

  it("a changed provider translator: the label re-renders in the new language", () => {
    function Title() {
      const form = useForm(usePalistor(() => ({ config: titleConfig() })));
      return <label>{form.title.label}</label>;
    }
    const ui = (translator: T) => <PalistorProvider translator={translator}><Title /></PalistorProvider>;

    const { container, rerender } = render(ui(en));
    expect(container.textContent).toBe("en:title");

    rerender(ui(de));
    expect(container.textContent).toBe("de:title");
  });

  it("StrictMode mounts the effect twice (mount, unmount, mount): nothing is sent on mount, and a change is sent once", () => {
    const sent = {
      translator: vi.spyOn(Palistor.prototype, "setTranslator"),
      notifier: vi.spyOn(Palistor.prototype, "setNotifier"),
      context: vi.spyOn(Palistor.prototype, "setContext"),
    };
    const first = vi.fn();
    const second = vi.fn();
    let effects = 0;
    function Title() {
      const form = useForm(usePalistor(() => ({ config: titleConfig() })));
      useEffect(() => { effects++; }, []);
      return <label>{form.title.label}</label>;
    }
    const ui = (accountId: string, translator: T, notifier: () => void) => (
      <StrictMode>
        <PalistorProvider context={{ accountId, locale: "en" }} translator={translator} notifier={notifier}><Title /></PalistorProvider>
      </StrictMode>
    );

    const { container, rerender } = render(ui("acc-1", en, first));
    expect(effects).toBe(2); // the double mount did happen
    expect(container.textContent).toBe("en:title");
    expect([sent.translator, sent.notifier, sent.context].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);

    rerender(ui("acc-2", de, second));
    expect(container.textContent).toBe("de:title");
    expect(sent.translator.mock.calls).toEqual([[de]]);
    expect(sent.notifier.mock.calls).toEqual([[second]]);
    expect(sent.context.mock.calls).toEqual([[{ accountId: "acc-2" }]]);
  });

  it("a changed provider notifier: the next error goes to the new one", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let store!: ProxyStore<ReturnType<typeof failingConfig>>;
    function Probe() {
      store = usePalistor(() => ({ config: failingConfig() }));
      return null;
    }
    const ui = (notifier: () => void) => <PalistorProvider notifier={notifier}><Probe /></PalistorProvider>;

    const { rerender } = render(ui(first));
    await failOnce(store, "a");
    expect(first).toHaveBeenCalledTimes(1);

    rerender(ui(second));
    await failOnce(store, "b");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("options passed as an object are followed too: context, translator and notifier, nothing else", () => {
    const first = vi.fn();
    const second = vi.fn();
    const config = titleConfig();
    const { result, rerender } = renderHook(
      ({ accountId, translator, notifier }) =>
        usePalistor({ config, context: { accountId }, translator, notifier, initialValues: { title: accountId } }),
      { initialProps: { accountId: "acc-1", translator: en, notifier: first } },
    );
    const store = result.current;
    const setNotifier = vi.spyOn(store, "setNotifier");

    rerender({ accountId: "acc-2", translator: de, notifier: second });

    expect(result.current).toBe(store);
    expect(store.context).toEqual({ accountId: "acc-2" });
    expect(store.proxy.title.label).toBe("de:title");
    expect(setNotifier.mock.calls).toEqual([[second]]);
    expect(store.getValues()).toEqual({ title: "acc-1" }); // initialValues were read once
  });

  it("the function form was read once: its context does not follow a later prop, the provider's still does", () => {
    const config = titleConfig();
    let store!: Palistor<typeof config>;
    function Probe({ accountId }: { accountId: string }) {
      store = usePalistor(() => ({ config, context: { accountId } }));
      return null;
    }
    const ui = (accountId: string, locale: string) => (
      <PalistorProvider context={{ locale }}><Probe accountId={accountId} /></PalistorProvider>
    );

    const { rerender } = render(ui("acc-1", "en"));
    rerender(ui("acc-2", "de"));

    expect(store.context).toEqual({ accountId: "acc-1", locale: "de" });
  });

  it("the store's own key keeps winning when the provider changes the same key later", () => {
    let store!: Palistor<ReturnType<typeof titleConfig>>;
    function Probe() {
      store = usePalistor(() => ({ config: titleConfig(), context: { tenant: "own" } }));
      return null;
    }
    const ui = (tenant: string, tick: number) => <PalistorProvider context={{ tenant, tick }}><Probe /></PalistorProvider>;

    const { rerender } = render(ui("provider-1", 1));
    expect(store.context).toEqual({ tenant: "own", tick: 1 });

    rerender(ui("provider-2", 2));
    expect(store.context).toEqual({ tenant: "own", tick: 2 });
  });

  it("a key that disappears keeps its last value in the store (setContext merges)", () => {
    const config = titleConfig();
    const { result, rerender } = renderHook(
      ({ context }: { context: Record<string, unknown> }) => usePalistor({ config, context }),
      { initialProps: { context: { accountId: "acc-1", tenant: "acme" } as Record<string, unknown> } },
    );

    rerender({ context: { accountId: "acc-2" } });
    expect(result.current.context).toEqual({ accountId: "acc-2", tenant: "acme" });

    rerender({ context: { accountId: "acc-2", tenant: undefined } });
    expect(result.current.context).toEqual({ accountId: "acc-2", tenant: undefined });
  });

  it("unmount resets nothing: the store keeps its translator and context", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PalistorProvider translator={en} context={{ accountId: "acc-1" }}>{children}</PalistorProvider>
    );
    const { result, unmount } = renderHook(() => usePalistor(() => ({ config: titleConfig() })), { wrapper });
    const store = result.current;
    const setTranslator = vi.spyOn(store, "setTranslator");

    unmount();

    expect(setTranslator).not.toHaveBeenCalled();
    expect(store.proxy.title.label).toBe("en:title");
    expect(store.context).toEqual({ accountId: "acc-1" });
  });

  it("with no translator of its own the hook pushes none: useTranslator on the same store keeps working", () => {
    let store!: Palistor<ReturnType<typeof titleConfig>>;
    function Legacy() {
      useTranslator(store, en);
      return <label>{useForm(store).title.label}</label>;
    }
    function Owner({ tick }: { tick: number }) {
      store = usePalistor(() => ({ config: titleConfig() }));
      return <section data-tick={tick}><Legacy /></section>;
    }

    // The child's effect runs before the parent's: a push of "no translator" on mount would undo it.
    const { container, rerender } = render(<Owner tick={0} />);
    expect(container.textContent).toBe("en:title");

    rerender(<Owner tick={1} />);
    expect(container.textContent).toBe("en:title");
  });
});

describe("usePalistor: the store starts after the commit", () => {
  /** An eager group, a lazy list and a flow: what a constructor in the browser starts, and what a read starts. */
  function startConfig() {
    const eager = vi.fn(async () => ({ brand: "BMW" }));
    const rows = vi.fn(async () => [{ id: "u1", name: "Ann" }]);
    const onEnter = vi.fn();
    const config = {
      car: { resolve: { resolver: eager, onError: vi.fn(), options: { lazy: false } }, brand: { value: "" } },
      users: defineList<{ id: string; name: string }>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver: rows, onError: vi.fn() },
      }),
      wizard: defineFlow({ steps: [defineStep("first", { note: { value: "" as string }, onEnter }), defineStep("second", {})] }),
    };
    return { config, eager, rows, onEnter, calls: () => [eager, rows, onEnter].map((fn) => fn.mock.calls.length) };
  }

  it("the render starts nothing and reads what a server render reads; the effect starts everything once", async () => {
    const { config, calls } = startConfig();
    const firstRender: unknown[] = [];
    function View() {
      const store = usePalistor(() => ({ config }));
      const form = useForm(store);
      const frame = {
        car: form.car.loading,
        users: [form.users.loading, form.users.resolveStatus, form.users.length],
        called: calls(),
      };
      if (firstRender.length === 0) firstRender.push(frame);
      return <output>{form.car.brand.value}/{form.users.length}</output>;
    }

    // The same markup a server render of this component gives (no effect runs there).
    expect(renderToString(<View />)).toBe("<output>/<!-- -->0</output>");
    firstRender.length = 0;

    const { container } = render(<View />);
    // Due, not running: `loading` is already true, the status is still idle, no resolver and no onEnter was called.
    expect(firstRender).toEqual([{ car: true, users: [true, "idle", 0], called: [0, 0, 0] }]);
    expect(calls()).toEqual([1, 1, 1]); // render() returns after the effects

    await act(flush);
    expect(container.textContent).toBe("BMW/1");
    expect(calls()).toEqual([1, 1, 1]);
  });

  it("server: true is the manual mode: the hook starts nothing, store.start() does", async () => {
    const { config, calls } = startConfig();
    let store!: Palistor<typeof config>;
    function View() {
      store = usePalistor(() => ({ config, server: true }));
      const form = useForm(store);
      return <output>{String(form.users.loading)}/{form.users.length}</output>;
    }

    const { container, rerender } = render(<View />);
    await act(flush);
    rerender(<View />);
    await act(flush);
    expect(calls()).toEqual([0, 0, 0]);
    expect(container.textContent).toBe("true/0");

    await act(async () => { store.start(); await flush(); });
    expect(calls()).toEqual([1, 1, 1]);
    expect(container.textContent).toBe("false/1");
  });

  it("new Palistor() outside the hook is not held: in the browser its constructor starts it", () => {
    const { config, eager, onEnter } = startConfig();
    new Palistor({ config });
    expect([eager, onEnter].map((fn) => fn.mock.calls.length)).toEqual([1, 1]);
  });

  it("what a child's effect asks for before the start is not lost: the start runs it", async () => {
    const { config, rows, calls } = startConfig();
    // A child's effects run before its parent's: this one reaches the store while it is still held.
    function Reloader({ store }: { store: Palistor<typeof config> }) {
      useEffect(() => { store.proxy.users.reload(); }, [store]);
      return null;
    }
    function View() {
      const store = usePalistor(() => ({ config }));
      return <><Reloader store={store} /><output>{useForm(store).users.length}</output></>;
    }

    const { container } = render(<View />);
    await act(flush);
    expect(container.textContent).toBe("1");
    expect(rows).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual([1, 1, 1]);
  });
});

describe("usePalistor: a render React throws away starts nothing", () => {
  /** A store outside React, read through useSyncExternalStore (a router, a request counter, another state library). */
  function externalStore<V>(initial: V) {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      get: () => value,
      set(next: V) { value = next; listeners.forEach((l) => l()); },
      subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    };
  }
  const task = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

  it("an eager resolver runs once when an external store changes during an interruptible render", async () => {
    const ticker = externalStore(0);
    const eager = vi.fn(async () => ({ brand: "BMW" }));
    const lazy = vi.fn(async () => ({ name: "Ann" }));
    const onEnter = vi.fn();
    const stores = new Set<unknown>();
    const options = vi.fn(() => ({
      config: {
        car: { resolve: { resolver: eager, onError: vi.fn(), options: { lazy: false } }, brand: { value: "" } },
        user: { resolve: { resolver: lazy, onError: vi.fn() }, name: { value: "" } },
        wizard: defineFlow({ steps: [defineStep("first", { note: { value: "" as string }, onEnter }), defineStep("second", {})] }),
      },
    }));
    function Page() {
      const store = usePalistor(options);
      stores.add(store);
      const tick = useSyncExternalStore(ticker.subscribe, ticker.get, ticker.get);
      const form = useForm(store);
      return <output>{tick}:{form.car.brand.value}/{form.user.name.value}</output>;
    }
    /** Longer than one slice of React's work loop: the transition yields to the event loop after it. */
    function Slow() {
      const until = performance.now() + 40;
      while (performance.now() < until) { /* a heavy sibling */ }
      return null;
    }
    let show!: () => void;
    function App() {
      const [shown, setShown] = useState(false);
      show = () => startTransition(() => setShown(true));
      return shown ? <><Page /><Slow /><Slow /><Slow /></> : null;
    }

    // Inside act() React finishes every render in one go; the yield is the point, so this test uses the real scheduler.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      root.render(<App />);
      await task(20);
      show(); // a client navigation mounts a page the same way: in a transition

      // The page has rendered and React has yielded before committing it: something outside moves.
      let moved = false;
      for (let i = 0; i < 200 && container.textContent === ""; i++) {
        await task();
        if (!moved && stores.size === 1 && container.textContent === "") { moved = true; ticker.set(1); }
      }
      await task(20);

      expect(moved).toBe(true);
      // React saw the store move under the render and rendered the page again from scratch:
      // the first pass committed nothing and kept no hook state, so a second store was built.
      expect(stores.size).toBe(2);
      expect(container.textContent).toBe("1:BMW/Ann");
      // Only the committed instance's store starts anything.
      expect({ eager: eager.mock.calls.length, lazy: lazy.mock.calls.length, onEnter: onEnter.mock.calls.length })
        .toEqual({ eager: 1, lazy: 1, onEnter: 1 });
    } finally {
      root.unmount();
      await task();
      env.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });
});

describe("usePalistor and Suspense", () => {
  /** An eager `suspense: true` group; the resolver answers a macrotask later. */
  function carConfig() {
    const resolver = vi.fn(async () => {
      await flush();
      return { brand: "BMW" };
    });
    const config = {
      car: { resolve: { resolver, onError: vi.fn(), options: { lazy: false, suspense: true } }, brand: { value: "" } },
    };
    return { config, resolver, options: vi.fn(() => ({ config })) };
  }
  const fallback = (container: HTMLElement) => container.querySelector("i")?.textContent ?? null;

  it("an eager suspense node: the first render shows the defaults, the start brings the fallback; one store, one request", async () => {
    const { config, resolver, options } = carConfig();
    const frames: string[] = [];
    function Brand({ store }: { store: Palistor<typeof config> }) {
      const car = useForm(store).car;
      const loading = car.loading; // the node's own state: this reader follows the run
      const text = `${String(loading)}:${car.brand.value}`;
      frames.push(text);
      return <b>{text}</b>;
    }
    function Car() {
      const store = usePalistor(options);
      return <Suspense fallback={<i>loading</i>}><Brand store={store} /></Suspense>;
    }

    const { container } = render(<Car />);
    // Held, the store had no run to throw: the defaults committed, then the effect started it.
    expect(frames).toEqual(["true:"]);
    expect(fallback(container)).toBe("loading");

    await act(flush);
    await act(flush);
    expect(fallback(container)).toBeNull();
    expect(container.textContent).toBe("false:BMW");
    expect(options).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("the component that owns the store may read the node itself: it suspends after its commit, and nothing is rebuilt", async () => {
    const { resolver, options } = carConfig();
    // Started by the constructor, the pending run suspended this component before its first commit:
    // React kept no state of it, and every retry built a store and called the resolver.
    function Car() {
      const car = useForm(usePalistor(options)).car;
      return <b>{String(car.loading)}:{car.brand.value}</b>;
    }

    const { container } = render(<Suspense fallback={<i>loading</i>}><Car /></Suspense>);
    expect(fallback(container)).toBe("loading");

    for (let i = 0; i < 4; i++) await act(flush);
    expect(fallback(container)).toBeNull();
    expect(container.textContent).toBe("false:BMW");
    expect(options).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("a reader of the node's children only is not re-rendered by the start: it keeps the defaults until the data lands", async () => {
    const { config, resolver, options } = carConfig();
    function Brand({ store }: { store: Palistor<typeof config> }) {
      return <b>{useForm(store).car.brand.value}</b>;
    }
    function Car() {
      const store = usePalistor(options);
      return <Suspense fallback={<i>loading</i>}><Brand store={store} /></Suspense>;
    }

    const { container } = render(<Car />);
    expect(container.innerHTML).toBe("<b></b>");

    await act(flush);
    await act(flush);
    expect(container.innerHTML).toBe("<b>BMW</b>");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("a suspense list is held the same way: an empty first render without an error, then the fallback, then the rows", async () => {
    const resolver = vi.fn(async () => {
      await flush();
      return [{ id: "u1", name: "Ann" }];
    });
    const config = {
      users: defineList<{ id: string; name: string }>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver, onError: vi.fn(), options: { lazy: false, suspense: true } },
      }),
    };
    const frames: number[] = [];
    function Row({ user }: { user: PalistorRef<{ id: string; name: string }> }) {
      return <li>{useForm(user).name.value}</li>;
    }
    function Users() {
      const users = useForm(usePalistor(() => ({ config }))).users;
      frames.push(users.length);
      return <ul>{users.map((user, _index, id) => <Row key={id} user={user} />)}</ul>;
    }

    // In server mode this read throws the "left to the client" error; a store the hook holds in the browser does not.
    const { container } = render(<Suspense fallback={<i>loading</i>}><Users /></Suspense>);
    expect(frames).toEqual([0]);
    expect(fallback(container)).toBe("loading");

    await act(flush);
    await act(flush);
    expect(fallback(container)).toBeNull();
    expect(container.textContent).toBe("Ann");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("a render that suspends before its first commit keeps no store: the retry builds another one, and only that one starts", async () => {
    const eager = vi.fn(async () => ({ brand: "BMW" }));
    const lazy = vi.fn(async () => ({ name: "Ann" }));
    const onEnter = vi.fn();
    const options = vi.fn(() => ({
      config: {
        car: { resolve: { resolver: eager, onError: vi.fn(), options: { lazy: false } }, brand: { value: "" } },
        user: { resolve: { resolver: lazy, onError: vi.fn() }, name: { value: "" } },
        wizard: defineFlow({ steps: [defineStep("first", { note: { value: "" as string }, onEnter }), defineStep("second", {})] }),
      },
    }));
    const rendered: unknown[] = [];
    let release!: () => void;
    let gate: Promise<void> | null = new Promise<void>((resolve) => { release = resolve; });
    function Title() {
      const store = usePalistor(options);
      rendered.push(store);
      const form = useForm(store);
      const text = `${form.car.brand.value}/${form.user.name.value}`; // the lazy resolve is read by the dropped render too
      if (gate) throw gate; // suspends this component before its first commit
      return <output>{text}</output>;
    }

    const { container } = render(<Suspense fallback={<i>loading</i>}><Title /></Suspense>);
    expect(container.innerHTML).toBe("<i>loading</i>");
    const dropped = rendered[0];
    await act(flush);
    // The dropped render's store: nothing requested, no step entered.
    expect([eager, lazy, onEnter].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0]);

    await act(async () => {
      gate = null;
      release();
      await flush();
    });
    expect(container.innerHTML).toBe("<output>BMW/Ann</output>");
    expect(options.mock.calls.length).toBeGreaterThan(1);
    expect(rendered[rendered.length - 1]).not.toBe(dropped); // the committed instance has its own store
    expect([eager, lazy, onEnter].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe("PalistorProvider and usePalistorContext", () => {
  it("usePalistorContext returns the provider's context and re-renders its reader when a key changes", () => {
    const seen: Array<{ accountId: string }> = [];
    function Reader() {
      const context = usePalistorContext<{ accountId: string }>();
      seen.push(context);
      return <output>{context.accountId}</output>;
    }
    const reader = <Reader />; // the same element every time: only the context can re-render it
    const ui = (accountId: string) => <PalistorProvider context={{ accountId }}>{reader}</PalistorProvider>;

    const { container, rerender } = render(ui("acc-1"));
    expect(container.textContent).toBe("acc-1");

    rerender(ui("acc-1")); // a new object, the same values: the reference is kept, no re-render
    expect(seen).toHaveLength(1);

    rerender(ui("acc-2"));
    expect(container.textContent).toBe("acc-2");
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it("a key added to the provider's context reaches readers and stores; a removed one is gone for readers, kept by a store", () => {
    const config = titleConfig();
    let current!: { provided: Record<string, unknown>; store: Palistor<typeof config> };
    function Probe() {
      current = { provided: usePalistorContext(), store: usePalistor({ config }) };
      return null;
    }
    const ui = (context: Record<string, unknown>) => <PalistorProvider context={context}><Probe /></PalistorProvider>;

    const { rerender } = render(ui({ accountId: "acc-1" }));
    rerender(ui({ accountId: "acc-1", tenant: "acme" }));
    expect(current.provided).toEqual({ accountId: "acc-1", tenant: "acme" });
    expect(current.store.context).toEqual({ accountId: "acc-1", tenant: "acme" });

    rerender(ui({ accountId: "acc-1" }));
    expect(current.provided).toEqual({ accountId: "acc-1" }); // the provider's value is its props, nothing more
    expect(current.store.context).toEqual({ accountId: "acc-1", tenant: "acme" }); // setContext merges
  });

  it("without a provider it is one empty object, the same for every reader and render", () => {
    const first = renderHook(() => usePalistorContext());
    const second = renderHook(() => usePalistorContext());
    const context = first.result.current;

    first.rerender();

    expect(context).toEqual({});
    expect(first.result.current).toBe(context);
    expect(second.result.current).toBe(context);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("a provider without a context prop passes the outer context through", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PalistorProvider context={{ accountId: "acc-1" }}>
        <PalistorProvider translator={en}>{children}</PalistorProvider>
      </PalistorProvider>
    );
    const { result } = renderHook(() => usePalistorContext(), { wrapper });
    expect(result.current).toEqual({ accountId: "acc-1" });
  });

  it("nested providers add up: the inner context is merged over the outer one, translator and notifier are inherited unless given", async () => {
    const outerNotifier = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PalistorProvider context={{ accountId: "acc-1", tenant: "outer" }} translator={en} notifier={outerNotifier}>
        <PalistorProvider context={{ tenant: "inner", section: "billing" }}>{children}</PalistorProvider>
      </PalistorProvider>
    );
    const { result } = renderHook(
      () => ({
        context: usePalistorContext(),
        titled: usePalistor(() => ({ config: titleConfig() })),
        failing: usePalistor(() => ({ config: failingConfig() })),
      }),
      { wrapper },
    );

    const merged = { accountId: "acc-1", tenant: "inner", section: "billing" };
    expect(result.current.context).toEqual(merged);
    expect(result.current.titled.context).toEqual(merged);
    expect(result.current.titled.proxy.title.label).toBe("en:title"); // inherited

    await failOnce(result.current.failing, "a");
    expect(outerNotifier).toHaveBeenCalledWith("LOAD_FAILED"); // inherited
  });

  it("an inner provider's translator replaces the outer one for the stores below it only", () => {
    function Title({ id }: { id: string }) {
      const form = useForm(usePalistor(() => ({ config: titleConfig() })));
      return <label data-testid={id}>{form.title.label}</label>;
    }
    const { getByTestId } = render(
      <PalistorProvider translator={en}>
        <Title id="outer" />
        <PalistorProvider translator={de}><Title id="inner" /></PalistorProvider>
      </PalistorProvider>,
    );
    expect(getByTestId("outer").textContent).toBe("en:title");
    expect(getByTestId("inner").textContent).toBe("de:title");
  });

  it("each store gets its own context object: writing into it reaches neither the provider, nor a sibling, nor the hook's own record", () => {
    type TitleStore = Palistor<ReturnType<typeof titleConfig>>;
    let current!: { a: TitleStore; b: TitleStore; provided: Record<string, unknown> };
    function Probe() {
      current = {
        a: usePalistor(() => ({ config: titleConfig() })),
        b: usePalistor(() => ({ config: titleConfig() })),
        provided: usePalistorContext(),
      };
      return null;
    }
    const ui = (tick: number) => <PalistorProvider context={{ accountId: "acc-1", tick }}><Probe /></PalistorProvider>;
    const { rerender } = render(ui(1));

    current.a.context.accountId = "written in place";
    expect(current.b.context).toEqual({ accountId: "acc-1", tick: 1 });
    expect(current.provided).toEqual({ accountId: "acc-1", tick: 1 });

    rerender(ui(2)); // the provider's accountId did not change: it is not sent again
    expect(current.a.context).toEqual({ accountId: "written in place", tick: 2 });
  });
});

describe("usePalistor: one store handed down through a React context", () => {
  /**
   * The shape of an app-wide store: a provider (the layout's) owns the store.
   * The entry of each client subtree below it — `Header`, `Settings`, `Plan`:
   * what a Server Component renders — takes the store from a React context of
   * the app, once; from there the nodes go down as props, and a component
   * that got one calls `useForm` on it.
   */
  function appStore() {
    const eager = vi.fn(async () => ({ plan: "pro" }));
    const config = {
      account: { name: { value: "Guest" } },
      billing: { resolve: { resolver: eager, onError: vi.fn(), options: { lazy: false } }, plan: { value: "" } },
    };
    type AppStore = Palistor<typeof config>;
    const AppStoreContext = createContext<AppStore | null>(null);
    const stores = new Set<AppStore>();
    const firstPlanRender: unknown[] = [];
    const renders = { provider: 0, header: 0, badge: 0, settings: 0, input: 0 };

    function Provider({ name, children }: { name?: string; children: ReactNode }) {
      renders.provider++;
      const store = usePalistor(() => ({ config, initialData: name ? { account: { name } } : undefined }));
      stores.add(store);
      return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
    }
    const useAppStore = () => useContext(AppStoreContext)!;
    function Header() {
      renders.header++;
      const form = useForm(useAppStore()); // the subtree's one context read; it only hands nodes down
      return <Badge name={form.account.name} />;
    }
    function Badge({ name }: { name: FieldProxyNode<string> }) {
      renders.badge++;
      return <output data-testid="badge">{useForm(name).value}</output>;
    }
    function Settings() {
      renders.settings++;
      const form = useForm(useAppStore());
      return <NameInput name={form.account.name} />;
    }
    function NameInput({ name }: { name: FieldProxyNode<string> }) {
      renders.input++;
      const field = useForm(name);
      return <input aria-label="name" value={field.value} onChange={(e) => field.onValueChange(e.target.value)} />;
    }
    function Plan({ slot }: { slot: number }) {
      const { billing } = useForm(useAppStore());
      const loading = billing.loading;
      if (firstPlanRender[slot] === undefined) firstPlanRender[slot] = { loading, called: eager.mock.calls.length };
      return <output data-testid={`plan-${slot}`}>{billing.plan.value}</output>;
    }
    return { Provider, Header, Settings, Plan, stores, eager, firstPlanRender, renders };
  }

  it("every reader below the provider has the same store: a write through one shows in the other, and the page changing keeps it", () => {
    const { Provider, Header, Settings, stores } = appStore();
    const app = (page: ReactNode) => <Provider name="Ada"><Header />{page}</Provider>;
    const { getByTestId, getByLabelText, queryByLabelText, rerender } = render(app(<Settings />));

    fireEvent.change(getByLabelText("name"), { target: { value: "Ada Lovelace" } });
    expect(getByTestId("badge").textContent).toBe("Ada Lovelace");

    // A client navigation: the provider stays mounted, the page below it changes.
    rerender(app(<p>orders</p>));
    expect(queryByLabelText("name")).toBeNull();
    expect(getByTestId("badge").textContent).toBe("Ada Lovelace");

    rerender(app(<Settings />));
    expect((getByLabelText("name") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect(stores.size).toBe(1);
  });

  it("the store is read from the context once per client subtree, the nodes go down as props: an edit re-renders the readers of that field only", () => {
    const { Provider, Header, Settings, renders } = appStore();
    const { getByTestId, getByLabelText } = render(<Provider name="Ada"><Header /><Settings /></Provider>);
    expect(renders).toEqual({ provider: 1, header: 1, badge: 1, settings: 1, input: 1 });

    fireEvent.change(getByLabelText("name"), { target: { value: "Ada Lovelace" } });

    expect(getByTestId("badge").textContent).toBe("Ada Lovelace");
    // The provider and both entries only handed nodes down: none of them re-rendered.
    expect(renders).toEqual({ provider: 1, header: 1, badge: 2, settings: 1, input: 2 });
  });

  it("the shared store starts once, after the provider's commit: every reader's first render reads loading: true with no resolver called", async () => {
    const { Provider, Plan, eager, firstPlanRender } = appStore();
    const { getByTestId } = render(<Provider><Plan slot={0} /><Plan slot={1} /></Provider>);

    expect(firstPlanRender).toEqual([{ loading: true, called: 0 }, { loading: true, called: 0 }]);
    expect(eager).toHaveBeenCalledTimes(1); // render() returns after the effects: the provider's effect started the store

    await act(flush);
    expect([getByTestId("plan-0").textContent, getByTestId("plan-1").textContent]).toEqual(["pro", "pro"]);
    expect(eager).toHaveBeenCalledTimes(1);
  });

  it("each server render builds its own store: the next request's HTML has nothing of the previous one", () => {
    const { Provider, Header, stores, eager } = appStore();

    const signedIn = renderToString(<Provider name="Ada"><Header /></Provider>);
    const signedOut = renderToString(<Provider><Header /></Provider>);

    expect(signedIn).toContain("Ada");
    expect(signedOut).toContain("Guest");
    expect(signedOut).not.toContain("Ada");
    expect(stores.size).toBe(2);
    expect(eager).not.toHaveBeenCalled(); // no effect runs in a server render: nothing was started
  });

  it("the provider's HTML hydrates without a mismatch, and the hydrated readers share the store", async () => {
    const { Provider, Header, Settings } = appStore();
    const app = () => <Provider name="Ada"><Header /><Settings /></Provider>;
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(app());
    const recovered: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, app(), { onRecoverableError: (error) => recovered.push(error) });
      await flush();
    });
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "Ada Lovelace" } });

    expect(recovered).toEqual([]);
    expect(consoleError.mock.calls.filter(([message]) => /hydrat/i.test(String(message)))).toEqual([]);
    expect(container.querySelector("output")!.textContent).toBe("Ada Lovelace");

    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });
});

// ─── Types ────────────────────────────────────────────────────────────────────
// Checked by `npm run typecheck:cube`; never called (the hooks inside need no renderer).

interface Tag { id: string; label: string }
interface Customer { id: string; name: string; visits: number; tags: Tag[]; aliases: string[] }

const customerRows: Customer[] = [];

const typedConfig = {
  search: { value: "" },
  limit: { value: 20 },
  profile: {
    isVisible: true,
    name: { value: "" },
    address: { city: { value: "" } },
  },
  customers: defineList<Customer>({
    template: {
      id: { value: "" },
      name: { value: "" },
      visits: { value: 0 },
      tags: { value: [] as Tag[] },
      aliases: { value: [] as string[] },
    },
  }),
  // An inline list, written as a tuple and as a plain array; `orders` rows hold a nested list.
  orders: [{ title: { value: "" as string }, lines: [{ sku: { value: "" as string }, qty: { value: 0 as number } }] }] as const,
  notes: [{ text: { value: "" } }],
  wizard: defineFlow({
    steps: [
      defineStep("account", { email: { value: "" as string } }),
      defineStep("team", { members: defineList<Tag>({ template: { id: { value: "" }, label: { value: "" } } }) }),
    ],
  }),
};

function TypeLevel(): null {
  // ── InitialData: a partial tree of getValues(); a list is rows or a first page, in rows as well.
  type Data = InitialData<typeof typedConfig>;
  const rows: Data = {
    search: "ann",
    profile: { address: { city: "Riga" } },
    customers: customerRows,
    orders: [{ id: "o-1", title: "First", lines: { items: [{ id: "l-1", qty: 2 }], total: 14 } }],
    notes: [{ id: 7, text: "call back" }],
    wizard: { account: { email: "a@b.c" }, team: { members: { items: [{ id: "t-1" }], hasMore: true } } },
  };
  const page: Data = {
    customers: {
      items: [{ id: "c-1", name: "Ann", tags: { items: [{ id: "t-1", label: "vip" }], total: 3 }, aliases: ["annie"] }],
      total: 240,
      nextCursor: null,
    },
  };
  // @ts-expect-error not a key of the config
  const unknownKey: Data = { nope: 1 };
  // @ts-expect-error a leaf takes its value type
  const wrongLeaf: Data = { limit: "20" };
  // @ts-expect-error a config's service key is not a value
  const serviceKey: Data = { profile: { isVisible: true } };
  // @ts-expect-error not a key of the entity
  const unknownRowKey: Data = { customers: [{ id: "c-1", nope: 1 }] };
  // @ts-expect-error a row's leaf takes its value type, in a page too
  const wrongRowLeaf: Data = { customers: { items: [{ visits: "3" }] } };
  // @ts-expect-error a list is rows or a page, not rows by id
  const rowsById: Data = { customers: { "c-1": { id: "c-1" } } };
  // @ts-expect-error a nested list's rows are typed by its template
  const wrongNestedLeaf: Data = { orders: [{ lines: [{ qty: "2" }] }] };
  // @ts-expect-error not a step of the flow
  const unknownStep: Data = { wizard: { billing: {} } };
  void [rows, page, unknownKey, wrongLeaf, serviceKey, unknownRowKey, wrongRowLeaf, rowsById, wrongNestedLeaf, unknownStep];

  // ── new Palistor: the store's options still infer the config, and the new ones are accepted.
  const built = new Palistor({
    config: typedConfig,
    initialValues: { search: "ann" },
    context: { accountId: "acc-1" },
    translator: en,
    notifier: (error: unknown, code?: string) => void [error, code],
    server: true,
    initialData: { customers: { items: customerRows, total: 240 } },
  });
  built.start();
  const search: string = built.getValues().search;
  const city: string = built.proxy.profile.address.city.value;
  const asProxyStore: ProxyStore<typeof typedConfig> = built; // where the store's types were used before
  const asAlias: Palistor<typeof typedConfig> = built;
  // @ts-expect-error initialData is checked against the config, like initialValues
  new Palistor({ config: typedConfig, initialData: { search: 1 } });
  // `config: x as any` keeps every option open, as before.
  new Palistor({ config: typedConfig as any, initialData: { anything: [1, 2], goes: { here: true } } }).start();
  void [search, city, asProxyStore, asAlias];

  // ── usePalistor: the same instance type, from options or from a function returning them.
  const fromObject = usePalistor({ config: typedConfig, initialData: page });
  const fromFunction = usePalistor(() => ({ config: typedConfig, context: { accountId: "acc-1" }, initialData: { customers: customerRows } }));
  const same: [Palistor<typeof typedConfig>, Palistor<typeof typedConfig>] = [fromObject, fromFunction];
  const limit: number = useForm(fromFunction).limit.value;
  fromFunction.start();
  // @ts-expect-error the function form is checked the same
  usePalistor(() => ({ config: typedConfig, initialData: { limit: "20" } }));
  // fieldMapping keeps its literal names through both forms.
  const mappedConfig = { name: { value: "", required: true } };
  const mapped = usePalistor(() => ({ config: mappedConfig, fieldMapping: { isRequired: "required" } }));
  const required: boolean = mapped.proxy.name.required;
  // @ts-expect-error the internal name is gone under the mapping
  void mapped.proxy.name.isRequired;
  // Options built elsewhere.
  const options: PalistorOptions<typeof typedConfig> = { config: typedConfig, server: false };
  const fromOptions: Palistor<typeof typedConfig> = usePalistor(options);
  void [same, limit, required, fromOptions];

  // ── usePalistorContext: the caller names the shape; an interface is fine.
  interface AppContext { accountId: string; navigate(to: string): void }
  const accountId: string = usePalistorContext<AppContext>().accountId;
  const untyped: Record<string, unknown> = usePalistorContext();
  void [accountId, untyped];

  return null;
}
void TypeLevel;
