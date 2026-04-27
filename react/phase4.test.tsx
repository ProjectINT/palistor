/**
 * Phase 4: Integration & E2E tests
 *
 * 4.1: Shared leaf notifications — entity leaf `version++` → all observers
 *      (list + form) re-render. Тест: edit name в форме → UserRow в списке
 *      re-render (та же leaf нода).
 *
 * 4.2: bumpLeafVersions с entity leafs — entity leafs registered via
 *      registerDynamicLeaf in shared computeNodes array → translator change
 *      бампит всё автоматически. Верифицировать.
 *
 * 4.3: E2E — полный сценарий:
 *      список → resolver загружает entities → клик → useForm(entity, template)
 *      → resolve доп. полей → edit name → список обновился → close → open снова
 *      (кеш) → submit.
 */

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { renderHook, act, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { useForm } from "./useForm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── 4.1: Shared leaf notifications ──────────────────────────────────────────

describe("4.1: Shared leaf notifications", () => {
  /**
   * The same entity leaf node is shared between:
   *   - a list view component reading via store.proxy.users
   *   - a form view component reading via useForm(entity, editTemplate)
   *
   * Writing through the form proxy must notify both components because
   * they track the same underlying EntityLeafNode object.
   */
  it("edit via form proxy → list view and form view both re-render with updated value", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUserForm: {
          name: { value: "" },
          email: { value: "" },
        },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const listRenderCount = vi.fn();
    const formRenderCount = vi.fn();

    // Component A: reads entity name through the list proxy.
    // Subscribes via useForm(store) — tracks LIST NODE + entity leaf.
    function ListView() {
      listRenderCount();
      const form = useForm(store);
      const users = (form as any).users;
      const firstName = users.items[0]?.name?.value ?? "";
      return <span data-testid="list-name">{firstName}</span>;
    }

    // Component B: reads entity name through entity+template projection proxy.
    // Subscribes via useForm(entityProxy, template) — tracks entity leaf directly.
    function FormView() {
      formRenderCount();
      const aliceProxy = (store.proxy as any).users.items[0];
      const u = useForm(aliceProxy, (s: any) => s.editUserForm);
      return (
        <div>
          <span data-testid="form-name">{u.name.value}</span>
          <button
            data-testid="update-btn"
            onClick={() => {
              u.name.value = "Alice Cooper";
            }}
          >
            Update
          </button>
        </div>
      );
    }

    render(
      <div>
        <ListView />
        <FormView />
      </div>,
    );

    expect(screen.getByTestId("list-name").textContent).toBe("Alice");
    expect(screen.getByTestId("form-name").textContent).toBe("Alice");

    const listBefore = listRenderCount.mock.calls.length;
    const formBefore = formRenderCount.mock.calls.length;

    // Write through the form proxy — updates the shared entity leaf
    act(() => {
      screen.getByTestId("update-btn").click();
    });

    // Both components re-rendered because they track the same entity leaf
    expect(listRenderCount.mock.calls.length).toBeGreaterThan(listBefore);
    expect(formRenderCount.mock.calls.length).toBeGreaterThan(formBefore);

    // Both show the updated value
    expect(screen.getByTestId("list-name").textContent).toBe("Alice Cooper");
    expect(screen.getByTestId("form-name").textContent).toBe("Alice Cooper");
  });

  it("store.set() external update → all views of the entity re-render", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUserForm: { name: { value: "" } },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const listRenderCount = vi.fn();
    const formRenderCount = vi.fn();

    function ListView() {
      listRenderCount();
      const form = useForm(store);
      const name = (form as any).users.items[0]?.name?.value ?? "";
      return <span data-testid="list-name">{name}</span>;
    }

    function FormView() {
      formRenderCount();
      const aliceProxy = (store.proxy as any).users.items[0];
      const u = useForm(aliceProxy, (s: any) => s.editUserForm);
      return <span data-testid="form-name">{u.name.value}</span>;
    }

    render(
      <div>
        <ListView />
        <FormView />
      </div>,
    );

    expect(screen.getByTestId("list-name").textContent).toBe("Alice");
    expect(screen.getByTestId("form-name").textContent).toBe("Alice");

    const listBefore = listRenderCount.mock.calls.length;
    const formBefore = formRenderCount.mock.calls.length;

    // External update via store.set() — should propagate to all views
    act(() => {
      store.set({ id: "u1", name: "Alice Updated" });
    });

    // Both views re-rendered
    expect(listRenderCount.mock.calls.length).toBeGreaterThan(listBefore);
    expect(formRenderCount.mock.calls.length).toBeGreaterThan(formBefore);

    expect(screen.getByTestId("list-name").textContent).toBe("Alice Updated");
    expect(screen.getByTestId("form-name").textContent).toBe("Alice Updated");
  });

  it("selective notification — only the component tracking the changed entity re-renders", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUserForm: { name: { value: "" } },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const u1Renders = vi.fn();
    const u2Renders = vi.fn();

    const u1Proxy = (store.proxy as any).users.items[0];
    const u2Proxy = (store.proxy as any).users.items[1];

    // Each NameDisplay independently subscribes to its own entity leaf
    // via useForm(entityProxy, template), so only the changed entity re-renders.
    function NameDisplay({
      entityProxy,
      label,
      renderFn,
    }: {
      entityProxy: any;
      label: string;
      renderFn: () => void;
    }) {
      renderFn();
      const u = useForm(entityProxy, (s: any) => s.editUserForm);
      return <span data-testid={`name-${label}`}>{u.name.value}</span>;
    }

    render(
      <div>
        <NameDisplay entityProxy={u1Proxy} label="u1" renderFn={u1Renders} />
        <NameDisplay entityProxy={u2Proxy} label="u2" renderFn={u2Renders} />
      </div>,
    );

    const u1Before = u1Renders.mock.calls.length;
    const u2Before = u2Renders.mock.calls.length;

    expect(screen.getByTestId("name-u1").textContent).toBe("Alice");
    expect(screen.getByTestId("name-u2").textContent).toBe("Bob");

    // Change only u1's name
    act(() => {
      store.set({ id: "u1", name: "Alice Cooper" });
    });

    // u1's component re-rendered, u2's did NOT
    expect(u1Renders.mock.calls.length).toBeGreaterThan(u1Before);
    expect(u2Renders.mock.calls.length).toBe(u2Before);

    expect(screen.getByTestId("name-u1").textContent).toBe("Alice Cooper");
    expect(screen.getByTestId("name-u2").textContent).toBe("Bob");
  });
});

// ─── 4.2: bumpLeafVersions с entity leafs ────────────────────────────────────

describe("4.2: bumpLeafVersions с entity leafs", () => {
  /**
   * Entity leafs added via registerDynamicLeaf must end up in the shared
   * `computeNodes` array so that bumpLeafVersions() covers them.
   */
  it("entity leaf nodes added via registerDynamicLeaf are included in computeNodes array", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
      } as any,
    });

    const leafCountBefore = store.nodes.computeNodes.length;

    // store.set() triggers _walkAndSyncEntityNode → registerDynamicLeaf for each leaf
    store.set({ id: "u1", name: "Alice" });

    // id + name = 2 new entity leaf nodes
    expect(store.nodes.computeNodes.length).toBe(leafCountBefore + 2);

    // The actual entity leaf node objects must be present in the array
    const entityNode = store.entityRegistry.get("u1")!;
    const idLeaf = entityNode.id as object;
    const nameLeaf = (entityNode as any).name as object;

    const leafNodeObjects = store.nodes.computeNodes.map((l) => l.node);
    expect(leafNodeObjects).toContain(idLeaf);
    expect(leafNodeObjects).toContain(nameLeaf);
  });

  it("adding more fields via subsequent store.set() registers new leaf nodes", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    const countAfterFirst = store.nodes.computeNodes.length;

    // Add a new field 'email' to entity u1 — registers a new leaf
    store.set({ id: "u1", email: "alice@corp.com" } as any);

    expect(store.nodes.computeNodes.length).toBe(countAfterFirst + 1);

    const entityNode = store.entityRegistry.get("u1")!;
    const emailLeaf = (entityNode as any).email as object;
    const leafNodeObjects = store.nodes.computeNodes.map((l) => l.node);
    expect(leafNodeObjects).toContain(emailLeaf);
  });

  /**
   * When setTranslator is called with a new translator, bumpLeafVersions()
   * bumps all leaf node versions — including entity leafs registered
   * via registerDynamicLeaf. Components reading entity fields must re-render.
   */
  it("setTranslator bumps entity leaf versions → component reading entity field re-renders", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUserForm: { name: { value: "" } },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const renderCount = vi.fn();

    // Component reads entity name through list proxy.
    // Tracking proxy records the entity leaf node in refs.accessed.
    function EntityDisplay() {
      renderCount();
      const form = useForm(store);
      const users = (form as any).users;
      const nameValue = users.items[0]?.name?.value ?? "";
      return <span data-testid="name">{nameValue}</span>;
    }

    render(<EntityDisplay />);
    expect(screen.getByTestId("name").textContent).toBe("Alice");
    const rendersBefore = renderCount.mock.calls.length;

    // Change translator → store.setTranslator → hub.bumpLeafVersions()
    // bumpLeafVersions increments version for ALL leafNodes including entity ones.
    act(() => {
      store.setTranslator((key: string) => `[${key}]`);
    });

    // Component re-rendered because its tracked entity leaf version was bumped
    expect(renderCount.mock.calls.length).toBeGreaterThan(rendersBefore);
  });

  it("bumpLeafVersions increments version for entity leaf node directly", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });

    const entityNode = store.entityRegistry.get("u1")!;
    const nameLeaf = (entityNode as any).name as object;

    const versionBefore = store.getNodeVersion(nameLeaf);

    // bumpLeafVersions should also bump entity leaf versions
    act(() => {
      store.hub.bumpLeafVersions();
    });

    const versionAfter = store.getNodeVersion(nameLeaf);
    expect(versionAfter).toBeGreaterThan(versionBefore);
  });
});

// ─── 4.3: E2E — полный сценарий ──────────────────────────────────────────────

describe("4.3: E2E — полный сценарий", () => {
  /**
   * Full scenario:
   *   1. List resolver loads entities → UI shows names
   *   2. Click edit → useForm(entity, template) → bind + trigger resolve
   *   3. Template resolver loads additional fields (email, role)
   *   4. Edit name in form → list row also updates (shared entity leaf)
   *   5. Close modal → unmount → unbind
   *   6. Reopen same entity → isResolved = true → skip resolve (cache hit)
   *   7. Submit → validation → onSubmit → afterSubmit
   */
  it("list load → edit → resolve → edit name → list updates → close → reopen (cache) → submit", async () => {
    // ─── Mocks ───────────────────────────────────────────────────────────────

    const templateResolver = vi.fn(async (thisForm: any) => ({
      id: thisForm.id,
      email: `${thisForm.id}@corp.com`,
      role: "admin",
    }));
    const onSubmit = vi.fn().mockResolvedValue({ saved: true });
    const afterSubmit = vi.fn();

    // ─── Store ───────────────────────────────────────────────────────────────

    let resolveList!: (v: any[]) => void;
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" } },
          {
            resolve: {
              resolver: () => new Promise<any[]>((r) => { resolveList = r; }),
            },
          },
        ] as any,
        editUserForm: {
          id: { value: "" },
          name: { value: "", isRequired: true },
          email: { value: "" },
          role: { value: "viewer" },
          resolve: {
            resolver: templateResolver,
            onError: vi.fn(),
          },
          onSubmit,
          afterSubmit,
        },
      } as any,
    });

    // ─── Component tree ───────────────────────────────────────────────────

    function EditModal({
      user,
      onClose,
    }: {
      user: any;
      onClose: () => void;
    }) {
      const u = useForm(user, (s: any) => s.editUserForm);

      if (u.loading) {
        return <div data-testid="modal-loading">Loading...</div>;
      }

      return (
        <div data-testid="modal">
          <span data-testid="modal-name">{u.name.value}</span>
          <span data-testid="modal-email">{u.email.value}</span>
          <span data-testid="modal-role">{u.role.value}</span>
          <button
            data-testid="change-name-btn"
            onClick={() => {
              u.name.value = "Alice Cooper";
            }}
          >
            Change Name
          </button>
          <button
            data-testid="save-btn"
            onClick={async () => {
              const result = await u.submit();
              if (result.success) onClose();
            }}
          >
            Save
          </button>
          <button data-testid="close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      );
    }

    function App() {
      const [editUser, setEditUser] = useState<any>(null);
      const form = useForm(store);
      const users = (form as any).users;

      return (
        <div>
          {users.loading && (
            <div data-testid="list-loading">Loading list...</div>
          )}
          {users.map((user: any, _i: number, id: string) => (
            <div key={id}>
              <span data-testid={`row-name-${id}`}>{user.name.value}</span>
              <button
                data-testid={`edit-${id}`}
                onClick={() => setEditUser(user)}
              >
                Edit
              </button>
            </div>
          ))}
          {editUser && (
            <EditModal user={editUser} onClose={() => setEditUser(null)} />
          )}
        </div>
      );
    }

    // ─── Step 1: Initial render + list loads ──────────────────────────────

    render(<App />);

    // Flush microtask — lazy list resolve is deferred via queueMicrotask
    await act(async () => {
      await Promise.resolve();
    });

    // List resolver fires after microtask → loading: true (resolver still pending)
    expect(screen.queryByTestId("list-loading")).toBeTruthy();

    // Resolve the list and flush promises
    await act(async () => {
      resolveList([
        { id: "u1", name: "Alice" },
        { id: "u2", name: "Bob" },
      ]);
      await flushPromises();
    });

    // List loaded
    expect(screen.queryByTestId("list-loading")).toBeFalsy();
    expect(screen.getByTestId("row-name-u1").textContent).toBe("Alice");
    expect(screen.getByTestId("row-name-u2").textContent).toBe("Bob");

    // ─── Step 2: Click edit on Alice ──────────────────────────────────────

    expect(templateResolver).not.toHaveBeenCalled();

    act(() => {
      screen.getByTestId("edit-u1").click();
    });

    // Modal mounts; useEffect (bind + triggerEntityTemplateResolve) fires
    // after render. The template resolver starts loading.
    // Flush microtasks so useEffect runs and resolver fires.
    await act(async () => {
      await flushPromises();
    });

    // ─── Step 3: Template resolver resolves with additional fields ─────────

    expect(templateResolver).toHaveBeenCalledTimes(1);
    // thisForm.id should equal the entity id
    const [calledForm] = templateResolver.mock.calls[0];
    expect(calledForm.id).toBe("u1");

    // Modal shows complete data
    expect(screen.queryByTestId("modal-loading")).toBeFalsy();
    expect(screen.getByTestId("modal-name").textContent).toBe("Alice");
    expect(screen.getByTestId("modal-email").textContent).toBe("u1@corp.com");
    expect(screen.getByTestId("modal-role").textContent).toBe("admin");

    // ─── Step 4: Edit name in form → list row also updates ───────────────

    act(() => {
      screen.getByTestId("change-name-btn").click();
    });

    // Both the modal and the list row show the updated name (shared leaf)
    expect(screen.getByTestId("modal-name").textContent).toBe("Alice Cooper");
    expect(screen.getByTestId("row-name-u1").textContent).toBe("Alice Cooper");
    // u2 is unaffected
    expect(screen.getByTestId("row-name-u2").textContent).toBe("Bob");

    // ─── Step 5: Close modal → unmount → unbind ───────────────────────────

    act(() => {
      screen.getByTestId("close-btn").click();
    });

    expect(screen.queryByTestId("modal")).toBeFalsy();

    // resolvedCache survives unmount — entity stays resolved for the template.
    // Verified indirectly in Step 6: resolver is not called again.

    // ─── Step 6: Reopen Alice → skip resolve (cache hit) ─────────────────

    act(() => {
      screen.getByTestId("edit-u1").click();
    });
    await act(async () => {
      await flushPromises();
    });

    // Resolver must NOT have been called again (resolved cache hit)
    expect(templateResolver).toHaveBeenCalledTimes(1);

    // All data still available instantly from the resolved entity
    expect(screen.queryByTestId("modal-loading")).toBeFalsy();
    expect(screen.getByTestId("modal-name").textContent).toBe("Alice Cooper");
    expect(screen.getByTestId("modal-email").textContent).toBe("u1@corp.com");
    expect(screen.getByTestId("modal-role").textContent).toBe("admin");

    // ─── Step 7: Submit ───────────────────────────────────────────────────

    act(() => {
      screen.getByTestId("save-btn").click();
    });
    await act(async () => {
      await flushPromises();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // onSubmit receives (entityProxy, store)
    const [submittedProxy, submittedStore] = onSubmit.mock.calls[0];
    expect(submittedProxy.name.value).toBe("Alice Cooper");
    expect(submittedProxy.email.value).toBe("u1@corp.com");
    expect(submittedStore).toBe(store);

    expect(afterSubmit).toHaveBeenCalledWith(
      { saved: true },
      expect.objectContaining({ reset: expect.any(Function) }),
    );

    // Modal closed after successful submit
    expect(screen.queryByTestId("modal")).toBeFalsy();
  });

  it("E2E: submit failure (validation) → modal stays open with errors", async () => {
    const onSubmit = vi.fn();
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }] as any,
        editUserForm: {
          id: { value: "" },
          name: {
            value: "",
            isRequired: true,
            validate: (v: string) => (!v ? "Name is required" : undefined),
          },
          onSubmit,
        },
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    let submitResult: any;

    function EditModal({ user }: { user: any }) {
      const u = useForm(user, (s: any) => s.editUserForm);
      return (
        <div data-testid="modal">
          <span data-testid="name-val">{u.name.value}</span>
          <button
            data-testid="clear-name-btn"
            onClick={() => {
              u.name.value = "";
            }}
          >
            Clear Name
          </button>
          <button
            data-testid="save-btn"
            onClick={async () => {
              submitResult = await u.submit();
            }}
          >
            Save
          </button>
        </div>
      );
    }

    const user = (store.proxy as any).users.items[0];
    render(<EditModal user={user} />);

    // Clear the name (now invalid)
    act(() => {
      screen.getByTestId("clear-name-btn").click();
    });
    expect(screen.getByTestId("name-val").textContent).toBe("");

    // Attempt submit
    act(() => {
      screen.getByTestId("save-btn").click();
    });
    await act(async () => {
      await flushPromises();
    });

    // Submit fails: validation error
    expect(submitResult.success).toBe(false);
    expect(submitResult.errors[0].message).toBe("Name is required");

    // onSubmit was NOT called since validation failed
    expect(onSubmit).not.toHaveBeenCalled();

    // Modal still open
    expect(screen.getByTestId("modal")).toBeTruthy();
  });

  it("E2E: store.delete() removes entity from list", async () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }] as any,
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    function UserList() {
      const form = useForm(store);
      const users = (form as any).users;
      return (
        <ul>
          {users.map((user: any, _i: number, id: string) => (
            <li key={id} data-testid={`user-${id}`}>
              {user.name.value}
            </li>
          ))}
        </ul>
      );
    }

    render(<UserList />);

    expect(screen.queryByTestId("user-u1")).toBeTruthy();
    expect(screen.queryByTestId("user-u2")).toBeTruthy();

    // Delete entity u1
    act(() => {
      store.delete("u1");
    });

    // u1 is gone, u2 remains
    expect(screen.queryByTestId("user-u1")).toBeFalsy();
    expect(screen.queryByTestId("user-u2")).toBeTruthy();
    expect(store.entityRegistry.get("u1")).toBeUndefined();
  });

  it("E2E: store.rekey() updates entity id in list and form", async () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }] as any,
        editUserForm: { id: { value: "" }, name: { value: "" } },
      } as any,
    });
    store.set({ id: "_tmp_1", name: "New User" });
    (store.proxy as any).users.add("_tmp_1");

    const userProxy = (store.proxy as any).users.items[0];
    const renderCount = vi.fn();

    function IdDisplay() {
      renderCount();
      const u = useForm(userProxy, (s: any) => s.editUserForm);
      return <span data-testid="entity-id">{u.id as string}</span>;
    }

    render(<IdDisplay />);
    expect(screen.getByTestId("entity-id").textContent).toBe("_tmp_1");

    // Rekey: assign real server id after save
    act(() => {
      store.rekey("_tmp_1", "u99");
    });

    // Entity id updated
    expect(screen.getByTestId("entity-id").textContent).toBe("u99");

    // Entity is accessible under new id in registry
    expect(store.entityRegistry.get("u99")).toBeDefined();
    expect(store.entityRegistry.get("_tmp_1")).toBeUndefined();

    // List still contains the entity (itemIds updated)
    const listState = store.nodes.listStates.get(
      (store.rootConfig as any).users,
    );
    expect(listState?.itemIds).toContain("u99");
    expect(listState?.itemIds).not.toContain("_tmp_1");
  });
});

// ─── 4.1 additional: renderHook-level shared leaf verification ──────────────

describe("4.1 additional: renderHook, shared leaf — entity change notifies all trackers", () => {
  it("write via entity+template proxy updates hook reading the same leaf via list", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUserForm: { name: { value: "" } },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const aliceProxy = (store.proxy as any).users.items[0];

    // Hook A: reads via list
    const { result: listResult } = renderHook(() => {
      const form = useForm(store);
      return (form as any).users.items[0]?.name?.value;
    });

    // Hook B: reads via entity+template projection
    const { result: formResult } = renderHook(() => {
      const u = useForm(aliceProxy, (s: any) => s.editUserForm);
      return u;
    });

    expect(listResult.current).toBe("Alice");
    expect(formResult.current.name.value).toBe("Alice");

    // Write through the form proxy
    act(() => {
      formResult.current.name.value = "Alice Cooper";
    });

    // Both hooks see the updated value (shared leaf node)
    expect(listResult.current).toBe("Alice Cooper");
    expect(formResult.current.name.value).toBe("Alice Cooper");
  });

  it("store.set() batch: multiple entities update, only affected hooks re-render", () => {
    const store = new Palistor({
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUserForm: { name: { value: "" } },
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const u1Proxy = (store.proxy as any).users.items[0];
    const u2Proxy = (store.proxy as any).users.items[1];

    const u1Renders = vi.fn();
    const u2Renders = vi.fn();

    renderHook(() => {
      u1Renders();
      const u = useForm(u1Proxy, (s: any) => s.editUserForm);
      return u.name.value;
    });

    renderHook(() => {
      u2Renders();
      const u = useForm(u2Proxy, (s: any) => s.editUserForm);
      return u.name.value;
    });

    const u1Before = u1Renders.mock.calls.length;
    const u2Before = u2Renders.mock.calls.length;

    // Update only u2 via store.set()
    act(() => {
      store.set({ id: "u2", name: "Robert" });
    });

    // Only u2's hook re-rendered
    expect(u1Renders.mock.calls.length).toBe(u1Before);
    expect(u2Renders.mock.calls.length).toBeGreaterThan(u2Before);
  });
});
