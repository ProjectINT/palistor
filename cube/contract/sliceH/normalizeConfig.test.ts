/**
 * Config normalization under fieldMapping (Phase 2.6). Ported from
 * store/normalizeConfig.test.ts, which called store's internal
 * `normalizeConfig(config, externalToInternal, fieldMapping)`. Here the same
 * cases go through the public constructor: `normalized()` builds a store and
 * reads `store.rootConfig`, the config the store was built from (both
 * implementations keep the normalized tree there). Store marks every config
 * node it registers with `__kind` (its node-kind marker, invisible to user
 * code), so exact comparisons go through `plain()`, which drops it. The cases
 * and expectations are otherwise unchanged.
 */
import { describe, it, expect } from "vitest";
import { Palistor, defineFieldMapping, defineList, type FieldMapping } from "@impl";

/** A config node without store's `__kind` marker. */
function plain(node: object): Record<string, unknown> {
  const { __kind: _kind, ...rest } = node as Record<string, unknown>;
  return rest;
}

/** The tree the store was built from, after normalization. */
function normalized(config: object, fieldMapping: FieldMapping): any {
  return new Palistor({ config: config as any, fieldMapping: fieldMapping as any }).rootConfig;
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
    expect(normalized(config, {})).toBe(config); // same reference
    expect(new Palistor({ config }).rootConfig).toBe(config);
  });

  it("renames external config keys to internal ones", () => {
    const config = {
      email: { value: "", label: "Email", required: true, disabled: false, helpText: "hi" },
    };
    const result = normalized(config, fwd);
    expect(plain(result.email)).toEqual({
      value: "",
      label: "Email",
      isRequired: true,
      isDisabled: false,
      description: "hi",
    });
  });

  it("does not mutate the original tree", () => {
    const config = { email: { value: "", required: true } };
    const result = normalized(config, fwd);
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
    const result = normalized(config, fwd);
    expect(plain(result.passport.number)).toEqual({ value: "", isRequired: true });
    expect(plain(result.passport.issue)).toEqual({ value: "", isDisabled: true });
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
    const result = normalized(config, fwd);
    // defineList: [template, {resolve}]
    expect(plain(result.users[0].name)).toEqual({ value: "", isRequired: true });
    expect(result.users[1]).toHaveProperty("resolve");
    // the array form
    expect(plain(result.products[0].title)).toEqual({ value: "", isDisabled: true });
  });

  it("service keys (validate/componentProps/resolve) are not recursed into or touched", () => {
    const validate = (v: string) => (v ? undefined : "req");
    const componentProps = { size: "lg" };
    const config = { email: { value: "", required: true, validate, componentProps } };
    const result = normalized(config, fwd);
    expect(result.email.validate).toBe(validate);
    expect(result.email.componentProps).toBe(componentProps); // same reference
    expect(result.email.isRequired).toBe(true);
  });

  it("dependencies (an array) in a service key is not mistaken for a list node", () => {
    const config = { city: { value: "", dependencies: ["country"] } };
    const result = normalized(config, fwd);
    expect(result.city.dependencies).toEqual(["country"]);
  });

  it("renaming value → leaf detection doesn't break (value is present)", () => {
    const vfwd = defineFieldMapping({ value: "val" });
    const config = { email: { val: "x", label: "Email" } };
    const result = normalized(config, vfwd);
    expect(plain(result.email)).toEqual({ value: "x", label: "Email" });
    expect("value" in result.email).toBe(true);
  });

  it("strict: the internal name of an actively remapped config key → throws", () => {
    const config = { email: { value: "", isRequired: true } };
    expect(() => normalized(config, fwd)).toThrow(
      /write "required" instead of internal "isRequired"/,
    );
  });

  it("strict: a computed key (error/helperText) in the config → throws", () => {
    const config = { email: { value: "", error: true } };
    expect(() => normalized(config, fwd)).toThrow(/computed/);
  });

  it("output-only keys NOT written in the config don't interfere (a dirty/loading map)", () => {
    const dfwd = defineFieldMapping({ dirty: "isDirty", loading: "isLoading" });
    const config = { email: { value: "", isRequired: true, description: "d" } };
    // isRequired/description are NOT remapped here (the map covers only dirty/
    // loading) → internal names stay valid, no error.
    const result = normalized(config, dfwd);
    expect(plain(result.email)).toEqual({ value: "", isRequired: true, description: "d" });
  });
});
