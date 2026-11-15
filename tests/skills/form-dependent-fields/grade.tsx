import type { ComponentType } from "react";
import { expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Checks } from "../harness";

/** What task.md asks `deliveryForm.tsx` to export. */
export interface DeliveryModule {
  deliveryStore: { getValues(): Record<string, unknown> };
  DeliveryForm: ComponentType;
}

/** Calls recorded by the `api.ts` stub. */
function placedOrders(): Array<Record<string, unknown>> {
  return (globalThis as { __placedOrders?: Array<Record<string, unknown>> }).__placedOrders!;
}

function mount(mod: DeliveryModule) {
  (globalThis as { __placedOrders?: unknown[] }).__placedOrders = [];
  render(<mod.DeliveryForm />);
}

const email = () => screen.getByLabelText(/^Email/) as HTMLInputElement;
const delivery = () => screen.getByLabelText(/^Delivery/) as HTMLSelectElement;
const address = () => screen.queryByLabelText(/^Address/) as HTMLInputElement | null;
const quantity = () => screen.getByLabelText(/^Quantity/) as HTMLInputElement;
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const placeOrder = () => fireEvent.click(screen.getByRole("button", { name: "Place order" }));
/** Long enough for the async submit to settle, short enough for the checks a mistake must fail. */
const soon = { timeout: 400 };

export const checks: Checks<DeliveryModule> = {
  "the address field appears only for courier delivery": (mod) => {
    mount(mod);
    expect(address()).toBeNull();
    type(delivery(), "courier");
    expect(address()).not.toBeNull();
    type(delivery(), "pickup");
    expect(address()).toBeNull();
  },

  "a hidden address does not block the order": async (mod) => {
    mount(mod);
    type(email(), "ann@example.com");
    placeOrder();
    await waitFor(() => expect(placedOrders()).toHaveLength(1), soon);
    expect(placedOrders()[0]).toMatchObject({ email: "ann@example.com", method: "pickup" });
  },

  "courier delivery without an address is rejected": async (mod) => {
    mount(mod);
    type(email(), "ann@example.com");
    type(delivery(), "courier");
    placeOrder();
    await waitFor(() => expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0), soon);
    expect(placedOrders()).toHaveLength(0);

    type(address()!, "1 Main St");
    placeOrder();
    await waitFor(() => expect(placedOrders()).toHaveLength(1), soon);
    expect(placedOrders()[0]).toMatchObject({ method: "courier", address: "1 Main St" });
  },

  "messages stay hidden until the first attempt, then an invalid form is not sent": async (mod) => {
    mount(mod);
    type(email(), "not-an-email");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    placeOrder();
    await waitFor(() => expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0), soon);
    expect(placedOrders()).toHaveLength(0);

    type(email(), "ann@example.com");
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0), soon);
  },

  "the email is stored trimmed and lower-cased": (mod) => {
    mount(mod);
    type(email(), "  Ann@Example.COM ");
    expect(mod.deliveryStore.getValues().email).toBe("ann@example.com");
  },

  "switching the delivery method clears the address": (mod) => {
    mount(mod);
    type(delivery(), "courier");
    type(address()!, "1 Main St");
    type(delivery(), "pickup");
    type(delivery(), "courier");
    expect(address()!.value).toBe("");
  },

  "quantity is stored as a number and drives the total": async (mod) => {
    mount(mod);
    expect(screen.getByTestId("total").textContent).toBe("12.5");
    type(quantity(), "3");
    expect(mod.deliveryStore.getValues().quantity).toBe(3);
    expect(screen.getByTestId("total").textContent).toBe("37.5");

    type(email(), "ann@example.com");
    placeOrder();
    await waitFor(() => expect(placedOrders()).toHaveLength(1), soon);
    expect(placedOrders()[0]).toMatchObject({ quantity: 3, total: 37.5 });
  },
};
