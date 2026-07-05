import { describe, it, expect } from "vitest";
import { normalizeConfig } from "./normalizeConfig";
import { defineFieldMapping } from "./defineFieldMapping";
import { defineList } from "./defineList";
import type { FieldMapping } from "./store/types";

/** Builds the reverse map the same way the Palistor constructor does. */
function e2i(fwd: FieldMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const internal in fwd) {
    const external = fwd[internal as keyof FieldMapping];
    if (external !== undefined) out[external] = internal;
  }
  return out;
}

const fwd = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

describe("normalizeConfig", () => {
  it("an empty map → returns the original object without a copy (zero overhead)", () => {
    const config = { email: { value: "", isRequired: true } };
    const result = normalizeConfig(config, {}, {});
    expect(result).toBe(config); // same reference
  });

  it("renames external config keys to internal ones", () => {
    const config = {
      email: { value: "", label: "Email", required: true, disabled: false, helpText: "hi" },
    };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.email).toEqual({
      value: "",
      label: "Email",
      isRequired: true,
      isDisabled: false,
      description: "hi",
    });
  });

  it("does not mutate the original tree", () => {
    const config = { email: { value: "", required: true } };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect((config.email as any).required).toBe(true);
    expect((config.email as any).isRequired).toBeUndefined();
    expect(result.email.isRequired).toBe(true);
    expect(result).not.toBe(config);
  });

  it("recurses into nested groups", () => {
    const config = {
      passport: {
        number: { value: "", required: true },
        issue: { value: "", disabled: true },
      },
    };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.passport.number).toEqual({ value: "", isRequired: true });
    expect(result.passport.issue).toEqual({ value: "", isDisabled: true });
  });

  it("normalizes a list node's template (defineList and the array form)", () => {
    const typed = defineList<{ id: string; name: string }>({
      template: {
        id: { value: "" },
        name: { value: "", required: true } as any,
      },
      resolve: { resolver: async () => [] },
    });
    const config = { users: typed, products: [{ title: { value: "", disabled: true } }] };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    // defineList: [template, {resolve}]
    expect(result.users[0].name).toEqual({ value: "", isRequired: true });
    expect(result.users[1]).toHaveProperty("resolve");
    // the array form
    expect(result.products[0].title).toEqual({ value: "", isDisabled: true });
  });

  it("service keys (validate/componentProps/resolve) are not recursed into or touched", () => {
    const validate = (v: string) => (v ? undefined : "req");
    const componentProps = { size: "lg" };
    const config = { email: { value: "", required: true, validate, componentProps } };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.email.validate).toBe(validate);
    expect(result.email.componentProps).toBe(componentProps); // same reference
    expect(result.email.isRequired).toBe(true);
  });

  it("dependencies (an array) in a service key is not mistaken for a list node", () => {
    const config = { city: { value: "", dependencies: ["country"] } };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.city.dependencies).toEqual(["country"]);
  });

  it("renaming value → leaf detection doesn't break (value is present)", () => {
    const vfwd = defineFieldMapping({ value: "val" });
    const config = { email: { val: "x", label: "Email" } };
    const result = normalizeConfig(config, e2i(vfwd), vfwd) as any;
    expect(result.email).toEqual({ value: "x", label: "Email" });
    expect("value" in result.email).toBe(true);
  });

  it("strict: the internal name of an actively remapped config key → throws", () => {
    const config = { email: { value: "", isRequired: true } };
    expect(() => normalizeConfig(config, e2i(fwd), fwd)).toThrow(
      /write "required" instead of internal "isRequired"/,
    );
  });

  it("strict: a computed key (error/helperText) in the config → throws", () => {
    const config = { email: { value: "", error: true } };
    expect(() => normalizeConfig(config, e2i(fwd), fwd)).toThrow(/computed/);
  });

  it("output-only keys NOT written in the config don't interfere (a dirty/loading map)", () => {
    const dfwd = defineFieldMapping({ dirty: "isDirty", loading: "isLoading" });
    const config = { email: { value: "", isRequired: true, description: "d" } };
    // isRequired/description are NOT remapped here (the map covers only dirty/
    // loading) → internal names stay valid, no error.
    const result = normalizeConfig(config, e2i(dfwd), dfwd) as any;
    expect(result.email).toEqual({ value: "", isRequired: true, description: "d" });
  });
});
