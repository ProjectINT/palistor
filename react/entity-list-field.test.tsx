/**
 * Тесты: сущность с полем-списком, переданным в дочерний компонент
 *
 * Сценарий:
 *   1. Объявляем сущность (простая форма / entity) с полем-списком.
 *   2. Рендерим родительский компонент — получаем form.listField.
 *   3. Передаём form.listField как проп в дочерний компонент.
 *   4. Дочерний компонент вызывает useForm(listField) и рендерит items.
 *
 * Проверяем, что tracking proxy поддерева списка корректно принимается
 * useForm в дочернем компоненте.
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── Сценарий 1: простая форма с полем-списком ───────────────────────────────

describe("простая форма с полем-списком — useForm(listField) в дочернем компоненте", () => {
  it("list proxy из родительского useForm(store) передаётся в дочерний компонент, useForm работает", async () => {
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

    // Дочерний компонент принимает list proxy и вызывает useForm(listProp)
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

    // Родительский компонент — передаёт form.items в дочерний
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

  it("дочерний компонент ре-рендерится при добавлении элемента в список", async () => {
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

    // Предзаполняем список
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

    // Добавляем ещё один элемент — дочерний компонент должен ре-рендериться
    act(() => {
      store.set({ id: "x2", label: "Second" });
      (store.proxy as any).items.add("x2");
    });

    expect(childRenderCount.mock.calls.length).toBeGreaterThan(rendersBefore);
    expect(screen.getByTestId("label-1").textContent).toBe("Second");
  });
});

// ─── Сценарий 2: entity с полем-списком в шаблоне ────────────────────────────
//
// Желаемый паттерн: entity template содержит поле-список.
// Компонент получает entity proxy, читает form.contacts (list proxy),
// передаёт его дочернему компоненту, который вызывает useForm(contacts).
//
// НЕ РАБОТАЕТ: buildEntityProjectionProxy возвращает undefined для array-полей
// (list nodes) в entity template (~line 151 buildEntityProjectionProxy.ts).
//   if (!templateField || typeof templateField !== "object" || Array.isArray(templateField))
//     return undefined;   ← list node (массив) сюда и попадает
//
// Для поддержки нужно per-entity list state.

describe("entity с полем-списком в шаблоне — useForm(contacts) в дочернем компоненте", () => {
  it("list proxy из entity template передаётся в дочерний компонент, useForm(contacts) работает", async () => {
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
          {/* form.contacts должен быть list proxy, не undefined */}
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

  it("два entity получают независимые per-entity списки через дочерний useForm(contacts)", async () => {
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

    // Alice: 1 контакт
    expect(screen.getByTestId("card-u1").querySelectorAll("li").length).toBe(1);
    expect(screen.getByTestId("phone-c1").textContent).toBe("+111");

    // Bob: 2 контакта
    expect(screen.getByTestId("card-u2").querySelectorAll("li").length).toBe(2);
    expect(screen.getByTestId("phone-c2").textContent).toBe("+222");
    expect(screen.getByTestId("phone-c3").textContent).toBe("+333");
  });
});
