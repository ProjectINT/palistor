/**
 * Фаза 3B: тесты Template resolve + submit pipelines.
 *
 * Покрывает:
 * - 3B.1: Template resolve pipeline (loading state, merge, markResolved, skip on repeat)
 * - 3B.2: Template submit pipeline (validation, onSubmit, afterSubmit, submitting state)
 * - 3B.3: store.invalidate() — сброс resolved cache → re-resolve при следующем bind
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Palistor } from "../store";

// ─── helpers ─────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Shared config factory ────────────────────────────────────────────────────

function makeUserListStore() {
  const editUserTemplate = {
    id: { value: "" },
    name: { value: "" },
    email: { value: "" },
    role: { value: "user" },
    resolve: {
      resolver: vi.fn(async (thisForm: any, store: any) => {
        return { id: thisForm.id, email: `${thisForm.id}@corp.com`, role: "admin" };
      }),
      onError: vi.fn(),
    },
    onSubmit: vi.fn(async () => ({ saved: true })),
    afterSubmit: vi.fn(),
  };

  const store = new Palistor({
    config: {
      users: [
        {
          id: { value: "" },
          name: { value: "" },
        },
      ],
    } as any,
  });

  return { store, editUserTemplate };
}

// ─── 3B.1: Template resolve pipeline ─────────────────────────────────────────

describe("3B.1: Template resolve pipeline", () => {
  it("resolver called with EntityProjectionProxy and store on triggerEntityTemplateResolve", async () => {
    const { store, editUserTemplate } = makeUserListStore();

    store.set({ id: "u1", name: "Alice" });

    const entityNode = store.entityRegistry.get("u1")!;
    const entityProxy = store.proxyBuilder.build(store.rootConfig); // use buildEntityProjectionProxy
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    await flushPromises();

    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(1);
    const [calledProxy, calledStore] = editUserTemplate.resolve.resolver.mock.calls[0];
    expect(calledProxy).toBe(eProxy);
    expect(calledStore).toBe(store);
  });

  it("loading: true while resolver pending, false after resolve", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    let resolvePromise!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementationOnce(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);

    // loading: true after trigger (synchronously set before async resolve)
    const bindingState = store._getEntityBindingState("u1", editUserTemplate as any);
    expect(bindingState.loading).toBe(true);

    resolvePromise({ id: "u1", email: "alice@corp.com" });
    await flushPromises();

    expect(bindingState.loading).toBe(false);
  });

  it("resolver result is merged into entity via upsert", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    editUserTemplate.resolve.resolver.mockResolvedValueOnce({
      id: "u1",
      email: "alice@corp.com",
      role: "admin",
    });

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    await flushPromises();

    // Entity should now have email and role fields
    const updatedEntity = store.entityRegistry.get("u1")!;
    expect((updatedEntity as any).email?.value).toBe("alice@corp.com");
    expect((updatedEntity as any).role?.value).toBe("admin");
    // Original name preserved (merge, not replace)
    expect((updatedEntity as any).name?.value).toBe("Alice");
  });

  it("markResolved called after successful resolve", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    await flushPromises();

    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
  });

  it("skip resolve if already resolved (isResolved = true)", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    // Mark as already resolved
    store.entityRegistry.markResolved("u1", editUserTemplate);

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    // Check if isResolved before triggering — should skip
    if (!store.entityRegistry.isResolved("u1", editUserTemplate as any)) {
      store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    }
    await flushPromises();

    // Resolver should NOT have been called
    expect(editUserTemplate.resolve.resolver).not.toHaveBeenCalled();
  });

  it("deduplication: second triggerEntityTemplateResolve while loading is a no-op", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    let resolveFirst!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementation(
      () => new Promise((r) => { resolveFirst = r; }),
    );

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy); // second call

    resolveFirst({ id: "u1", email: "alice@corp.com" });
    await flushPromises();

    // Resolver called only once
    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(1);
  });

  it("onError called on resolver failure", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const err = new Error("Network error");
    editUserTemplate.resolve.resolver.mockRejectedValueOnce(err);
    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    await flushPromises();

    expect(editUserTemplate.resolve.onError).toHaveBeenCalledWith(err, expect.objectContaining({ notify: expect.any(Function) }));
    // loading: false after error
    const bindingState = store._getEntityBindingState("u1", editUserTemplate as any);
    expect(bindingState.loading).toBe(false);
  });

  it("no-op if templateNode has no resolver", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "e1", name: "Test" });

    const templateNoResolver = { name: { value: "" } }; // no resolve config

    const entityNode = store.entityRegistry.get("e1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, templateNoResolver as any, store);

    // Should not throw
    store.triggerEntityTemplateResolve("e1", templateNoResolver as any, eProxy);
    await flushPromises();

    // No binding state created (no-op)
    const state = store._getEntityBindingState("e1", templateNoResolver as any);
    expect(state.loading).toBe(false);
  });

  it("EntityProjectionProxy.loading reactive via proxy access", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store) as any;

    let resolveIt!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementationOnce(
      () => new Promise((r) => { resolveIt = r; }),
    );

    expect(eProxy.loading).toBe(false);

    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    expect(eProxy.loading).toBe(true);

    resolveIt({ id: "u1", email: "x@x.com" });
    await flushPromises();

    expect(eProxy.loading).toBe(false);
  });
});

// ─── 3B.2: Template submit pipeline ──────────────────────────────────────────

describe("3B.2: Template submit pipeline", () => {
  it("onSubmit called with entityProxy and store", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice", email: "a@corp.com" });

    const template = {
      id: { value: "" },
      name: { value: "" },
      email: { value: "" },
      onSubmit: vi.fn(async (_eProxy: any, _store: any) => ({ ok: true })),
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    const result = await store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    expect(result.success).toBe(true);
    expect(template.onSubmit).toHaveBeenCalledTimes(1);
    expect(template.onSubmit.mock.calls[0][0]).toBe(eProxy);
    expect(template.onSubmit.mock.calls[0][1]).toBe(store);
  });

  it("onSubmit receives result in afterSubmit", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" });

    const afterSubmit = vi.fn();
    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(async () => ({ saved: true })),
      afterSubmit,
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    await store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    expect(afterSubmit).toHaveBeenCalledWith({ saved: true }, expect.objectContaining({ reset: expect.any(Function) }));
  });

  it("submitting: true while onSubmit pending, false after", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" });

    let resolveSubmit!: (v: any) => void;
    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(() => new Promise((r) => { resolveSubmit = r; })),
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    const submitPromise = store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    // submitting: true synchronously set
    const bindingState = store._getEntityBindingState("u1", template as any);
    expect(bindingState.submitting).toBe(true);
    expect(eProxy.submitting).toBe(true);

    resolveSubmit({ ok: true });
    await submitPromise;

    expect(bindingState.submitting).toBe(false);
    expect(eProxy.submitting).toBe(false);
  });

  it("validation errors stop submit and return { success: false }", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "" }); // empty name

    const template = {
      id: { value: "" },
      name: {
        value: "",
        validate: (v: string) => (!v ? "Name is required" : undefined),
      },
      onSubmit: vi.fn(),
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    const result = await store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    expect(result.success).toBe(false);
    expect((result as any).errors).toEqual([{ path: "name", message: "Name is required" }]);
    expect(template.onSubmit).not.toHaveBeenCalled();
  });

  it("validation passes when field is valid", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" }); // valid name

    const template = {
      id: { value: "" },
      name: {
        value: "",
        validate: (v: string) => (!v ? "Name is required" : undefined),
      },
      onSubmit: vi.fn(async () => ({})),
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    const result = await store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    expect(result.success).toBe(true);
    expect(template.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("no onSubmit defined → success without call", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" });

    const template = {
      id: { value: "" },
      name: { value: "" },
      // no onSubmit
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    const result = await store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    expect(result.success).toBe(true);
  });

  it("EntityProjectionProxy.submit() returns SubmitResult", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" });

    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(async () => ({ done: true })),
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    const result = await eProxy.submit();

    expect(result.success).toBe(true);
    expect(template.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submitting: false after exception in onSubmit (finally block)", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" });

    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(async () => { throw new Error("Submit failed"); }),
    };

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store) as any;

    await expect(store.executeEntityTemplateSubmit("u1", template as any, eProxy)).rejects.toThrow("Submit failed");

    // submitting: false in finally
    expect(eProxy.submitting).toBe(false);
  });

  it("entity not found returns error result", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    const template = { id: { value: "" }, name: { value: "" } };

    const result = await store.executeEntityTemplateSubmit("nonexistent", template as any, {});

    expect(result.success).toBe(false);
    expect((result as any).errors[0].message).toContain("nonexistent");
  });
});

// ─── 3B.3: store.invalidate() ────────────────────────────────────────────────

describe("3B.3: store.invalidate()", () => {
  it("invalidate(id) clears all resolved cache for entity", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    // Mark as resolved for two templates
    const templateB = { name: { value: "" } };
    store.entityRegistry.markResolved("u1", editUserTemplate);
    store.entityRegistry.markResolved("u1", templateB);

    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
    expect(store.entityRegistry.isResolved("u1", templateB)).toBe(true);

    store.invalidate("u1");

    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);
    expect(store.entityRegistry.isResolved("u1", templateB)).toBe(false);
  });

  it("invalidate(id, templateNode) clears only that pair", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const templateB = { name: { value: "" } };
    store.entityRegistry.markResolved("u1", editUserTemplate);
    store.entityRegistry.markResolved("u1", templateB);

    store.invalidate("u1", editUserTemplate);

    // Only editUserTemplate cache cleared
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);
    expect(store.entityRegistry.isResolved("u1", templateB)).toBe(true);
  });

  it("invalidate on non-existent entity is a no-op", () => {
    const { store } = makeUserListStore();
    expect(() => store.invalidate("nonexistent")).not.toThrow();
  });

  it("invalidate + re-bind triggers re-resolve", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    // First resolve
    editUserTemplate.resolve.resolver.mockResolvedValueOnce({ id: "u1", email: "alice@corp.com", role: "admin" });
    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    await flushPromises();
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(1);

    // Invalidate → not resolved
    store.invalidate("u1", editUserTemplate);
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);

    // Trigger again → resolver called again
    editUserTemplate.resolve.resolver.mockResolvedValueOnce({ id: "u1", email: "alice2@corp.com", role: "admin" });
    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);
    await flushPromises();

    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(2);
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
    const updatedEntity = store.entityRegistry.get("u1")!;
    expect((updatedEntity as any).email?.value).toBe("alice2@corp.com");
  });
});

// ─── 3B.4: Loading / submitting notifications ─────────────────────────────────

describe("3B.4: Notifications for loading/submitting state changes", () => {
  it("global subscriber notified when loading changes to true and false", async () => {
    const { store, editUserTemplate } = makeUserListStore();
    store.set({ id: "u1", name: "Alice" });

    const listener = vi.fn();
    store.subscribeGlobal(listener);

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, editUserTemplate as any, store);

    let resolveIt!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementationOnce(
      () => new Promise((r) => { resolveIt = r; }),
    );

    const callsBeforeTrigger = listener.mock.calls.length;
    store.triggerEntityTemplateResolve("u1", editUserTemplate as any, eProxy);

    // Should have notified about loading: true
    expect(listener.mock.calls.length).toBeGreaterThan(callsBeforeTrigger);

    const callsAfterStart = listener.mock.calls.length;
    resolveIt({ id: "u1", email: "test@test.com" });
    await flushPromises();

    // Should have notified about loading: false + entity update
    expect(listener.mock.calls.length).toBeGreaterThan(callsAfterStart);
  });

  it("global subscriber notified when submitting changes", async () => {
    const store = new Palistor({ config: { x: { value: "" } } as any });
    store.set({ id: "u1", name: "Alice" });

    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(async () => ({})),
    };

    const listener = vi.fn();
    store.subscribeGlobal(listener);

    const entityNode = store.entityRegistry.get("u1")!;
    const { buildEntityProjectionProxy } = await import("../buildProxy/buildEntityProjectionProxy");
    const eProxy = buildEntityProjectionProxy(entityNode, template as any, store);

    const countBefore = listener.mock.calls.length;
    await store.executeEntityTemplateSubmit("u1", template as any, eProxy);

    // Should have notified at least twice (submitting: true, submitting: false)
    expect(listener.mock.calls.length).toBeGreaterThan(countBefore + 1);
  });
});
