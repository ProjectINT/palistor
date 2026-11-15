import type { ComponentType } from "react";
import { expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Checks } from "../harness";

/** What task.md asks `profileForm.tsx` to export. */
export interface ProfileModule {
  profileStore: {
    proxy: Record<string, Record<string, unknown>>;
    getValues(): Record<string, unknown>;
  };
  ProfileForm: ComponentType;
}

/** Calls recorded by the `api.ts` stub. */
function saved(): Array<Record<string, unknown>> {
  return (globalThis as { __savedProfiles?: Array<Record<string, unknown>> }).__savedProfiles!;
}

/** Prop names the `ui/` stubs forwarded to their <input>. */
function forwarded(): string[] {
  return (globalThis as { __forwardedProps?: string[] }).__forwardedProps!;
}

function mount(mod: ProfileModule) {
  (globalThis as { __savedProfiles?: unknown[] }).__savedProfiles = [];
  (globalThis as { __forwardedProps?: string[] }).__forwardedProps = [];
  return render(<mod.ProfileForm />);
}

/** Long enough for the async submit to settle, short enough for the checks a mistake must fail. */
const soon = { timeout: 400 };

const email = () => screen.getByLabelText(/^Email/) as HTMLInputElement;
const nickname = () => screen.getByLabelText(/^Nickname/) as HTMLInputElement;
const company = () => screen.queryByLabelText(/^Company/) as HTMLInputElement | null;
const hasCompany = () => screen.getByLabelText(/^I represent a company/) as HTMLInputElement;
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

/** The library's own names of the props the design system calls differently. */
const LIBRARY_NAMES = ["isRequired", "isDisabled", "isReadOnly", "isInvalid", "errorMessage"];

/**
 * Field props that are not attributes of an <input>, under the library's names
 * and under the design system's. A UI kit forwards what it does not know to the
 * DOM, where React reports each of these as an unknown prop.
 */
const NOT_INPUT_ATTRIBUTES = [
  "isVisible", "onValueChange", "label", "description", "helpText", "helperText", "error",
  ...LIBRARY_NAMES, "dirty", "loading", "submitting", "submit",
];

export const checks: Checks<ProfileModule> = {
  "the store speaks the design system's vocabulary": (mod) => {
    const { proxy } = mod.profileStore;
    expect(proxy.email.required).toBe(true);
    expect(proxy.email.disabled).toBe(false);
    expect(proxy.nickname.readOnly).toBe(true);
    expect(proxy.nickname.required).toBe(false);

    const spread = Object.keys({ ...proxy.email });
    expect(spread).toEqual(expect.arrayContaining(["required", "disabled", "readOnly", "error", "helperText"]));
    for (const name of LIBRARY_NAMES) expect(spread).not.toContain(name);
  },

  "fields render through the design system with their flags and hints": (mod) => {
    mount(mod);
    expect(email().required).toBe(true);
    expect(email().value).toBe("");
    expect(nickname().value).toBe("guest_42");
    expect(nickname().readOnly).toBe(true);
    expect(hasCompany().checked).toBe(false);
    expect(screen.getByText("We never share it")).toBeTruthy();
  },

  "typing reaches the store": (mod) => {
    mount(mod);
    type(email(), "ann@example.com");
    expect(mod.profileStore.getValues().email).toBe("ann@example.com");
    expect(email().value).toBe("ann@example.com");

    fireEvent.click(hasCompany());
    expect(mod.profileStore.getValues().hasCompany).toBe(true);
    expect(hasCompany().checked).toBe(true);
  },

  "a hidden field leaves nothing in the DOM": (mod) => {
    mount(mod);
    expect(company()).toBeNull();
    fireEvent.click(hasCompany());
    expect(company()).not.toBeNull();
    fireEvent.click(hasCompany());
    expect(company()).toBeNull();
  },

  "nothing but real input attributes reaches the DOM": (mod) => {
    const { container } = mount(mod);
    fireEvent.click(hasCompany()); // every field on screen

    const leaked = [...new Set(forwarded())].filter((name) => NOT_INPUT_ATTRIBUTES.includes(name));
    expect(leaked, "props the design system forwarded to an <input>").toEqual([]);

    for (const input of container.querySelectorAll("input")) {
      for (const name of NOT_INPUT_ATTRIBUTES) {
        expect(input.hasAttribute(name.toLowerCase()), `<input> must not get "${name}"`).toBe(false);
      }
    }
  },

  "an invalid email shows its message in place of the hint and nothing is saved": async (mod) => {
    mount(mod);
    type(email(), "not-an-email");
    expect(email().getAttribute("aria-invalid")).toBeNull();
    save();
    await waitFor(() => expect(email().getAttribute("aria-invalid")).toBe("true"), soon);
    expect(screen.getByText("Enter a valid email")).toBeTruthy();
    expect(screen.queryByText("We never share it")).toBeNull();
    expect(saved()).toHaveLength(0);

    type(email(), "ann@example.com");
    await waitFor(() => expect(email().getAttribute("aria-invalid")).toBeNull(), soon);
    expect(screen.getByText("We never share it")).toBeTruthy();
  },

  "Save sends the form values": async (mod) => {
    mount(mod);
    type(email(), "ann@example.com");
    save();
    await waitFor(() => expect(saved()).toHaveLength(1), soon);
    expect(saved()[0]).toEqual({ email: "ann@example.com", nickname: "guest_42", hasCompany: false, company: "" });
  },

  "the company is required only while it is shown": async (mod) => {
    mount(mod);
    type(email(), "ann@example.com");
    fireEvent.click(hasCompany());
    save();
    await waitFor(() => expect(company()?.getAttribute("aria-invalid")).toBe("true"), soon);
    expect(saved()).toHaveLength(0);

    type(company()!, "Acme");
    save();
    await waitFor(() => expect(saved()).toHaveLength(1), soon);
    expect(saved()[0]).toMatchObject({ hasCompany: true, company: "Acme" });
  },
};
