import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import { createProxyStore } from "../store/store";
import { useForm } from "./useForm";

// ─── Тестовый конфиг ─────────────────────────────────────────────────────────

const makeConfig = () => ({
  email: {
    value: "",
    label: "Email",
    isRequired: true,
    validate: (v: string) => (!v ? "required" : undefined),
  },
  paymentType: {
    value: "card",
    label: "Payment Type",
  },
  cardNumber: {
    value: "",
    label: "Card Number",
    isVisible: (values: any) => values.paymentType === "card",
    isRequired: (values: any) => values.paymentType === "card",
  },
  passport: {
    isVisible: (values: any) => values.paymentType === "bank",
    number: {
      value: "",
      label: "Passport Number",
      isRequired: true,
    },
    issueDate: {
      value: "",
      label: "Issue Date",
    },
  },
});

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("useForm", () => {
  it("возвращает прокси с текущими значениями", () => {
    const store = createProxyStore({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.email.value).toBe("");
    expect(result.current.email.label).toBe("Email");
    expect(result.current.paymentType.value).toBe("card");
  });

  it("читает вычисленные свойства (isVisible, isRequired)", () => {
    const store = createProxyStore({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.email.isRequired).toBe(true);
    expect(result.current.cardNumber.isVisible).toBe(true);
    expect(result.current.passport.isVisible).toBe(false);
  });

  it("вложенные поля доступны через точку", () => {
    const store = createProxyStore({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.passport.number.value).toBe("");
    expect(result.current.passport.number.label).toBe("Passport Number");
    expect(result.current.passport.number.isRequired).toBe(true);
  });

  it("ре-рендерит компонент при записи value", () => {
    const store = createProxyStore({ config: makeConfig() });
    const renderCount = vi.fn();

    const { result } = renderHook(() => {
      renderCount();
      return useForm(store);
    });

    expect(renderCount).toHaveBeenCalledTimes(1);

    // Запись через proxy
    act(() => {
      store.proxy.email.value = "test@test.com";
    });

    expect(renderCount).toHaveBeenCalledTimes(2);
    expect(result.current.email.value).toBe("test@test.com");
  });

  it("пересчитывает зависимые поля после изменения", () => {
    const store = createProxyStore({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.cardNumber.isVisible).toBe(true);
    expect(result.current.passport.isVisible).toBe(false);

    act(() => {
      store.proxy.paymentType.value = "bank";
    });

    expect(result.current.cardNumber.isVisible).toBe(false);
    expect(result.current.passport.isVisible).toBe(true);
  });

  it("запись через useForm proxy работает из компонента", () => {
    const store = createProxyStore({ config: makeConfig() });

    function TestComponent() {
      const form = useForm(store);
      return (
        <div>
          <span data-testid="email-value">{form.email.value}</span>
          <span data-testid="email-error">{form.email.error ? "Error" : "none"}</span>
          <button onClick={() => { form.email.value = "hello@test.com"; }}>
            Set Email
          </button>
        </div>
      );
    }

    render(<TestComponent />);

    expect(screen.getByTestId("email-value").textContent).toBe("");
    expect(screen.getByTestId("email-error").textContent).toBe("Error");

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByTestId("email-value").textContent).toBe("hello@test.com");
    expect(screen.getByTestId("email-error").textContent).toBe("none");
  });

  it("поддерево можно передать в дочерний компонент как проп", () => {
    const store = createProxyStore({ config: makeConfig() });

    function PassportSection({ passport }: { passport: any }) {
      if (!passport.isVisible) return <span data-testid="hidden">hidden</span>;
      return (
        <div>
          <span data-testid="passport-number">{passport.number.value}</span>
          <span data-testid="passport-label">{passport.number.label}</span>
        </div>
      );
    }

    function App() {
      const form = useForm(store);
      return (
        <div>
          <span data-testid="payment">{form.paymentType.value}</span>
          <PassportSection passport={form.passport} />
          <button onClick={() => { form.paymentType.value = "bank"; }}>
            Switch to Bank
          </button>
          <button onClick={() => { form.passport.number.value = "AB123"; }}>
            Set Number
          </button>
        </div>
      );
    }

    render(<App />);

    // Изначально passport скрыт
    expect(screen.getByTestId("hidden").textContent).toBe("hidden");

    // Переключаем на bank
    act(() => {
      screen.getByText("Switch to Bank").click();
    });

    // Теперь passport видим
    expect(screen.getByTestId("passport-number").textContent).toBe("");
    expect(screen.getByTestId("passport-label").textContent).toBe("Passport Number");

    // Устанавливаем номер паспорта
    act(() => {
      screen.getByText("Set Number").click();
    });

    expect(screen.getByTestId("passport-number").textContent).toBe("AB123");
  });

  it("несколько компонентов с одним store синхронизированы", () => {
    const store = createProxyStore({ config: makeConfig() });

    function EmailDisplay() {
      const form = useForm(store);
      return <span data-testid="display">{form.email.value}</span>;
    }

    function EmailInput() {
      const form = useForm(store);
      return (
        <button onClick={() => { form.email.value = "shared@test.com"; }}>
          Update
        </button>
      );
    }

    render(
      <div>
        <EmailDisplay />
        <EmailInput />
      </div>
    );

    expect(screen.getByTestId("display").textContent).toBe("");

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByTestId("display").textContent).toBe("shared@test.com");
  });

  it("getValues() отражает изменения сделанные через useForm proxy", () => {
    const store = createProxyStore({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    act(() => {
      result.current.email.value = "form@test.com";
      result.current.passport.number.value = "XY999";
    });

    const values = store.getValues();
    expect(values.email).toBe("form@test.com");
    expect(values.passport.number).toBe("XY999");
  });

  it("один и тот же прокси на каждом ре-рендере (referential equality)", () => {
    const store = createProxyStore({ config: makeConfig() });
    const proxies: any[] = [];

    const { rerender } = renderHook(() => {
      const form = useForm(store);
      proxies.push(form);
      return form;
    });

    rerender();

    expect(proxies[0]).toBe(proxies[1]);
  });
});
