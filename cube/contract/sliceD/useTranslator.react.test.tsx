/**
 * useTranslator: the translator registered from a layout reaches every
 * function-valued label / placeholder / description, group labels, list
 * item templates and validate messages; switching it re-renders the readers;
 * unmounting it reverts to keys. New in the contract (Phase 2.2): store
 * covered setTranslator only at the store level (sliceA/store.test.ts).
 */
import { describe, it, expect } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Palistor, useForm, useTranslator, defineList } from "@impl";

type T = (key: string, params?: Record<string, unknown>) => string;

const ru: Record<string, string> = {
  "form.name": "Имя",
  "form.namePlaceholder": "Введите имя",
  "form.nameHelp": "Как к вам обращаться",
  "form.section": "Контакты",
  "form.greeting": "Привет, {name}",
  "errors.required": "Обязательное поле",
  "user.name": "Имя пользователя",
};
const en: Record<string, string> = {
  "form.name": "Name",
  "form.namePlaceholder": "Enter your name",
  "form.nameHelp": "How we address you",
  "form.section": "Contacts",
  "form.greeting": "Hello, {name}",
  "errors.required": "Required",
  "user.name": "User name",
};
const dict = (d: Record<string, string>): T => (key, params) =>
  (d[key] ?? key).replace(/\{(\w+)\}/g, (_, p) => String(params?.[p] ?? ""));
const tRu = dict(ru);
const tEn = dict(en);

const makeConfig = () => ({
  name: {
    value: "",
    label: (t: T) => t("form.name"),
    placeholder: (t: T) => t("form.namePlaceholder"),
    description: (t: T) => t("form.nameHelp"),
    validate: (v: string, _values: unknown, t: T) => (!v ? t("errors.required") : undefined),
  },
  contacts: {
    label: (t: T) => t("form.section"),
    phone: { value: "" },
  },
});

function Fields({ store }: { store: any }) {
  const form = useForm(store) as any;
  return (
    <div>
      <span data-testid="label">{form.name.label}</span>
      <span data-testid="placeholder">{form.name.placeholder}</span>
      <span data-testid="description">{form.name.description}</span>
      <span data-testid="error">{form.name.errorMessage ?? ""}</span>
      <span data-testid="section">{form.contacts.label}</span>
    </div>
  );
}

function Layout({ store, t, children }: { store: any; t: T; children: ReactNode }) {
  useTranslator(store, t);
  return <>{children}</>;
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe("useTranslator", () => {
  it("without the hook, label functions show their keys", () => {
    const store = new Palistor({ config: makeConfig() as any });
    render(<Fields store={store} />);
    expect(text("label")).toBe("form.name");
    expect(text("placeholder")).toBe("form.namePlaceholder");
    expect(text("description")).toBe("form.nameHelp");
    expect(text("section")).toBe("form.section");
  });

  it("a layout with the hook translates label, placeholder, description and group labels", () => {
    const store = new Palistor({ config: makeConfig() as any });
    render(<Layout store={store} t={tRu}><Fields store={store} /></Layout>);
    expect(text("label")).toBe("Имя");
    expect(text("placeholder")).toBe("Введите имя");
    expect(text("description")).toBe("Как к вам обращаться");
    expect(text("section")).toBe("Контакты");
  });

  it("validate receives the registered translator", async () => {
    const store = new Palistor({ config: makeConfig() as any });
    render(<Layout store={store} t={tRu}><Fields store={store} /></Layout>);
    await act(async () => { await store.submit(); });
    expect(text("error")).toBe("Обязательное поле");
  });

  it("switching the translator re-renders readers with the new language", () => {
    const store = new Palistor({ config: makeConfig() as any });
    const { rerender } = render(<Layout store={store} t={tRu}><Fields store={store} /></Layout>);
    expect(text("label")).toBe("Имя");

    rerender(<Layout store={store} t={tEn}><Fields store={store} /></Layout>);
    expect(text("label")).toBe("Name");
    expect(text("placeholder")).toBe("Enter your name");
    expect(text("description")).toBe("How we address you");
    expect(text("section")).toBe("Contacts");
  });

  it("unmounting the hook's host reverts every label to its key", () => {
    const store = new Palistor({ config: makeConfig() as any });
    render(<Fields store={store} />);
    const host = renderHook(() => useTranslator(store as any, tRu));
    expect(text("label")).toBe("Имя");

    act(() => host.unmount());
    expect(text("label")).toBe("form.name");
    expect(text("section")).toBe("form.section");
    expect((store.proxy as any).name.label).toBe("form.name");
  });

  it("re-rendering with the same translator does not notify the store again", () => {
    const store = new Palistor({ config: makeConfig() as any });
    const { rerender } = renderHook(({ t }) => useTranslator(store as any, t), { initialProps: { t: tRu } });
    const version = store.getVersion();
    rerender({ t: tRu });
    rerender({ t: tRu });
    expect(store.getVersion()).toBe(version);
  });

  it("under StrictMode (mount, unmount, mount) the translator stays registered", () => {
    const store = new Palistor({ config: makeConfig() as any });
    render(
      <StrictMode>
        <Layout store={store} t={tRu}><Fields store={store} /></Layout>
      </StrictMode>,
    );
    expect(text("label")).toBe("Имя");
    expect((store.proxy as any).name.label).toBe("Имя");
  });

  it("a label function receives the form values", () => {
    const store = new Palistor({
      config: {
        name: { value: "Ann" },
        greeting: { value: "", label: (t: T, values: any) => t("form.greeting", { name: values.name }) },
      } as any,
    });
    renderHook(() => useTranslator(store as any, tEn));
    expect((store.proxy as any).greeting.label).toBe("Hello, Ann");
  });

  it("list item template labels are translated and follow a switch", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "", label: (t: T) => t("user.name") } },
        } as any),
      } as any,
    });
    store.set([{ id: "u1", name: "Ann" }, { id: "u2", name: "Bob" }]);
    (store.proxy as any).users.setItems(["u1", "u2"]);

    function Users() {
      const form = useForm(store) as any;
      return (
        <ul>
          {form.users.items.map((u: any) => (
            <li key={u.id} data-testid={`user-${u.id}`}>{u.name.label}: {u.name.value}</li>
          ))}
        </ul>
      );
    }

    const host = renderHook(({ t }) => useTranslator(store as any, t), { initialProps: { t: tRu } });
    render(<Users />);
    expect(text("user-u1")).toBe("Имя пользователя: Ann");

    act(() => host.rerender({ t: tEn }));
    expect(text("user-u1")).toBe("User name: Ann");
    expect(text("user-u2")).toBe("User name: Bob");
  });

  it("the `t` a config function receives follows a later switch (a stable reference)", () => {
    let kept: T | null = null;
    const store = new Palistor({
      config: { name: { value: "", label: (t: T) => { kept = t; return t("form.name"); } } } as any,
    });
    const host = renderHook(({ t }) => useTranslator(store as any, t), { initialProps: { t: tRu } });
    expect((store.proxy as any).name.label).toBe("Имя");
    act(() => host.rerender({ t: tEn }));
    expect(kept!("form.name")).toBe("Name");
  });
});
