/**
 * The SKILL.md fieldMapping example (Phase 2.6). Ported from
 * store/__skill_verify_tmp.test.ts (the file Phase 0 item 8 wanted renamed):
 * import from @impl, nothing else changed.
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
