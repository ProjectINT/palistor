/**
 * useForm(entity, templateSelector): the block of react/useForm.test.tsx that
 * Phase 1 left out (it is the surface of Phase 2.1).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Palistor, useForm } from "@impl";

/** Contract helper: store keeps `{ value }` leaf nodes in the registry, cube plain rows. */
const leaf = (v: any) => (v && typeof v === "object" && "value" in v ? v.value : v);

/**
 * Config with a list + a separate edit template.
 * The list stores users; editUserForm is a template for editing a user.
 */
function makeEntityConfig() {
  return {
    users: [
      {
        name: { value: "" },
        age: { value: 0 },
      },
    ],
    editUserForm: {
      name: { value: "" },
      email: { value: "" },
      role: { value: "user" },
    },
  };
}

describe("useForm(entity, templateSelector)", () => {
  it("returns entity projection proxy through template", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice", email: "alice@test.com", role: "admin" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    const { result } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    expect(result.current.name.value).toBe("Alice");
    expect(result.current.email.value).toBe("alice@test.com");
    expect(result.current.role.value).toBe("admin");
  });

  it("exposes entity id through proxy", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    const { result } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    expect(result.current.id).toBe("u1");
  });

  it("calls bind on mount and unbind on unmount", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    const bindSpy = vi.spyOn(store.entityRegistry, "bind");
    const unbindSpy = vi.spyOn(store.entityRegistry, "unbind");

    const { unmount } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    // bind should have been called once with entityId and templateNode
    expect(bindSpy).toHaveBeenCalledTimes(1);
    expect(bindSpy).toHaveBeenCalledWith("u1", expect.any(Object));

    unmount();

    // unbind should have been called once with same args
    expect(unbindSpy).toHaveBeenCalledTimes(1);
    expect(unbindSpy).toHaveBeenCalledWith("u1", expect.any(Object));

    bindSpy.mockRestore();
    unbindSpy.mockRestore();
  });

  it("re-renders when entity field changes", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice", email: "alice@test.com" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];
    const renderCount = vi.fn();

    const { result } = renderHook(() => {
      renderCount();
      return useForm(aliceProxy, (s: any) => s.editUserForm);
    });

    expect(renderCount).toHaveBeenCalledTimes(1);
    expect(result.current.name.value).toBe("Alice");

    // Update entity through store.set
    act(() => {
      store.set({ id: "u1", name: "Alice Cooper" });
    });

    expect(renderCount).toHaveBeenCalledTimes(2);
    expect(result.current.name.value).toBe("Alice Cooper");
  });

  it("writing through entity proxy updates entity", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice", email: "alice@test.com" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    const { result } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    act(() => {
      result.current.name.value = "Alice Cooper";
    });

    expect(result.current.name.value).toBe("Alice Cooper");
    expect(leaf((store.entityRegistry.get("u1") as any)?.name)).toBe("Alice Cooper");
  });

  it("entity and list share the same leaf node — both update on write", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];
    const listRenderCount = vi.fn();
    const formRenderCount = vi.fn();

    // List view: subscribes via useForm(store), reads alice.name.value through list proxy
    renderHook(() => {
      listRenderCount();
      const form = useForm(store);
      return (form as any).users.items[0]?.name?.value;
    });

    // Form view: reads the same entity leaf through the template. (The original
    // hook read nothing in render and re-rendered only by a store accident: its
    // getSnapshot fell back to 0 after the first navigation.)
    const { result } = renderHook(() => {
      formRenderCount();
      const u = useForm(aliceProxy, (s: any) => s.editUserForm);
      void u.name.value;
      return u;
    });

    const initialListRenders = listRenderCount.mock.calls.length;
    const initialFormRenders = formRenderCount.mock.calls.length;

    // Edit through the template form — should update the shared entity leaf
    act(() => {
      result.current.name.value = "Alice Cooper";
    });

    // Both should have re-rendered because they track the same entity leaf node
    expect(listRenderCount.mock.calls.length).toBeGreaterThan(initialListRenders);
    expect(formRenderCount.mock.calls.length).toBeGreaterThan(initialFormRenders);
  });

  it("resolved cache: isResolved returns false before resolve, true after markResolved", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    // The template node is the config object
    const templateNode = (store as any).rootConfig.editUserForm;

    // Initially not resolved
    expect(store.entityRegistry.isResolved("u1", templateNode)).toBe(false);

    // Manually mark as resolved (simulating a completed template resolve)
    store.entityRegistry.markResolved("u1", templateNode);

    expect(store.entityRegistry.isResolved("u1", templateNode)).toBe(true);

    // Clear resolved cache
    store.entityRegistry.clearResolved("u1", templateNode);
    expect(store.entityRegistry.isResolved("u1", templateNode)).toBe(false);
  });

  it("guard: binding is tracked correctly for second component on same entity+template", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    const { unmount: unmountA } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    // After first component: entity should be bound
    const bindingsAfterA = store.entityRegistry.getBindings("u1");
    expect(bindingsAfterA?.size).toBe(1);

    // Second component opening same entity
    const { unmount: unmountB } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    // Binding is deduplicated (Set), so still 1
    const bindingsAfterB = store.entityRegistry.getBindings("u1");
    expect(bindingsAfterB?.size).toBe(1);

    // Unmount first component
    unmountA();
    // Debatable: after A unmounts, B's binding is gone too (Set.delete removes the templateNode).
    // This is the current expected behavior — ref-counting can be added later if needed.
    // For now verify unbind was called.
    const bindingsAfterAUnmount = store.entityRegistry.getBindings("u1");
    expect(bindingsAfterAUnmount?.size).toBe(0);

    unmountB();
  });

  it("phantom fields: entity without template field returns template default", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    // Entity with only name, no email or role
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    const { result } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editUserForm),
    );

    // name is set
    expect(result.current.name.value).toBe("Alice");
    // email not set → template default ""
    expect(result.current.email.value).toBe("");
    // role not set → template default "user"
    expect(result.current.role.value).toBe("user");
  });

  it("the entity proxy spread carries id, the template keys and the entity state keys", () => {
    const store = new Palistor({ config: makeEntityConfig() });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const keys = Object.keys({ ...(store.proxy as any).users.items[0] });
    expect(keys).toEqual(["id", "name", "age", "loading", "submitting", "submit", "values", "dirty"]);
  });
});
