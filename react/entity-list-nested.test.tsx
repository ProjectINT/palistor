/**
 * React-тесты nested-of-nested per-entity списков (вариант C, фаза C4).
 *
 *  - 3 уровня (`users → contacts → emails`) рендерятся через вложенные
 *    useForm(listProxy) и ре-рендерятся при мутации на глубине;
 *  - список внутри nested-группы (`profile.contacts`) рендерится корректно
 *    (закрытый блокер: раньше form.profile.contacts был undefined).
 */

import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

// ─── 3-уровневая вложенность ──────────────────────────────────────────────────

describe("nested-of-nested рендер (C4)", () => {
  it("рендерит users → contacts → emails и ре-рендерится при add на глубине", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList({
              template: {
                id: { value: "" },
                phone: { value: "" },
                emails: defineList({
                  template: { id: { value: "" }, addr: { value: "" } },
                }),
              },
            }),
          },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts0 = (store.proxy as any).users.items[0].contacts;
    contacts0.add({ id: "c1", phone: "+1" });
    contacts0.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    function Emails({ emails }: { emails: any }) {
      const list = useForm(emails) as any;
      return (
        <ul>
          {list.items.map((e: any, i: number) => (
            <li key={i} data-testid={`email-${e.id}`}>
              {e.addr.value}
            </li>
          ))}
        </ul>
      );
    }

    function Contact({ contact }: { contact: any }) {
      const form = useForm(contact) as any;
      return (
        <div data-testid={`contact-${form.id}`}>
          <span>{form.phone.value}</span>
          <Emails emails={form.emails} />
        </div>
      );
    }

    function Contacts({ contacts }: { contacts: any }) {
      const list = useForm(contacts) as any;
      return (
        <div>
          {list.items.map((c: any) => (
            <Contact key={c.id} contact={c} />
          ))}
        </div>
      );
    }

    function User() {
      const form = useForm(store) as any;
      return <Contacts contacts={form.users.items[0].contacts} />;
    }

    render(<User />);

    expect(screen.getByTestId("contact-c1")).toBeDefined();
    expect(screen.getByTestId("email-e1").textContent).toBe("a@x.io");
    expect(screen.getByTestId("contact-c1").querySelectorAll("li").length).toBe(1);

    // Мутация на 3-м уровне → перерисовка вложенного компонента emails.
    act(() => {
      contacts0.items[0].emails.add({ id: "e2", addr: "b@x.io" });
    });

    expect(screen.getByTestId("email-e2").textContent).toBe("b@x.io");
    expect(screen.getByTestId("contact-c1").querySelectorAll("li").length).toBe(2);
  });

  it("список внутри nested-группы (profile.contacts) рендерится через useForm", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            profile: {
              bio: { value: "" },
              contacts: defineList({
                template: { id: { value: "" }, phone: { value: "" } },
              }),
            },
          },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    function Contacts({ contacts }: { contacts: any }) {
      const list = useForm(contacts) as any;
      return (
        <ul>
          {list.items.map((c: any) => (
            <li key={c.id} data-testid={`phone-${c.id}`}>
              {c.phone.value}
            </li>
          ))}
        </ul>
      );
    }

    function User() {
      const form = useForm(store) as any;
      // form.users.items[0].profile.contacts должен быть list proxy, не undefined.
      return <Contacts contacts={form.users.items[0].profile.contacts} />;
    }

    render(<User />);
    expect(screen.getByTestId("phone-c1").textContent).toBe("+1");

    act(() => {
      (store.proxy as any).users.items[0].profile.contacts.add({ id: "c2", phone: "+2" });
    });

    expect(screen.getByTestId("phone-c2").textContent).toBe("+2");
  });
});
