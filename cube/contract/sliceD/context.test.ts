import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

const makeConfig = () => ({
  email: { value: "" },
  name: { value: "" },
  onSubmit: vi.fn(),
});

describe("store.context", () => {
  it("defaults to empty object when setContext is not called", () => {
    const store = new Palistor({ config: makeConfig() });
    expect(store.context).toEqual({});
  });

  it("setContext replaces context entirely", () => {
    const store = new Palistor({ config: makeConfig() });
    store.setContext({ accountId: "acc-1", tenant: "acme" });
    expect(store.context.accountId).toBe("acc-1");
    expect(store.context.tenant).toBe("acme");
  });

  it("setContext can be called multiple times — last wins", () => {
    const store = new Palistor({ config: makeConfig() });
    store.setContext({ accountId: "old" });
    store.setContext({ accountId: "new", extra: 42 });
    expect(store.context.accountId).toBe("new");
    expect(store.context.extra).toBe(42);
  });

  it("context fields are mutable in-place", () => {
    const store = new Palistor({ config: makeConfig() });
    store.setContext({ accountId: "old" });
    store.context.accountId = "updated";
    expect(store.context.accountId).toBe("updated");
  });

  it("context is accessible from onSubmit via store argument", async () => {
    const onSubmitSpy = vi.fn();
    const config = {
      email: { value: "test@test.com" },
      onSubmit: (values: any, store: any) => {
        onSubmitSpy(store.context.accountId, values);
      },
    };
    const store = new Palistor({ config });
    store.setContext({ accountId: "acc-42" });
    await store.submit();
    expect(onSubmitSpy).toHaveBeenCalledWith("acc-42", expect.objectContaining({ email: "test@test.com" }));
  });

  it("context is accessible from resolve.resolver via store argument", async () => {
    const resolverSpy = vi.fn().mockResolvedValue({ email: "resolved@test.com" });
    const config = {
      filter: { value: "" },
      email: { value: "" },
      resolve: {
        resolver: (values: any, store: any) => {
          return resolverSpy(store.context.accountId);
        },
        onError: () => {},
        deps: ["filter"],
      },
    };
    const store = new Palistor({ config });
    store.setContext({ accountId: "acc-99" });

    // Trigger resolver by changing a dependency
    store.proxy.filter.value = "trigger";

    // Wait for resolver to complete
    await vi.waitFor(() => {
      expect(resolverSpy).toHaveBeenCalledWith("acc-99");
    });
  });

  it("context does not appear in getValues()", () => {
    const store = new Palistor({ config: { email: { value: "a@b.com" } } });
    store.setContext({ accountId: "abc" });
    const values = store.getValues();
    expect(values).toEqual({ email: "a@b.com" });
    expect((values as any).accountId).toBeUndefined();
  });

  // ─── Root context option (new in the contract, Phase 2.2) ──────────────────

  it("the `context` option is store.context from the start", () => {
    const ctx = { accountId: "acc-1" };
    const store = new Palistor({ config: makeConfig(), context: ctx });
    expect(store.context.accountId).toBe("acc-1");
  });

  it("an eager resolver sees the `context` option on its first run", async () => {
    const seen: unknown[] = [];
    const config = {
      email: { value: "" },
      resolve: {
        options: { lazy: false },
        resolver: async (_values: any, store: any) => {
          seen.push(store.context.accountId);
          return { email: "x@y.z" };
        },
        onError: () => {},
      },
    };
    const store = new Palistor({ config: config as any, context: { accountId: "acc-7" } });
    await vi.waitFor(() => expect(store.getValues()).toEqual({ email: "x@y.z" }));
    expect(seen).toEqual(["acc-7"]);
  });

  it("setContext after the `context` option merges into it", () => {
    const store = new Palistor({ config: makeConfig(), context: { accountId: "a", tenant: "t" } });
    store.setContext({ accountId: "b" });
    expect(store.context).toEqual({ accountId: "b", tenant: "t" });
  });

  it("setContext does not notify subscribers", () => {
    const store = new Palistor({ config: makeConfig() });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    const version = store.getVersion();
    store.setContext({ accountId: "acc-1" });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getVersion()).toBe(version);
  });
});
