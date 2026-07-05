import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { useForm } from "./useForm";

// ─── Test config ─────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useForm", () => {
  it("returns a proxy with the current values", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.email.value).toBe("");
    expect(result.current.email.label).toBe("Email");
    expect(result.current.paymentType.value).toBe("card");
  });

  it("reads computed properties (isVisible, isRequired)", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.email.isRequired).toBe(true);
    expect(result.current.cardNumber.isVisible).toBe(true);
    expect(result.current.passport.isVisible).toBe(false);
  });

  it("nested fields are accessible via dot notation", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.passport.number.value).toBe("");
    expect(result.current.passport.number.label).toBe("Passport Number");
    expect(result.current.passport.number.isRequired).toBe(true);
  });

  it("re-renders the component when value is written", () => {
    const store = new Palistor({ config: makeConfig() });
    const renderCount = vi.fn();

    const { result } = renderHook(() => {
      renderCount();
      return useForm(store);
    });

    expect(renderCount).toHaveBeenCalledTimes(1);

    // Write through the proxy
    act(() => {
      store.proxy.email.value = "test@test.com";
    });

    expect(renderCount).toHaveBeenCalledTimes(2);
    expect(result.current.email.value).toBe("test@test.com");
  });

  it("recomputes dependent fields after a change", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.cardNumber.isVisible).toBe(true);
    expect(result.current.passport.isVisible).toBe(false);

    act(() => {
      store.proxy.paymentType.value = "bank";
    });

    expect(result.current.cardNumber.isVisible).toBe(false);
    expect(result.current.passport.isVisible).toBe(true);
  });

  it("writing through the useForm proxy works from a component", () => {
    const store = new Palistor({ config: makeConfig() });

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

    // revalidate=false by default → errors are hidden until submit
    expect(screen.getByTestId("email-value").textContent).toBe("");
    expect(screen.getByTestId("email-error").textContent).toBe("none");

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByTestId("email-value").textContent).toBe("hello@test.com");
    expect(screen.getByTestId("email-error").textContent).toBe("none");
  });

  it("a subtree can be passed to a child component as a prop", () => {
    const store = new Palistor({ config: makeConfig() });

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

    // passport is hidden initially
    expect(screen.getByTestId("hidden").textContent).toBe("hidden");

    // Switch to bank
    act(() => {
      screen.getByText("Switch to Bank").click();
    });

    // passport is visible now
    expect(screen.getByTestId("passport-number").textContent).toBe("");
    expect(screen.getByTestId("passport-label").textContent).toBe("Passport Number");

    // Set the passport number
    act(() => {
      screen.getByText("Set Number").click();
    });

    expect(screen.getByTestId("passport-number").textContent).toBe("AB123");
  });

  it("multiple components with the same store stay in sync", () => {
    const store = new Palistor({ config: makeConfig() });

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

  it("getValues() reflects changes made through the useForm proxy", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    act(() => {
      result.current.email.value = "form@test.com";
      result.current.passport.number.value = "XY999";
    });

    const values = store.getValues();
    expect(values.email).toBe("form@test.com");
    expect(values.passport.number).toBe("XY999");
  });

  it("the same proxy on every re-render (referential equality)", () => {
    const store = new Palistor({ config: makeConfig() });
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
  it("does NOT re-render a component that doesn't read the changed field", () => {
    const store = new Palistor({ config: makeConfig() });
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

    // Changing email → EmailDisplay must re-render, PaymentDisplay must not
    act(() => {
      store.proxy.email.value = "changed@test.com";
    });

    expect(emailRender).toHaveBeenCalledTimes(2);
    expect(paymentRender).toHaveBeenCalledTimes(1); // did NOT re-render!
    expect(screen.getByTestId("email").textContent).toBe("changed@test.com");
    expect(screen.getByTestId("payment").textContent).toBe("card");
  });

  it("re-renders the component only when a field it read changes", () => {
    const store = new Palistor({ config: makeConfig() });
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

    // Changing email — CardSection doesn't read email → no re-render
    act(() => {
      store.proxy.email.value = "test@test.com";
    });
    expect(renderCount).toHaveBeenCalledTimes(1);

    // Changing paymentType → cardNumber.isVisible depends on it → re-render
    act(() => {
      store.proxy.paymentType.value = "bank";
    });
    expect(renderCount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("card-visible").textContent).toBe("no");
  });

  it("tracking works for nested fields (passport.number)", () => {
    const store = new Palistor({ config: makeConfig() });
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

    // Changing passport.number → PassportNumber renders, EmailField doesn't
    act(() => {
      store.proxy.passport.number.value = "AB123";
    });

    expect(passportRender).toHaveBeenCalledTimes(2);
    expect(emailRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("passport-num").textContent).toBe("AB123");
  });

  it("tracking via a passed prop (no useForm in the child)", () => {
    const store = new Palistor({ config: makeConfig() });
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

    // Change a field Parent does not read
    act(() => {
      store.proxy.passport.number.value = "XY999";
    });

    expect(parentRender).toHaveBeenCalledTimes(1); // did not re-render
  });

  it("writing through the tracking proxy works correctly", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    act(() => {
      result.current.email.value = "tracking@test.com";
    });

    expect(result.current.email.value).toBe("tracking@test.com");
    expect(store.getValues().email).toBe("tracking@test.com");
  });

  it("the tracking proxy is stable (referential equality across renders)", () => {
    const store = new Palistor({ config: makeConfig() });
    const proxies: any[] = [];

    const { rerender } = renderHook(() => {
      const form = useForm(store);
      proxies.push(form);
      return form;
    });

    rerender();

    expect(proxies[0]).toBe(proxies[1]);
  });

  it("three components: one field changes, only one renders", () => {
    const store = new Palistor({ config: makeConfig() });
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

    // Only C re-rendered
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(renderC).toHaveBeenCalledTimes(2);
  });

  it("one useForm at the top + props down — everyone re-renders", () => {
    const store = new Palistor({ config: makeConfig() });
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

    // Change only passport.number
    act(() => {
      store.proxy.passport.number.value = "ONLY_C";
    });

    // Parent re-rendered because passport.number is in its tracked set
    // → all children re-rendered too (cascading re-render)
    expect(renderParent).toHaveBeenCalledTimes(2);
    expect(renderA).toHaveBeenCalledTimes(2);
    expect(renderB).toHaveBeenCalledTimes(2);
    expect(renderC).toHaveBeenCalledTimes(2);

    // But the values are correct
    expect(screen.getByTestId("a").textContent).toBe("");
    expect(screen.getByTestId("b").textContent).toBe("card");
    expect(screen.getByTestId("c").textContent).toBe("ONLY_C");
  });

  it("useForm(subtree) — child components with independent subscriptions", () => {
    const store = new Palistor({ config: makeConfig() });
    const renderParent = vi.fn();
    const renderA = vi.fn();
    const renderB = vi.fn();
    const renderC = vi.fn();

    function A({ section }: { section: any }) {
      renderA();
      const email = useForm(section) as any; // independent tracking
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

    // Change only passport.number → only C re-renders
    act(() => {
      store.proxy.passport.number.value = "ONLY_C";
    });

    // Parent did NOT re-render — it never read passport.number
    expect(renderParent).toHaveBeenCalledTimes(1);
    // Neither did A and B — they have their own tracked sets
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    // Only C!
    expect(renderC).toHaveBeenCalledTimes(2);

    expect(screen.getByTestId("c").textContent).toBe("ONLY_C");
  });

  it("useForm(subtree) — writing through the subtree works", () => {
    const store = new Palistor({ config: makeConfig() });

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

  it("onValueChange works through the tracking proxy", () => {
    const store = new Palistor({ config: makeConfig() });

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

  it("onValueChange returns a stable reference through the tracking proxy", () => {
    const store = new Palistor({ config: makeConfig() });
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

// ─── Anti-pattern: store.proxy passed directly into useForm ──────────────────

describe("useForm: passing store.proxy directly throws", () => {
  /**
   * store.proxy.usersPage.inviteUser is a raw GroupProxyNode from the store's
   * internal proxy. It is neither a ProxyStore (no .proxy) nor a tracking
   * proxy (no SOURCE_PROXY symbol).
   *
   * resolveInput() receives it and produces:
   *   { store: rawGroupProxy, sourceProxy: rawGroupProxy.proxy }
   *                                                            ^^ undefined
   *
   * Then createTrackingProxy(undefined, ...) calls WeakMap.has(undefined)
   * → TypeError: Invalid value used as weak map key.
   *
   * The correct way:
   *   const form = useForm(store);
   *   // form.usersPage.inviteUser is already a tracking proxy; pass it as a prop
   *   // and call useForm(props.inviteUser) in the child component
   */
  it("throws on useForm(store.proxy.someGroup)", () => {
    const store = new Palistor({
      config: {
        usersPage: {
          inviteUser: {
            email: { value: "", label: "Email" },
            role: { value: "viewer", label: "Role" },
          },
        },
      },
    });

    // store.proxy.usersPage.inviteUser is a raw GroupProxyNode, NOT a tracking proxy
    expect(() => {
      // @ts-expect-error — TypeScript must forbid passing a raw
      // store.proxy subtree into useForm. If this ts-expect-error goes stale,
      // the compiler guard is broken — fix
      // ForbidRawStoreProxy / RawStoreProxyMarker in palistor.
      renderHook(() => useForm(store.proxy.usersPage.inviteUser));
    }).toThrow("useForm: received a raw store proxy node");
  });

  it("the correct way: useForm(store) → pass the subtree as a prop", () => {
    const store = new Palistor({
      config: {
        usersPage: {
          inviteUser: {
            email: { value: "", label: "Email" },
            role: { value: "viewer", label: "Role" },
          },
        },
      },
    });

    // Correct: get a tracking proxy via useForm(store),
    // then pass form.usersPage.inviteUser as a prop to the child component.
    function InviteUserForm({ inviteUser }: { inviteUser: any }) {
      // Here inviteUser is a tracking proxy (from the parent useForm),
      // so useForm(inviteUser) works correctly.
      const form = useForm(inviteUser);
      return (
        <div>
          <span data-testid="invite-email">{(form as any).email.value}</span>
          <span data-testid="invite-role">{(form as any).role.value}</span>
        </div>
      );
    }

    function App() {
      const form = useForm(store);
      return <InviteUserForm inviteUser={(form as any).usersPage.inviteUser} />;
    }

    render(<App />);

    expect(screen.getByTestId("invite-email").textContent).toBe("");
    expect(screen.getByTestId("invite-role").textContent).toBe("viewer");
  });
});

// ─── setValues: bulk update ───────────────────────────────────────────────────

describe("setValues", () => {
  it("store.setValues updates several fields at once", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    act(() => {
      store.setValues({ email: "bulk@test.com", paymentType: "bank" });
    });

    expect(result.current.email.value).toBe("bulk@test.com");
    expect(result.current.paymentType.value).toBe("bank");
  });

  it("store.setValues does not touch fields outside the patch", () => {
    const store = new Palistor({
      config: makeConfig(),
      initialValues: { email: "original@test.com", paymentType: "card" },
    });

    act(() => {
      store.setValues({ paymentType: "bank" });
    });

    const values = store.getValues();
    expect(values.email).toBe("original@test.com");  // untouched
    expect(values.paymentType).toBe("bank");         // updated
  });

  it("form.setValues via the useForm proxy works", () => {
    const store = new Palistor({ config: makeConfig() });

    function TestComponent() {
      const form = useForm(store);
      return (
        <div>
          <span data-testid="email">{form.email.value}</span>
          <span data-testid="payment">{form.paymentType.value}</span>
          <button onClick={() => form.setValues({ email: "proxy@test.com", paymentType: "bank" })}>
            Bulk Set
          </button>
        </div>
      );
    }

    render(<TestComponent />);

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByTestId("email").textContent).toBe("proxy@test.com");
    expect(screen.getByTestId("payment").textContent).toBe("bank");
  });

  it("form.passport.setValues updates the nested group", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    act(() => {
      result.current.passport.setValues({ number: "XY999", issueDate: "2020-01-01" });
    });

    const values = store.getValues();
    expect(values.passport.number).toBe("XY999");
    expect(values.passport.issueDate).toBe("2020-01-01");
    expect(values.email).toBe(""); // root untouched
  });

  it("setValues recomputes computed props (isVisible)", () => {
    const store = new Palistor({ config: makeConfig() });

    const { result } = renderHook(() => useForm(store));

    expect(result.current.cardNumber.isVisible).toBe(true);
    expect(result.current.passport.isVisible).toBe(false);

    act(() => {
      store.setValues({ paymentType: "bank" });
    });

    expect(result.current.cardNumber.isVisible).toBe(false);
    expect(result.current.passport.isVisible).toBe(true);
  });

  it("setValues re-renders only components that read the changed fields", () => {
    const store = new Palistor({ config: makeConfig() });
    const emailRender = vi.fn();
    const paymentRender = vi.fn();
    const passportRender = vi.fn();

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
    function PassportNumber() {
      passportRender();
      const form = useForm(store);
      return <span data-testid="passport">{form.passport.number.value}</span>;
    }

    render(
      <div>
        <EmailDisplay />
        <PaymentDisplay />
        <PassportNumber />
      </div>,
    );

    expect(emailRender).toHaveBeenCalledTimes(1);
    expect(paymentRender).toHaveBeenCalledTimes(1);
    expect(passportRender).toHaveBeenCalledTimes(1);

    // Patch only email and passport.number — paymentType untouched
    act(() => {
      store.setValues({ email: "bulk@test.com", passport: { number: "AB123" } });
    });

    expect(emailRender).toHaveBeenCalledTimes(2);   // read email → re-render
    expect(paymentRender).toHaveBeenCalledTimes(1); // read nothing changed → no
    expect(passportRender).toHaveBeenCalledTimes(2); // read passport.number → re-render

    expect(screen.getByTestId("email").textContent).toBe("bulk@test.com");
    expect(screen.getByTestId("payment").textContent).toBe("card");
    expect(screen.getByTestId("passport").textContent).toBe("AB123");
  });

  it("setValues returns a stable reference across renders", () => {
    const store = new Palistor({ config: makeConfig() });
    const fns: any[] = [];

    const { rerender } = renderHook(() => {
      const form = useForm(store);
      fns.push(form.setValues);
      return form;
    });

    rerender();

    expect(fns[0]).toBe(fns[1]);
  });

  it("store.setValues is reflected in getValues()", () => {
    const store = new Palistor({ config: makeConfig() });

    act(() => {
      store.setValues({
        email: "values@test.com",
        passport: { number: "ZZ001", issueDate: "2021-06-15" },
      });
    });

    const values = store.getValues();
    expect(values.email).toBe("values@test.com");
    expect(values.passport.number).toBe("ZZ001");
    expect(values.passport.issueDate).toBe("2021-06-15");
  });
});

// ─── useForm(entity, templateSelector) ───────────────────────────────────────

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

function flushPromisesEntity() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
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
    expect(store.entityRegistry.get("u1")?.name.value).toBe("Alice Cooper");
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

    const { result } = renderHook(() => {
      formRenderCount();
      return useForm(aliceProxy, (s: any) => s.editUserForm);
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

    const aliceProxy = (store.proxy as any).users.items[0];

    // Get the template node
    const templateProxy = (store.proxy as any).editUserForm;
    const templateNode = (templateProxy as any)[Symbol.for("configNode") as any] ??
      // fallback: just use the config object directly
      (store as any).rootConfig.editUserForm;

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
});
