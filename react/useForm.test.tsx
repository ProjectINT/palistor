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
          <span data-testid="email-error">{form.email.isInvalid ? "Error" : "none"}</span>
          <button onClick={() => { form.email.value = "hello@test.com"; }}>
            Set Email
          </button>
        </div>
      );
    }

    render(<TestComponent />);

    // revalidate=false по умолчанию → ошибки скрыты до submit
    expect(screen.getByTestId("email-value").textContent).toBe("");
    expect(screen.getByTestId("email-error").textContent).toBe("none");

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

// ─── Tracking proxy: selective re-render ─────────────────────────────────────

describe("useForm tracking (selective re-render)", () => {
  it("НЕ перерендерит компонент, который не читает изменённое поле", () => {
    const store = createProxyStore({ config: makeConfig() });
    const emailRender = vi.fn();
    const paymentRender = vi.fn();

    function EmailDisplay() {
      emailRender();
      const form = useForm(store);
      return <span data-testid="email">{form.email.value}</span>;
    }

    function PaymentDisplay() {
      paymentRender();
      const form = useForm(store);
      return <span data-testid="payment">{form.paymentType.value}</span>;
    }

    render(
      <div>
        <EmailDisplay />
        <PaymentDisplay />
      </div>,
    );

    expect(emailRender).toHaveBeenCalledTimes(1);
    expect(paymentRender).toHaveBeenCalledTimes(1);

    // Меняем email → EmailDisplay должен перерендериться, PaymentDisplay — нет
    act(() => {
      store.proxy.email.value = "changed@test.com";
    });

    expect(emailRender).toHaveBeenCalledTimes(2);
    expect(paymentRender).toHaveBeenCalledTimes(1); // НЕ перерендерился!
    expect(screen.getByTestId("email").textContent).toBe("changed@test.com");
    expect(screen.getByTestId("payment").textContent).toBe("card");
  });

  it("перерендерит компонент только при изменении прочитанного поля", () => {
    const store = createProxyStore({ config: makeConfig() });
    const renderCount = vi.fn();

    function CardSection() {
      renderCount();
      const form = useForm(store);
      return (
        <div>
          <span data-testid="card-visible">
            {form.cardNumber.isVisible ? "yes" : "no"}
          </span>
        </div>
      );
    }

    render(<CardSection />);
    expect(renderCount).toHaveBeenCalledTimes(1);

    // Меняем email — CardSection не читает email → нет re-render
    act(() => {
      store.proxy.email.value = "test@test.com";
    });
    expect(renderCount).toHaveBeenCalledTimes(1);

    // Меняем paymentType → cardNumber.isVisible зависит от него → re-render
    act(() => {
      store.proxy.paymentType.value = "bank";
    });
    expect(renderCount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("card-visible").textContent).toBe("no");
  });

  it("tracking работает для вложенных полей (passport.number)", () => {
    const store = createProxyStore({ config: makeConfig() });
    const passportRender = vi.fn();
    const emailRender = vi.fn();

    function PassportNumber() {
      passportRender();
      const form = useForm(store);
      return (
        <span data-testid="passport-num">{form.passport.number.value}</span>
      );
    }

    function EmailField() {
      emailRender();
      const form = useForm(store);
      return <span data-testid="email-val">{form.email.value}</span>;
    }

    render(
      <div>
        <PassportNumber />
        <EmailField />
      </div>,
    );

    expect(passportRender).toHaveBeenCalledTimes(1);
    expect(emailRender).toHaveBeenCalledTimes(1);

    // Меняем passport.number → PassportNumber рендерится, EmailField — нет
    act(() => {
      store.proxy.passport.number.value = "AB123";
    });

    expect(passportRender).toHaveBeenCalledTimes(2);
    expect(emailRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("passport-num").textContent).toBe("AB123");
  });

  it("tracking через переданный проп (без useForm в дочернем)", () => {
    const store = createProxyStore({ config: makeConfig() });
    const parentRender = vi.fn();

    function Parent() {
      parentRender();
      const form = useForm(store);
      return (
        <div>
          <span data-testid="email-display">{form.email.value}</span>
        </div>
      );
    }

    render(<Parent />);
    expect(parentRender).toHaveBeenCalledTimes(1);

    // Меняем поле, которое Parent не читает
    act(() => {
      store.proxy.passport.number.value = "XY999";
    });

    expect(parentRender).toHaveBeenCalledTimes(1); // Не перерендерился
  });

  it("запись через tracking proxy работает корректно", () => {
    const store = createProxyStore({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    act(() => {
      result.current.email.value = "tracking@test.com";
    });

    expect(result.current.email.value).toBe("tracking@test.com");
    expect(store.getValues().email).toBe("tracking@test.com");
  });

  it("tracking proxy стабилен (referential equality между рендерами)", () => {
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

  it("три компонента: меняется одно поле, рендерится только один", () => {
    const store = createProxyStore({ config: makeConfig() });
    const renderA = vi.fn();
    const renderB = vi.fn();
    const renderC = vi.fn();

    function A() {
      renderA();
      const form = useForm(store);
      return <span>{form.email.value}</span>;
    }
    function B() {
      renderB();
      const form = useForm(store);
      return <span>{form.paymentType.value}</span>;
    }
    function C() {
      renderC();
      const form = useForm(store);
      return <span>{form.passport.number.value}</span>;
    }

    render(
      <div>
        <A />
        <B />
        <C />
      </div>,
    );

    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(renderC).toHaveBeenCalledTimes(1);

    act(() => {
      store.proxy.passport.number.value = "ONLY_C";
    });

    // Только C перерендерился
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(renderC).toHaveBeenCalledTimes(2);
  });

  it("один useForm на верхнем уровне + пропсы вниз — все перерендериваются", () => {
    const store = createProxyStore({ config: makeConfig() });
    const renderParent = vi.fn();
    const renderA = vi.fn();
    const renderB = vi.fn();
    const renderC = vi.fn();

    function A({ form }: { form: any }) {
      renderA();
      return <span data-testid="a">{form.email.value}</span>;
    }
    function B({ form }: { form: any }) {
      renderB();
      return <span data-testid="b">{form.paymentType.value}</span>;
    }
    function C({ form }: { form: any }) {
      renderC();
      return <span data-testid="c">{form.passport.number.value}</span>;
    }

    function Parent() {
      renderParent();
      const form = useForm(store);
      return (
        <div>
          <A form={form} />
          <B form={form} />
          <C form={form} />
        </div>
      );
    }

    render(<Parent />);

    expect(renderParent).toHaveBeenCalledTimes(1);
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(renderC).toHaveBeenCalledTimes(1);

    // Меняем только passport.number
    act(() => {
      store.proxy.passport.number.value = "ONLY_C";
    });

    // Parent перерендерился, потому что passport.number в его tracked set
    // → все дети тоже перерендерились (каскадный re-render)
    expect(renderParent).toHaveBeenCalledTimes(2);
    expect(renderA).toHaveBeenCalledTimes(2);
    expect(renderB).toHaveBeenCalledTimes(2);
    expect(renderC).toHaveBeenCalledTimes(2);

    // Но значения корректны
    expect(screen.getByTestId("a").textContent).toBe("");
    expect(screen.getByTestId("b").textContent).toBe("card");
    expect(screen.getByTestId("c").textContent).toBe("ONLY_C");
  });

  it("useForm(subtree) — дочерние компоненты с независимой подпиской", () => {
    const store = createProxyStore({ config: makeConfig() });
    const renderParent = vi.fn();
    const renderA = vi.fn();
    const renderB = vi.fn();
    const renderC = vi.fn();

    function A({ section }: { section: any }) {
      renderA();
      const email = useForm(section) as any; // независимый tracking
      return <span data-testid="a">{email.value}</span>;
    }
    function B({ section }: { section: any }) {
      renderB();
      const payment = useForm(section) as any;
      return <span data-testid="b">{payment.value}</span>;
    }
    function C({ section }: { section: any }) {
      renderC();
      const passport = useForm(section) as any;
      return <span data-testid="c">{passport.number.value}</span>;
    }

    function Parent() {
      renderParent();
      const form = useForm(store);
      return (
        <div>
          <A section={form.email} />
          <B section={form.paymentType} />
          <C section={form.passport} />
        </div>
      );
    }

    render(<Parent />);

    expect(renderParent).toHaveBeenCalledTimes(1);
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(renderC).toHaveBeenCalledTimes(1);

    // Меняем только passport.number → только C перерендерится
    act(() => {
      store.proxy.passport.number.value = "ONLY_C";
    });

    // Parent НЕ перерендерился — он не читал passport.number
    expect(renderParent).toHaveBeenCalledTimes(1);
    // A и B тоже нет — у них свои tracked sets
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    // Только C!
    expect(renderC).toHaveBeenCalledTimes(2);

    expect(screen.getByTestId("c").textContent).toBe("ONLY_C");
  });

  it("useForm(subtree) — запись через поддерево работает", () => {
    const store = createProxyStore({ config: makeConfig() });

    function EmailEditor({ emailProxy }: { emailProxy: any }) {
      const email = useForm(emailProxy) as any;
      return (
        <div>
          <span data-testid="email-val">{email.value}</span>
          <button onClick={() => { email.value = "subtree@test.com"; }}>
            Set
          </button>
        </div>
      );
    }

    function App() {
      const form = useForm(store);
      return <EmailEditor emailProxy={form.email} />;
    }

    render(<App />);
    expect(screen.getByTestId("email-val").textContent).toBe("");

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByTestId("email-val").textContent).toBe("subtree@test.com");
    expect(store.getValues().email).toBe("subtree@test.com");
  });

  it("onValueChange работает через tracking proxy", () => {
    const store = createProxyStore({ config: makeConfig() });

    function TestComponent() {
      const form = useForm(store);
      return (
        <div>
          <span data-testid="email-value">{form.email.value}</span>
          <button onClick={() => form.email.onValueChange("on-change@test.com")}>
            Set Email
          </button>
        </div>
      );
    }

    render(<TestComponent />);
    expect(screen.getByTestId("email-value").textContent).toBe("");

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByTestId("email-value").textContent).toBe("on-change@test.com");
    expect(store.getValues().email).toBe("on-change@test.com");
  });

  it("onValueChange возвращает стабильную ссылку через tracking proxy", () => {
    const store = createProxyStore({ config: makeConfig() });
    const fns: any[] = [];

    const { rerender } = renderHook(() => {
      const form = useForm(store);
      fns.push(form.email.onValueChange);
      return form;
    });

    rerender();

    expect(fns[0]).toBe(fns[1]);
  });
});
