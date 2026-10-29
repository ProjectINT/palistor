/**
 * Contract: the public surface and the README quick start.
 *
 * Runs in both vitest projects: `store` proves the test itself is right,
 * `cube` shows parity. Imports only from "@impl" (see vitest.config.ts).
 */

import { describe, it, expect } from "vitest";
import { act, render } from "@testing-library/react";
import * as impl from "@impl";
import { Palistor, useForm } from "@impl";

const paymentConfig = () => ({
  paymentType: { value: "card", label: "Payment method" },
  cardNumber: {
    value: "",
    label: "Card number",
    isVisible: (v: any) => v.paymentType === "card",
    isRequired: (v: any) => v.paymentType === "card",
    validate: (value: string, v: any) =>
      v.paymentType === "card" && value.length < 16 ? "Enter 16 digits" : undefined,
  },
  passport: {
    isVisible: (v: any) => v.paymentType === "bank",
    number: { value: "", label: "Passport number", isRequired: true },
    issueDate: { value: "", label: "Issue date" },
  },
});

describe("public surface", () => {
  it("exports the runtime names of the root entry", () => {
    expect(Object.keys(impl).sort()).toEqual([
      "Palistor",
      "defineFieldMapping",
      "defineFlow",
      "defineList",
      "defineStep",
      "localStorageDriver",
      "sessionStorageDriver",
      "useForm",
      "useNotifier",
      "usePersist",
      "useStoreContext",
      "useTranslator",
    ]);
  });
});

describe("README quick start", () => {
  it("computed visibility follows a write", () => {
    const store = new Palistor({ config: paymentConfig() as any });
    const form = store.proxy as any;

    expect(form.cardNumber.isVisible).toBe(true);
    expect(form.passport.isVisible).toBe(false);

    form.paymentType.value = "bank";

    expect(form.cardNumber.isVisible).toBe(false);
    expect(form.passport.isVisible).toBe(true);
  });

  it("getValues returns a plain snapshot of the tree", () => {
    const store = new Palistor({ config: paymentConfig() as any });
    (store.proxy as any).passport.number.value = "AB1234";

    expect(store.getValues()).toEqual({
      paymentType: "card",
      cardNumber: "",
      passport: { number: "AB1234", issueDate: "" },
    });
  });

  it("submit validates hidden fields too (only hidden flow steps are exempt)", async () => {
    const store = new Palistor({ config: paymentConfig() as any });
    const form = store.proxy as any;

    const failed = await store.submit();
    expect(failed.success).toBe(false);
    expect(failed.success === false && failed.errors.map((e) => e.path)).toEqual([
      "cardNumber",
      "passport.number", // passport is hidden while paymentType is "card"
    ]);

    form.cardNumber.value = "4242424242424242";
    form.passport.number.value = "AB1234";
    expect((await store.submit()).success).toBe(true);
  });

  it("useForm re-renders the component on a write it read", () => {
    const store = new Palistor({ config: paymentConfig() as any });
    let renders = 0;

    function Payment() {
      const form = useForm(store) as any;
      renders++;
      return <span data-testid="card">{form.cardNumber.isVisible ? "card" : "no card"}</span>;
    }

    const { getByTestId } = render(<Payment />);
    expect(getByTestId("card").textContent).toBe("card");
    const before = renders;

    act(() => { (store.proxy as any).paymentType.value = "bank"; });

    expect(getByTestId("card").textContent).toBe("no card");
    expect(renders).toBeGreaterThan(before);
  });
});
