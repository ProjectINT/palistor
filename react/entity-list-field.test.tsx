/**
 * Tests: an entity with a list field passed into a child component
 *
 * Scenario:
 *   1. Declare an entity (simple form / entity) with a list field.
 *   2. Render the parent component — obtain form.listField.
 *   3. Pass form.listField as a prop into the child component.
 *   4. The child component calls useForm(listField) and renders the items.
 *
 * Verifies that the list subtree's tracking proxy is correctly accepted
 * by useForm in the child component.
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── Scenario 1: a simple form with a list field ──────────────────────────────

describe("a simple form with a list field — useForm(listField) in a child component", () => {
  it("the list proxy from the parent useForm(store) is passed to the child; useForm works", async () => {
    const itemsResolver = vi.fn(async () => [
      { id: "i1", name: "Apple", qty: 3 },
      { id: "i2", name: "Banana", qty: 5 },
    ]);

    const store = new Palistor({
      config: {
        title: { value: "My Cart" },
        items: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            qty: { value: 0 },
          },
          resolve: { resolver: itemsResolver, onError: vi.fn() },
        }),
      } as any,
    });

    // The child component accepts the list proxy and calls useForm(listProp)
    function ItemsList({ items }: { items: any }) {
      const list = useForm(items) as any;
      const listItems = list.items; // lazy trigger resolve
      return (
        <ul>
          {listItems.map((item: any, i: number) => (
            <li key={i} data-testid={`item-${i}`}>
              {item.name.value} ({item.qty.value})
            </li>
          ))}
        </ul>
      );
    }

    // The parent component — passes form.items into the child
    function CartForm() {
      const form = useForm(store) as any;
      return (
        <div>
          <h1 data-testid="cart-title">{form.title.value}</h1>
          <ItemsList items={form.items} />
        </div>
      );
    }

    render(<CartForm />);

    await act(async () => {
      await flushPromises();
    });

    expect(screen.getByTestId("cart-title").textContent).toBe("My Cart");
    expect(screen.getByTestId("item-0").textContent).toBe("Apple (3)");
    expect(screen.getByTestId("item-1").textContent).toBe("Banana (5)");
    expect(itemsResolver).toHaveBeenCalledTimes(1);
  });

  it("the child component re-renders when an item is added to the list", async () => {
    const store = new Palistor({
      config: {
        items: defineList({
          template: {
            id: { value: "" },
            label: { value: "" },
          },
        }),
      } as any,
    });

    // Pre-fill the list
    store.set({ id: "x1", label: "First" });
    (store.proxy as any).items.add("x1");

    const childRenderCount = vi.fn();

    function ItemsList({ items }: { items: any }) {
      childRenderCount();
      const list = useForm(items) as any;
      return (
        <ul>
          {list.items.map((item: any, i: number) => (
            <li key={i} data-testid={`label-${i}`}>
              {item.label.value}
            </li>
          ))}
        </ul>
      );
    }

    function ParentForm() {
      const form = useForm(store) as any;
      return <ItemsList items={form.items} />;
    }

    render(<ParentForm />);
    expect(screen.getByTestId("label-0").textContent).toBe("First");

    const rendersBefore = childRenderCount.mock.calls.length;

    // Add one more item — the child component must re-render
    act(() => {
      store.set({ id: "x2", label: "Second" });
      (store.proxy as any).items.add("x2");
    });

    expect(childRenderCount.mock.calls.length).toBeGreaterThan(rendersBefore);
    expect(screen.getByTestId("label-1").textContent).toBe("Second");
  });
});

// ─── Scenario 2: an entity with a list field in the template─────────────────────────
//
// The desired pattern: the entity template contains a list field.
// A component receives the entity proxy, reads form.contacts (a list proxy),
// and passes it into a child component that calls useForm(contacts).
//
// PREVIOUSLY BROKEN: buildEntityProjectionProxy returned undefined for array
// fields (list nodes) in an entity template.
//   if (!templateField || typeof templateField !== "object" || Array.isArray(templateField))
//     return undefined;   ← the list node (array) landed here
//
// Support requires per-entity list state.

describe("an entity with a list field in the template — useForm(contacts) in a child component", () => {
  it("the list proxy from the entity template is passed to the child; useForm(contacts) works", async () => {
    const contactsResolver = vi.fn(async () => [
      { id: "c1", phone: "+1-800-ALICE" },
      { id: "c2", phone: "+1-800-CALL" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
          },
        }),
        editUser: {
          id: { value: "" },
          name: { value: "" },
          contacts: defineList({
            template: {
              id: { value: "" },
              phone: { value: "" },
            },
            resolve: { resolver: contactsResolver, onError: vi.fn() },
          }),
        },
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    function ContactsList({ contacts }: { contacts: any }) {
      const list = useForm(contacts) as any;
      const items = list.items; // lazy trigger resolve
      return (
        <ul>
          {items.map((contact: any, i: number) => (
            <li key={i} data-testid={`contact-${i}`}>
              {contact.phone.value}
            </li>
          ))}
        </ul>
      );
    }

    function UserEdit({ userProxy }: { userProxy: any }) {
      const form = useForm(userProxy, (s: any) => s.editUser) as any;
      return (
        <div>
          <span data-testid="user-name">{form.name.value}</span>
          {/* form.contacts must be a list proxy, not undefined */}
          <ContactsList contacts={form.contacts} />
        </div>
      );
    }

    const userProxy = (store.proxy as any).users.items[0];
    render(<UserEdit userProxy={userProxy} />);

    await act(async () => {
      await flushPromises();
    });

    expect(screen.getByTestId("user-name").textContent).toBe("Alice");
    expect(screen.getByTestId("contact-0").textContent).toBe("+1-800-ALICE");
    expect(screen.getByTestId("contact-1").textContent).toBe("+1-800-CALL");
    expect(contactsResolver).toHaveBeenCalledTimes(1);
  });

  it("two entities get independent per-entity lists via the child useForm(contacts)", async () => {
    const contactsResolver = vi.fn(async (values: any) => {
      if (values.id === "u1") return [{ id: "c1", phone: "+111" }];
      return [{ id: "c2", phone: "+222" }, { id: "c3", phone: "+333" }];
    });

    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
          },
        }),
        editUser: {
          id: { value: "" },
          name: { value: "" },
          contacts: defineList({
            template: {
              id: { value: "" },
              phone: { value: "" },
            },
            resolve: { resolver: contactsResolver, onError: vi.fn() },
          }),
        },
      } as any,
    });

    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    function ContactsList({ contacts }: { contacts: any }) {
      const list = useForm(contacts) as any;
      return (
        <ul>
          {list.items.map((c: any, i: number) => (
            <li key={i} data-testid={`phone-${c.id}`}>
              {c.phone.value}
            </li>
          ))}
        </ul>
      );
    }

    function UserCard({ userProxy, testId }: { userProxy: any; testId: string }) {
      const form = useForm(userProxy, (s: any) => s.editUser) as any;
      return (
        <div data-testid={testId}>
          <ContactsList contacts={form.contacts} />
        </div>
      );
    }

    const u1 = (store.proxy as any).users.items[0];
    const u2 = (store.proxy as any).users.items[1];

    render(
      <>
        <UserCard userProxy={u1} testId="card-u1" />
        <UserCard userProxy={u2} testId="card-u2" />
      </>,
    );

    await act(async () => {
      await flushPromises();
    });

    // Alice: 1 contact
    expect(screen.getByTestId("card-u1").querySelectorAll("li").length).toBe(1);
    expect(screen.getByTestId("phone-c1").textContent).toBe("+111");

    // Bob: 2 contacts
    expect(screen.getByTestId("card-u2").querySelectorAll("li").length).toBe(2);
    expect(screen.getByTestId("phone-c2").textContent).toBe("+222");
    expect(screen.getByTestId("phone-c3").textContent).toBe("+333");
  });
});
