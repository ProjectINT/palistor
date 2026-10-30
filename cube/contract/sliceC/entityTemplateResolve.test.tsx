/**
 * Tests for the template resolve + submit pipelines of useForm(entity, template).
 *
 * Ported from store/resolvePipeline/entityTemplateResolve.test.ts, which built
 * entity projection proxies and called `triggerEntityTemplateResolve` /
 * `executeEntityTemplateSubmit` on the kernel. The public entry to both is
 * `useForm(entity, (s) => s.editUserForm)`: the template resolve runs on
 * mount, `submit()` on the returned proxy runs the template submit.
 *
 * - 3B.1: Template resolve pipeline (loading state, merge, markResolved, skip on repeat)
 * - 3B.2: Template submit pipeline (validation, onSubmit, afterSubmit, submitting state)
 * - 3B.3: store.invalidate() — resolved-cache reset → re-resolve on the next bind
 * - 3B.4: notifications for loading / submitting changes
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Palistor, useForm } from "@impl";

// ─── helpers ─────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Mounts useForm(entity, template) for the first user; returns the hook result and unmount. */
function open(store: any, selector: (s: any) => any, index = 0) {
  const entity = store.proxy.users.items[index];
  return renderHook(() => useForm(entity, selector));
}

// ─── Shared config factory ────────────────────────────────────────────────────

function makeUserListStore(extraTemplate: Record<string, unknown> = {}) {
  const editUserTemplate = {
    id: { value: "" },
    name: { value: "" },
    email: { value: "" },
    role: { value: "user" },
    resolve: {
      resolver: vi.fn(async (thisForm: any, _store: any) => {
        return { id: thisForm.id, email: `${thisForm.id}@corp.com`, role: "admin" };
      }),
      onError: vi.fn(),
    },
    onSubmit: vi.fn(async () => ({ saved: true })),
    afterSubmit: vi.fn(),
    ...extraTemplate,
  };

  const store = new Palistor({
    config: {
      users: [
        {
          id: { value: "" },
          name: { value: "" },
        },
      ],
      editUserForm: editUserTemplate,
    } as any,
  });

  const seed = (row: Record<string, unknown> = { id: "u1", name: "Alice" }) => {
    store.set(row);
    (store.proxy as any).users.add(row.id as string);
  };

  return { store, editUserTemplate, seed };
}

// ─── 3B.1: Template resolve pipeline ─────────────────────────────────────────

describe("3B.1: Template resolve pipeline", () => {
  it("resolver called with the entity proxy and the store on mount", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    const { result } = open(store, (s) => s.editUserForm);
    await act(() => flushPromises());

    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(1);
    const [calledProxy, calledStore] = editUserTemplate.resolve.resolver.mock.calls[0];
    expect(calledProxy.id).toBe("u1");
    expect(calledProxy.name.value).toBe("Alice");
    expect(calledStore).toBe(store);
    expect((result.current as any).email.value).toBe("u1@corp.com");
  });

  it("loading: true while resolver pending, false after resolve", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    let resolvePromise!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementationOnce(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    const { result } = open(store, (s) => s.editUserForm);
    await act(async () => {});

    expect((result.current as any).loading).toBe(true);

    await act(async () => {
      resolvePromise({ id: "u1", email: "alice@corp.com" });
      await flushPromises();
    });

    expect((result.current as any).loading).toBe(false);
  });

  it("resolver result is merged into the entity", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    editUserTemplate.resolve.resolver.mockResolvedValueOnce({
      id: "u1",
      email: "alice@corp.com",
      role: "admin",
    });

    const { result } = open(store, (s) => s.editUserForm);
    await act(() => flushPromises());

    // Entity should now have email and role fields
    expect((result.current as any).email.value).toBe("alice@corp.com");
    expect((result.current as any).role.value).toBe("admin");
    // Original name preserved (merge, not replace)
    expect((result.current as any).name.value).toBe("Alice");
    // visible through the list too
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });

  it("markResolved after a successful resolve", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);

    open(store, (s) => s.editUserForm);
    await act(() => flushPromises());

    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
  });

  it("skip resolve if already resolved (isResolved = true)", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    // Mark as already resolved
    store.entityRegistry.markResolved("u1", editUserTemplate);

    open(store, (s) => s.editUserForm);
    await act(() => flushPromises());

    // Resolver should NOT have been called
    expect(editUserTemplate.resolve.resolver).not.toHaveBeenCalled();
  });

  it("deduplication: a second mount while loading is a no-op", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    let resolveFirst!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementation(
      () => new Promise((r) => { resolveFirst = r; }),
    );

    open(store, (s) => s.editUserForm);
    open(store, (s) => s.editUserForm); // second component on the same entity + template
    await act(async () => {});

    await act(async () => {
      resolveFirst({ id: "u1", email: "alice@corp.com" });
      await flushPromises();
    });

    // Resolver called only once
    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(1);
  });

  it("onError called on resolver failure; loading false after", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    const err = new Error("Network error");
    editUserTemplate.resolve.resolver.mockRejectedValueOnce(err);

    const { result } = open(store, (s) => s.editUserForm);
    await act(() => flushPromises());

    expect(editUserTemplate.resolve.onError).toHaveBeenCalledWith(err, expect.objectContaining({ notify: expect.any(Function) }));
    expect((result.current as any).loading).toBe(false);
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);
  });

  it("no-op if the template has no resolver", async () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" } }],
        plainForm: { name: { value: "" } }, // no resolve config
      } as any,
    });
    store.set({ id: "e1", name: "Test" });
    (store.proxy as any).users.add("e1");

    const { result } = open(store, (s) => s.plainForm);
    await act(() => flushPromises());

    expect((result.current as any).loading).toBe(false);
    expect((result.current as any).name.value).toBe("Test");
  });
});

// ─── 3B.2: Template submit pipeline ──────────────────────────────────────────

describe("3B.2: Template submit pipeline", () => {
  function makeSubmitStore(template: Record<string, unknown>, row: Record<string, unknown>) {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" } }],
        editForm: template,
      } as any,
    });
    store.set(row);
    (store.proxy as any).users.add(row.id as string);
    return store;
  }

  it("onSubmit called with entityProxy and store", async () => {
    const template = {
      id: { value: "" },
      name: { value: "" },
      email: { value: "" },
      onSubmit: vi.fn(async (_eProxy: any, _store: any) => ({ ok: true })),
    };
    const store = makeSubmitStore(template, { id: "u1", name: "Alice", email: "a@corp.com" });
    const { result } = open(store, (s) => s.editForm);

    let submitResult: any;
    await act(async () => { submitResult = await (result.current as any).submit(); });

    expect(submitResult.success).toBe(true);
    expect(template.onSubmit).toHaveBeenCalledTimes(1);
    const [eProxy, calledStore] = template.onSubmit.mock.calls[0];
    expect(eProxy.id).toBe("u1");
    expect(eProxy.email.value).toBe("a@corp.com");
    expect(calledStore).toBe(store);
  });

  it("onSubmit result reaches afterSubmit", async () => {
    const afterSubmit = vi.fn();
    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(async () => ({ saved: true })),
      afterSubmit,
    };
    const store = makeSubmitStore(template, { id: "u1", name: "Alice" });
    const { result } = open(store, (s) => s.editForm);

    await act(async () => { await (result.current as any).submit(); });

    expect(afterSubmit).toHaveBeenCalledWith({ saved: true }, expect.objectContaining({ reset: expect.any(Function) }));
  });

  it("submitting: true while onSubmit pending, false after", async () => {
    let resolveSubmit!: (v: any) => void;
    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(() => new Promise((r) => { resolveSubmit = r; })),
    };
    const store = makeSubmitStore(template, { id: "u1", name: "Alice" });
    const { result } = open(store, (s) => s.editForm);

    let submitPromise!: Promise<unknown>;
    act(() => { submitPromise = (result.current as any).submit(); });

    // submitting: true synchronously set
    expect((result.current as any).submitting).toBe(true);

    await act(async () => {
      resolveSubmit({ ok: true });
      await submitPromise;
    });

    expect((result.current as any).submitting).toBe(false);
  });

  it("validation errors stop submit and return { success: false }", async () => {
    const template = {
      id: { value: "" },
      name: {
        value: "",
        validate: (v: string) => (!v ? "Name is required" : undefined),
      },
      onSubmit: vi.fn(),
    };
    const store = makeSubmitStore(template, { id: "u1", name: "" }); // empty name
    const { result } = open(store, (s) => s.editForm);

    let submitResult: any;
    await act(async () => { submitResult = await (result.current as any).submit(); });

    expect(submitResult.success).toBe(false);
    expect(submitResult.errors).toEqual([{ path: "name", message: "Name is required" }]);
    expect(template.onSubmit).not.toHaveBeenCalled();
  });

  it("validation passes when field is valid", async () => {
    const template = {
      id: { value: "" },
      name: {
        value: "",
        validate: (v: string) => (!v ? "Name is required" : undefined),
      },
      onSubmit: vi.fn(async () => ({})),
    };
    const store = makeSubmitStore(template, { id: "u1", name: "Alice" }); // valid name
    const { result } = open(store, (s) => s.editForm);

    let submitResult: any;
    await act(async () => { submitResult = await (result.current as any).submit(); });

    expect(submitResult.success).toBe(true);
    expect(template.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("no onSubmit defined → success without call", async () => {
    const template = {
      id: { value: "" },
      name: { value: "" },
      // no onSubmit
    };
    const store = makeSubmitStore(template, { id: "u1", name: "Alice" });
    const { result } = open(store, (s) => s.editForm);

    let submitResult: any;
    await act(async () => { submitResult = await (result.current as any).submit(); });

    expect(submitResult.success).toBe(true);
  });

  it("submitting: false after exception in onSubmit (finally block)", async () => {
    const template = {
      id: { value: "" },
      name: { value: "" },
      onSubmit: vi.fn(async () => { throw new Error("Submit failed"); }),
    };
    const store = makeSubmitStore(template, { id: "u1", name: "Alice" });
    const { result } = open(store, (s) => s.editForm);

    await act(async () => {
      await expect((result.current as any).submit()).rejects.toThrow("Submit failed");
    });

    // submitting: false in finally
    expect((result.current as any).submitting).toBe(false);
  });
});

// ─── 3B.3: store.invalidate() ────────────────────────────────────────────────

describe("3B.3: store.invalidate()", () => {
  it("invalidate(id) clears all resolved cache for entity", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

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
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

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

  it("invalidate + re-mount triggers re-resolve", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    // First resolve
    editUserTemplate.resolve.resolver.mockResolvedValueOnce({ id: "u1", email: "alice@corp.com", role: "admin" });
    const first = open(store, (s) => s.editUserForm);
    await act(() => flushPromises());
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(1);
    first.unmount();

    // Invalidate → not resolved
    store.invalidate("u1", editUserTemplate);
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(false);

    // Mount again → resolver called again
    editUserTemplate.resolve.resolver.mockResolvedValueOnce({ id: "u1", email: "alice2@corp.com", role: "admin" });
    const second = open(store, (s) => s.editUserForm);
    await act(() => flushPromises());

    expect(editUserTemplate.resolve.resolver).toHaveBeenCalledTimes(2);
    expect(store.entityRegistry.isResolved("u1", editUserTemplate)).toBe(true);
    expect((second.result.current as any).email.value).toBe("alice2@corp.com");
  });
});

// ─── 3B.4: Loading / submitting notifications ─────────────────────────────────

describe("3B.4: Notifications for loading/submitting state changes", () => {
  it("global subscriber notified when loading changes to true and false", async () => {
    const { store, editUserTemplate, seed } = makeUserListStore();
    seed();

    const listener = vi.fn();
    store.subscribeGlobal(listener);

    let resolveIt!: (v: any) => void;
    editUserTemplate.resolve.resolver.mockImplementationOnce(
      () => new Promise((r) => { resolveIt = r; }),
    );

    const callsBeforeTrigger = listener.mock.calls.length;
    open(store, (s) => s.editUserForm);
    await act(async () => {});

    // Should have notified about loading: true
    expect(listener.mock.calls.length).toBeGreaterThan(callsBeforeTrigger);

    const callsAfterStart = listener.mock.calls.length;
    await act(async () => {
      resolveIt({ id: "u1", email: "test@test.com" });
      await flushPromises();
    });

    // Should have notified about loading: false + entity update
    expect(listener.mock.calls.length).toBeGreaterThan(callsAfterStart);
  });

  it("global subscriber notified when submitting changes", async () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" } }],
        editForm: {
          id: { value: "" },
          name: { value: "" },
          onSubmit: vi.fn(async () => ({})),
        },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const listener = vi.fn();
    store.subscribeGlobal(listener);

    const { result } = open(store, (s) => s.editForm);
    const countBefore = listener.mock.calls.length;
    await act(async () => { await (result.current as any).submit(); });

    // Should have notified at least twice (submitting: true, submitting: false)
    expect(listener.mock.calls.length).toBeGreaterThan(countBefore + 1);
  });
});
