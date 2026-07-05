/**
 * Tests: defineList + useForm in React
 *
 * Verifies that a list can be declared, resolved and that all items are
 * accessible through useForm inside a component.
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── defineList + useForm: items access in a component ──────────────────────

describe("defineList + useForm — logging the list in React", () => {
  it("after resolve, items are accessible via useForm and console.log works", async () => {
    const mockData = [
      { id: "p1", name: "Alice", age: 30 },
      { id: "p2", name: "Bob", age: 25 },
      { id: "p3", name: "Carol", age: 35 },
    ];

    const resolver = vi.fn(async () => mockData);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const store = new Palistor({
      config: {
        people: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            age: { value: 0 },
          },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    function PeopleList() {
      const form = useForm(store);
      const people = (form as any).people;

      // Accessing items → triggers the lazy resolve
      const items: any[] = people.items;

      // Log the whole list as plain objects
      console.log("list:", people.getValues());

      return (
        <ul>
          {items.map((p: any, i: number) => (
            <li key={i} data-testid={`person-${i}`}>
              {p.name.value} ({p.age.value})
            </li>
          ))}
        </ul>
      );
    }

    render(<PeopleList />);

    // Wait for the resolver to run
    await act(async () => {
      await flushPromises();
    });

    // The resolver was called
    expect(resolver).toHaveBeenCalledTimes(1);

    // All three items are rendered
    expect(screen.getByTestId("person-0").textContent).toBe("Alice (30)");
    expect(screen.getByTestId("person-1").textContent).toBe("Bob (25)");
    expect(screen.getByTestId("person-2").textContent).toBe("Carol (35)");

    // console.log was called with the right data (at least once after resolve)
    const calls = consoleSpy.mock.calls;
    const loggedWithData = calls.find(
      (args) =>
        Array.isArray(args[1]) &&
        args[1].length === 3 &&
        args[1][0].name === "Alice" &&
        args[1][1].name === "Bob" &&
        args[1][2].name === "Carol",
    );
    expect(loggedWithData).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("loading=true while the resolver runs, false afterwards", async () => {
    let resolveList!: (data: any[]) => void;
    const resolver = vi.fn(
      () =>
        new Promise<any[]>((r) => {
          resolveList = r;
        }),
    );

    const store = new Palistor({
      config: {
        items: defineList({
          template: { id: { value: "" }, title: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    const loadingStates: boolean[] = [];

    function ItemList() {
      const form = useForm(store);
      const list = (form as any).items;
      loadingStates.push(list.loading);
      void list.items; // trigger lazy resolve
      return <div data-testid="count">{list.length}</div>;
    }

    render(<ItemList />);

    await act(async () => {
      await flushPromises();
    });

    // While the Promise is unresolved, loading must have been true at some point
    expect(loadingStates.some((v) => v === true)).toBe(true);

    await act(async () => {
      resolveList([
        { id: "i1", title: "First" },
        { id: "i2", title: "Second" },
      ]);
      await flushPromises();
    });

    expect(screen.getByTestId("count").textContent).toBe("2");
    // After resolve — loading is false
    expect(loadingStates[loadingStates.length - 1]).toBe(false);
  });
});

// ─── defineList + useForm entity mode: list fields available via another config ──

describe("defineList + useForm entity mode — list-resolved fields in another config", () => {
  it("after the list resolve, all entity fields are accessible via another config (editForm)", async () => {
    const mockData = [
      { id: "p1", name: "Alice", age: 30, status: "active" },
      { id: "p2", name: "Bob", age: 25, status: "inactive" },
    ];

    const listResolver = vi.fn(async () => mockData);

    const store = new Palistor({
      config: {
        // The list is declared with a template containing all fields
        people: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            age: { value: 0 },
            status: { value: "" },
          },
          resolve: { resolver: listResolver, onError: vi.fn() },
        }),
        // A separate config for editing a single entity
        editPersonForm: {
          id: { value: "" },
          name: { value: "" },
          age: { value: 0 },
          status: { value: "" },
        },
      } as any,
    });

    // Render the list — triggers the resolve
    function PeopleListApp() {
      const form = useForm(store);
      const people = (form as any).people;
      void people.items; // trigger the lazy resolve
      return (
        <ul>
          {people.map((p: any, _i: number, id: string) => (
            <li key={id} data-testid={`row-${id}`}>
              {p.name.value}
            </li>
          ))}
        </ul>
      );
    }

    render(<PeopleListApp />);

    // Wait for the resolver to complete
    await act(async () => {
      await flushPromises();
    });

    expect(listResolver).toHaveBeenCalledTimes(1);

    // Take the first entity from the list
    const aliceProxy = (store.proxy as any).people.items[0];

    // Open the entity through another config (editPersonForm)
    const { result } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editPersonForm),
    );

    const editForm = result.current as any;

    // All fields loaded by the list resolver are accessible in editPersonForm.
    // id is returned directly as a string (an entity projection proxy special case).
    expect(editForm.id).toBe("p1");
    expect(editForm.name.value).toBe("Alice");
    expect(editForm.age.value).toBe(30);
    expect(editForm.status.value).toBe("active");
  });

  it("the second list entity's fields are correctly accessible via editForm", async () => {
    const mockData = [
      { id: "p1", name: "Alice", age: 30, status: "active" },
      { id: "p2", name: "Bob", age: 25, status: "inactive" },
    ];

    const listResolver = vi.fn(async () => mockData);

    const store = new Palistor({
      config: {
        people: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            age: { value: 0 },
            status: { value: "" },
          },
          resolve: { resolver: listResolver, onError: vi.fn() },
        }),
        editPersonForm: {
          id: { value: "" },
          name: { value: "" },
          age: { value: 0 },
          status: { value: "" },
        },
      } as any,
    });

    function PeopleListApp() {
      const form = useForm(store);
      const people = (form as any).people;
      void people.items;
      return <div />;
    }

    render(<PeopleListApp />);

    await act(async () => {
      await flushPromises();
    });

    // The second entity
    const bobProxy = (store.proxy as any).people.items[1];

    const { result } = renderHook(() =>
      useForm(bobProxy, (s: any) => s.editPersonForm),
    );

    const editForm = result.current as any;

    expect(editForm.id).toBe("p2");
    expect(editForm.name.value).toBe("Bob");
    expect(editForm.age.value).toBe(25);
    expect(editForm.status.value).toBe("inactive");
  });
});

// ─── store.set() upsert — React sees the update ───────────────────────────────

describe("store.set() upsert — React gets the signal and sees the updated data", () => {
  it("store.set updates a list entity — the component re-renders with the new value", () => {
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" }, role: { value: "" } },
        ],
      } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "viewer" });
    store.set({ id: "u2", name: "Bob", role: "viewer" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const renderCount = vi.fn();

    function UserList() {
      renderCount();
      const form = useForm(store);
      const users = (form as any).users;
      return (
        <ul>
          {users.map((u: any, _i: number, id: string) => (
            <li key={id} data-testid={`user-${id}`}>
              {u.name.value} / {u.role.value}
            </li>
          ))}
        </ul>
      );
    }

    render(<UserList />);
    expect(screen.getByTestId("user-u1").textContent).toBe("Alice / viewer");
    expect(screen.getByTestId("user-u2").textContent).toBe("Bob / viewer");

    const rendersBefore = renderCount.mock.calls.length;

    // Update only u1 — only its fields change
    act(() => {
      store.set({ id: "u1", name: "Alice Updated", role: "admin" });
    });

    // The component re-rendered
    expect(renderCount.mock.calls.length).toBeGreaterThan(rendersBefore);

    // The DOM is updated for u1
    expect(screen.getByTestId("user-u1").textContent).toBe("Alice Updated / admin");
    // u2 is unchanged
    expect(screen.getByTestId("user-u2").textContent).toBe("Bob / viewer");
  });

  it("store.set updates only one entity field — a component reading another field doesn't re-render", () => {
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" }, role: { value: "" } },
        ],
      } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "viewer" });
    (store.proxy as any).users.add("u1");

    const roleRenderCount = vi.fn();

    // The component reads ONLY role — it must react only to role changes
    function RoleDisplay() {
      roleRenderCount();
      const form = useForm(store);
      const users = (form as any).users;
      return <span data-testid="role">{users.items[0].role.value}</span>;
    }

    render(<RoleDisplay />);
    const rendersBefore = roleRenderCount.mock.calls.length;

    // Change only name — role is untouched
    act(() => {
      store.set({ id: "u1", name: "Alice Updated" });
    });

    // role is unchanged — the component must not re-render
    // (the tracking proxy recorded only the role.value read)
    expect(roleRenderCount.mock.calls.length).toBe(rendersBefore);
    expect(screen.getByTestId("role").textContent).toBe("viewer");
  });

  it("store.set updates several entities — the component sees all updates in one render", () => {
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" } },
        ],
      } as any,
    });

    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
    ]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");
    (store.proxy as any).users.add("u3");

    const renderCount = vi.fn();

    function UserList() {
      renderCount();
      const form = useForm(store);
      const users = (form as any).users;
      return (
        <ul>
          {users.map((u: any, _i: number, id: string) => (
            <li key={id} data-testid={`user-${id}`}>{u.name.value}</li>
          ))}
        </ul>
      );
    }

    render(<UserList />);
    const rendersBefore = renderCount.mock.calls.length;

    // Batch update — all three entities in one store.set
    act(() => {
      store.set([
        { id: "u1", name: "Alice v2" },
        { id: "u2", name: "Bob v2" },
        { id: "u3", name: "Carol v2" },
      ]);
    });

    // One batch → one re-render
    expect(renderCount.mock.calls.length).toBe(rendersBefore + 1);

    // All updates are visible in the DOM
    expect(screen.getByTestId("user-u1").textContent).toBe("Alice v2");
    expect(screen.getByTestId("user-u2").textContent).toBe("Bob v2");
    expect(screen.getByTestId("user-u3").textContent).toBe("Carol v2");
  });
});
