/**
 * The skill's fieldMapping example (Phase 2.6): with a mapping active the
 * config is authored in the external names. Ported from the store suite's
 * temporary skill-verification test, which was removed once this copy ran on
 * both implementations: import from @impl, nothing else changed.
 */
import { describe, expect, it } from "vitest";
import { Palistor } from "@impl";

describe("SKILL.md fieldMapping example, config authored as the skill teaches elsewhere", () => {
  it("throws on construction when orderConfig uses internal names (isRequired, description)", () => {
    // orderConfig authored the way the skill's other sections teach
    // (Key Patterns: isRequired, description, etc.)
    const orderConfig = {
      email: {
        value: "",
        isRequired: true,
        description: "We never share it",
      },
    };
    expect(
      () =>
        new Palistor({
          config: orderConfig as any,
          fieldMapping: {
            isRequired: "required",
            isDisabled: "disabled",
            isReadOnly: "readOnly",
            isInvalid: "error",
            errorMessage: "helperText",
            description: "helpText",
          },
        }),
    ).toThrow(/write "required" instead of internal "isRequired"/);
  });

  it("works when orderConfig is authored in EXTERNAL names (single vocabulary)", async () => {
    const store = new Palistor({
      config: {
        email: { value: "", required: true, helpText: "We never share it" },
      },
      fieldMapping: {
        isRequired: "required",
        isInvalid: "error",
        errorMessage: "helperText",
        description: "helpText",
      },
    });
    expect(store.proxy.email.required).toBe(true);
    await store.submit();
    expect(store.proxy.email.error).toBe(true); // required fed compute via normalization
  });
});
