import type { ComponentType } from "react";
import { expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Checks } from "../harness";

/** What task.md asks `signupWizard.tsx` to export. */
export interface SignupModule {
  signupStore: { getValues(): Record<string, unknown> };
  SignupWizard: ComponentType;
}

/** Calls recorded by the `api.ts` stub. */
function signups(): Array<Record<string, unknown>> {
  return (globalThis as { __signups?: Array<Record<string, unknown>> }).__signups!;
}

function mount(mod: SignupModule) {
  (globalThis as { __signups?: unknown[] }).__signups = [];
  render(<mod.SignupWizard />);
}

/** Long enough for an async step submit to settle, short enough for the checks a mistake must fail. */
const soon = { timeout: 400 };

const fullName = () => screen.queryByLabelText(/^Full name/) as HTMLInputElement | null;
const email = () => screen.queryByLabelText(/^Email/) as HTMLInputElement | null;
const company = () => screen.queryByLabelText(/^Company name/) as HTMLInputElement | null;
const plan = (name: string) => screen.queryByRole("radio", { name }) as HTMLInputElement | null;
const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

/** Account step filled in and left: the plan step is on screen. */
async function passAccount() {
  type(fullName()!, "Ada Lovelace");
  type(email()!, "ada@example.com");
  press("Next");
  await waitFor(() => expect(plan("Free")).not.toBeNull(), soon);
}

/** Plan picked and the step left; resolves once the next screen (company or summary) is up. */
async function pickPlan(name: string) {
  fireEvent.click(plan(name)!);
  press("Next");
  await waitFor(() => expect(plan("Free")).toBeNull(), soon);
}

async function finish() {
  await waitFor(() => expect(button("Finish")).not.toBeNull(), soon);
  press("Finish");
  await screen.findByText("Signup complete", undefined, soon);
}

export const checks: Checks<SignupModule> = {
  "starts on the account step with Back disabled": (mod) => {
    mount(mod);
    expect(fullName()).not.toBeNull();
    expect(email()).not.toBeNull();
    expect(plan("Free")).toBeNull();
    expect(button("Back")!.disabled).toBe(true);
    expect(button("Finish")).toBeNull();
  },

  "Next does not leave an invalid account step": async (mod) => {
    mount(mod);
    press("Next");
    await waitFor(() => expect(fullName()?.getAttribute("aria-invalid")).toBe("true"), soon);
    expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0);
    expect(plan("Free")).toBeNull();

    type(fullName()!, "Ada Lovelace");
    type(email()!, "not-an-email");
    press("Next");
    await waitFor(() => expect(email()?.getAttribute("aria-invalid")).toBe("true"), soon);
    expect(plan("Free")).toBeNull();

    type(email()!, "ada@example.com");
    press("Next");
    await waitFor(() => expect(plan("Free")).not.toBeNull(), soon);
  },

  "a plan must be picked before moving on": async (mod) => {
    mount(mod);
    await passAccount();
    press("Next");
    await waitFor(() => expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0), soon);
    expect(plan("Free")).not.toBeNull();
    expect(button("Finish")).toBeNull();
  },

  "plans other than Enterprise skip the company step": async (mod) => {
    mount(mod);
    await passAccount();
    await pickPlan("Pro");
    await waitFor(() => expect(button("Finish")).not.toBeNull(), soon);
    expect(company()).toBeNull();
  },

  "Enterprise goes through the company step, which needs a name": async (mod) => {
    mount(mod);
    await passAccount();
    await pickPlan("Enterprise");
    await waitFor(() => expect(company()).not.toBeNull(), soon);
    expect(button("Finish")).toBeNull();

    press("Next");
    await waitFor(() => expect(company()?.getAttribute("aria-invalid")).toBe("true"), soon);
    expect(button("Finish")).toBeNull();

    type(company()!, "Acme");
    press("Next");
    await waitFor(() => expect(button("Finish")).not.toBeNull(), soon);
  },

  "Back returns to the step the customer came from": async (mod) => {
    mount(mod);
    await passAccount();
    await pickPlan("Free");
    await waitFor(() => expect(button("Finish")).not.toBeNull(), soon);

    press("Back");
    await waitFor(() => expect(plan("Free")).not.toBeNull(), soon);
    expect(plan("Free")!.checked).toBe(true);
    expect(company()).toBeNull();

    press("Back");
    await waitFor(() => expect(fullName()).not.toBeNull(), soon);
    expect(fullName()!.value).toBe("Ada Lovelace");
    expect(button("Back")!.disabled).toBe(true);
  },

  "Finish sends one payload and shows the confirmation": async (mod) => {
    mount(mod);
    await passAccount();
    await pickPlan("Pro");
    await finish();
    expect(signups()).toEqual([{ fullName: "Ada Lovelace", email: "ada@example.com", plan: "pro" }]);
    expect(button("Finish")).toBeNull();
  },

  "an Enterprise signup carries the company name": async (mod) => {
    mount(mod);
    await passAccount();
    await pickPlan("Enterprise");
    await waitFor(() => expect(company()).not.toBeNull(), soon);
    type(company()!, "Acme");
    press("Next");
    await finish();
    expect(signups()).toEqual([
      { fullName: "Ada Lovelace", email: "ada@example.com", plan: "enterprise", companyName: "Acme" },
    ]);
  },

  "a company entered for an abandoned Enterprise choice is not sent": async (mod) => {
    mount(mod);
    await passAccount();
    await pickPlan("Enterprise");
    await waitFor(() => expect(company()).not.toBeNull(), soon);
    type(company()!, "Acme");
    press("Next");
    await waitFor(() => expect(button("Finish")).not.toBeNull(), soon);

    press("Back"); // company
    await waitFor(() => expect(company()).not.toBeNull(), soon);
    press("Back"); // plan
    await waitFor(() => expect(plan("Pro")).not.toBeNull(), soon);
    await pickPlan("Pro");
    await finish();
    expect(signups()).toEqual([{ fullName: "Ada Lovelace", email: "ada@example.com", plan: "pro" }]);
  },
};
