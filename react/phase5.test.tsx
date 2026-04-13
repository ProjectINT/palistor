/**
 * Phase 5 tests: per-field loading + useForm integration
 *
 * Lazy semantics: field resolve is triggered when the component first reads
 * .value or .loading (via queueMicrotask from the proxy GET trap), NOT eagerly
 * on mount. This avoids unnecessary resolves for fields that are never rendered.
 *
 * 5.1: field.loading reflects entityStates status — true while pending, false when resolved.
 * 5.2: per-field independence — resolving one field does not affect another field's loading.
 * 5.3: useForm entity mode triggers triggerEntityFieldResolve on first field access.
 * 5.4: skipIfResolved — entity already has non-default value → field resolve is skipped →
 *      loading stays false.
 * 5.5: loading is in ownKeys of leaf proxy.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Palistor } from "../store/store";
import { useForm } from "./useForm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Flush queueMicrotask callbacks scheduled by proxy GET trap. */
function flushMicrotasks() {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

// ─── 5.1: field.loading lifecycle ────────────────────────────────────────────

describe("5.1: field.loading lifecycle", () => {
  it("field.loading is false before access, true after lazy trigger, false when resolved", async () => {
    let resolveFieldBio!: (v: string) => void;
    const bioResolver = vi.fn(
      () => new Promise<string>((r) => { resolveFieldBio = r; }),
    );

    // Template shared between list and editUserForm (same reference → field entries match)
    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      bio: {
        value: "",
        resolve: {
          resolver: bioResolver,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    // Entity has bio leaf pre-set so executeEntityFieldResolve can write into it
    store.set({ id: "u1", name: "Alice", bio: "" });
    (store.proxy as any).users.add("u1");

    const { result } = renderHook(() => {
      const entityProxy = (store.proxy as any).users.items[0];
      return useForm(entityProxy, (s: any) => s.editUserForm);
    });

    // Before microtask fires: reading bio.loading schedules the resolve via queueMicrotask,
    // but the resolver hasn't started yet → loading is false.
    expect((result.current as any).bio.loading).toBe(false);
    expect(bioResolver).not.toHaveBeenCalled();

    // Flush microtask → triggerEntityFieldResolve fires → status = "pending" → loading = true
    await act(async () => {
      await flushMicrotasks();
    });

    expect((result.current as any).bio.loading).toBe(true);
    expect(bioResolver).toHaveBeenCalledTimes(1);

    // Resolve the field → status transitions to "resolved"
    await act(async () => {
      resolveFieldBio("Alice's bio text");
      await flushPromises();
    });

    expect((result.current as any).bio.loading).toBe(false);
    expect((result.current as any).bio.value).toBe("Alice's bio text");
  });
});

// ─── 5.2: Per-field independence ─────────────────────────────────────────────

describe("5.2: per-field independence", () => {
  it("resolving fieldA does not change fieldB.loading", async () => {
    let resolveFieldA!: (v: string) => void;
    let resolveFieldB!: (v: string) => void;
    const resolverA = vi.fn(
      () => new Promise<string>((r) => { resolveFieldA = r; }),
    );
    const resolverB = vi.fn(
      () => new Promise<string>((r) => { resolveFieldB = r; }),
    );

    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      fieldA: {
        value: "",
        resolve: {
          resolver: resolverA,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
      fieldB: {
        value: "",
        resolve: {
          resolver: resolverB,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    // Include all template fields in entity so resolves can write values
    store.set({ id: "u1", name: "Alice", fieldA: "", fieldB: "" });
    (store.proxy as any).users.add("u1");

    const { result } = renderHook(() => {
      const entityProxy = (store.proxy as any).users.items[0];
      return useForm(entityProxy, (s: any) => s.editUserForm);
    });

    // Access fields to schedule lazy resolve, then flush microtasks
    void (result.current as any).fieldA.loading;
    void (result.current as any).fieldB.loading;
    await act(async () => {
      await flushMicrotasks();
    });

    expect((result.current as any).fieldA.loading).toBe(true);
    expect((result.current as any).fieldB.loading).toBe(true);

    // Resolve only fieldA
    await act(async () => {
      resolveFieldA("value-A");
      await flushPromises();
    });

    // fieldA is done, fieldB still pending
    expect((result.current as any).fieldA.loading).toBe(false);
    expect((result.current as any).fieldB.loading).toBe(true);
    expect((result.current as any).fieldA.value).toBe("value-A");

    // Resolve fieldB
    await act(async () => {
      resolveFieldB("value-B");
      await flushPromises();
    });

    expect((result.current as any).fieldB.loading).toBe(false);
    expect((result.current as any).fieldB.value).toBe("value-B");
  });
});

// ─── 5.3: useForm triggers field resolves on mount ───────────────────────────

describe("5.3: useForm triggers field resolves on first access", () => {
  it("resolver is called when component first accesses the field", async () => {
    const fieldResolver = vi.fn(async () => "resolved-value");

    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      status: {
        value: "",
        resolve: {
          resolver: fieldResolver,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    expect(fieldResolver).not.toHaveBeenCalled();

    const { result } = renderHook(() => {
      const entityProxy = (store.proxy as any).users.items[0];
      return useForm(entityProxy, (s: any) => s.editUserForm);
    });

    // Resolver not called yet — field not accessed
    expect(fieldResolver).not.toHaveBeenCalled();

    // Access the field → schedules microtask → flush it
    void (result.current as any).status.value;
    await act(async () => {
      await flushMicrotasks();
      await flushPromises();
    });

    expect(fieldResolver).toHaveBeenCalledTimes(1);

    // Resolver receives entity values as first argument
    const [entityValues] = fieldResolver.mock.calls[0] as unknown as [any, ...any[]];
    expect(entityValues.id).toBe("u1");
    expect(entityValues.name).toBe("Alice");
  });

  it("field resolve triggered independently per entity", async () => {
    const fieldResolver = vi.fn(async () => "active");

    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      isActive: {
        value: false,
        resolve: {
          resolver: fieldResolver,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    // Mount two separate forms for two different entities
    const { result: r1 } = renderHook(() => {
      const proxy1 = (store.proxy as any).users.items[0];
      return useForm(proxy1, (s: any) => s.editUserForm);
    });

    const { result: r2 } = renderHook(() => {
      const proxy2 = (store.proxy as any).users.items[1];
      return useForm(proxy2, (s: any) => s.editUserForm);
    });

    // Access fields to trigger lazy resolve
    void (r1.current as any).isActive.value;
    void (r2.current as any).isActive.value;

    await act(async () => {
      await flushMicrotasks();
      await flushPromises();
    });

    // Resolver called once per entity
    expect(fieldResolver).toHaveBeenCalledTimes(2);
  });
});

// ─── 5.4: skipIfResolved ─────────────────────────────────────────────────────

describe("5.4: skipIfResolved", () => {
  it("field resolve is skipped when entity already has non-default value (skipIfResolved: true)", async () => {
    const fieldResolver = vi.fn(async () => "resolved-bio");

    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      bio: {
        value: "",
        resolve: {
          resolver: fieldResolver,
          onError: vi.fn(),
          // skipIfResolved defaults to true
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    // Entity already has a non-default bio value (e.g. loaded from list resolve)
    store.set({ id: "u1", name: "Alice", bio: "existing-bio" });
    (store.proxy as any).users.add("u1");

    const { result } = renderHook(() => {
      const entityProxy = (store.proxy as any).users.items[0];
      return useForm(entityProxy, (s: any) => s.editUserForm);
    });

    // Access field to trigger lazy resolve check
    void (result.current as any).bio.value;

    await act(async () => {
      await flushMicrotasks();
      await flushPromises();
    });

    // Resolver should NOT have been called (skipIfResolved: true, value already set)
    expect(fieldResolver).not.toHaveBeenCalled();

    // loading stays false
    expect((result.current as any).bio.loading).toBe(false);

    // Value should be the pre-existing value
    expect((result.current as any).bio.value).toBe("existing-bio");
  });

  it("field resolve runs when skipIfResolved: false even if value is already set", async () => {
    const fieldResolver = vi.fn(async () => "new-bio");

    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      bio: {
        value: "",
        resolve: {
          resolver: fieldResolver,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    store.set({ id: "u1", name: "Alice", bio: "existing-bio" });
    (store.proxy as any).users.add("u1");

    const { result: r } = renderHook(() => {
      const entityProxy = (store.proxy as any).users.items[0];
      return useForm(entityProxy, (s: any) => s.editUserForm);
    });

    // Access field to trigger lazy resolve
    void (r.current as any).bio.value;

    await act(async () => {
      await flushMicrotasks();
      await flushPromises();
    });

    // Resolver SHOULD have been called (skipIfResolved: false)
    expect(fieldResolver).toHaveBeenCalledTimes(1);
  });
});

// ─── 5.5: loading in ownKeys ─────────────────────────────────────────────────

describe("5.5: loading in ownKeys", () => {
  it("spread of entity leaf proxy includes loading property", () => {
    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const { result } = renderHook(() => {
      const entityProxy = (store.proxy as any).users.items[0];
      return useForm(entityProxy, (s: any) => s.editUserForm);
    });

    const nameProxy = (result.current as any).name;
    const keys = Object.keys({ ...nameProxy });
    expect(keys).toContain("loading");
  });
});

// ─── 5.6: E2E — field loading in rendered component ──────────────────────────

describe("5.6: E2E — field loading in rendered component", () => {
  it("component shows field-level loading spinner then resolved value", async () => {
    let resolveFieldBio!: (v: string) => void;
    const bioResolver = vi.fn(
      () => new Promise<string>((r) => { resolveFieldBio = r; }),
    );

    const editTemplate = {
      id: { value: "" },
      name: { value: "" },
      bio: {
        value: "",
        resolve: {
          resolver: bioResolver,
          onError: vi.fn(),
          options: { skipIfResolved: false },
        },
      },
    };

    const store = new Palistor({
      config: {
        users: [editTemplate],
        editUserForm: editTemplate,
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    // Include bio leaf so executeEntityFieldResolve can write into it
    store.set({ id: "u1", name: "Alice", bio: "" });
    (store.proxy as any).users.add("u1");

    function EditForm({ entityProxy }: { entityProxy: any }) {
      const form = useForm(entityProxy, (s: any) => s.editUserForm);
      const bio = (form as any).bio;
      return (
        <div>
          {bio.loading
            ? <span data-testid="bio-loading">Loading bio...</span>
            : <span data-testid="bio-value">{String(bio.value)}</span>}
        </div>
      );
    }

    function App() {
      const [entityProxy] = useState(() => (store.proxy as any).users.items[0]);
      return <EditForm entityProxy={entityProxy} />;
    }

    render(<App />);

    // First render: component reads bio.loading → schedules microtask.
    // After microtask fires → resolve starts → re-render with loading = true.
    await act(async () => {
      await flushMicrotasks();
    });

    expect(screen.queryByTestId("bio-loading")).toBeTruthy();
    expect(screen.queryByTestId("bio-value")).toBeFalsy();

    // Resolve the field
    await act(async () => {
      resolveFieldBio("Alice is a software engineer.");
      await flushPromises();
    });

    // Loading done, value displayed
    expect(screen.queryByTestId("bio-loading")).toBeFalsy();
    expect(screen.getByTestId("bio-value").textContent).toBe("Alice is a software engineer.");
  });
});
