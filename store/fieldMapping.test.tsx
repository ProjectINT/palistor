import { describe, it, expect, vi } from "vitest";
import { render, screen, act, renderHook } from "@testing-library/react";
import { Palistor } from "./store";
import { defineFieldMapping } from "./defineFieldMapping";
import { useForm } from "../react/useForm";

// ─── Test configs ────────────────────────────────────────────────────────────

/**
 * A config in the SINGLE PUBLIC vocabulary of the `mapping` map below
 * (external names): `required`, `disabled`, `helpText` instead of internal
 * `isRequired`, `isDisabled`, `description`. `value` / `label` are not
 * renamed by the map → written as-is. The normalizer in the constructor
 * converts them to internal names before compute/init.
 */
const makeMappedConfig = () => ({
  email: {
    value: "",
    label: "Email",
    required: true,
    disabled: false,
    helpText: "Your email",
    validate: (v: string) => (!v ? "Email is required" : undefined),
    componentProps: { size: "lg" },
  },
  profile: {
    firstName: { value: "Jane", label: "First" },
  },
});

/**
 * A config in INTERNAL names — for scenarios WITHOUT active config-key
 * mapping (an empty map, or a map over computed-only keys dirty/loading that
 * never appear in a config).
 */
const makeConfig = () => ({
  email: {
    value: "",
    label: "Email",
    isRequired: true,
    isDisabled: false,
    description: "Your email",
    validate: (v: string) => (!v ? "Email is required" : undefined),
    componentProps: { size: "lg" },
  },
  profile: {
    firstName: { value: "Jane", label: "First" },
  },
});

const makeListConfig = () => ({
  users: [{ id: { value: "" }, name: { value: "" } }],
});

/**
 * Ant-Design-like mapping.
 *
 * IMPORTANT: `defineFieldMapping` (not `: FieldMapping` and not
 * `satisfies FieldMapping`) — so TypeScript keeps the literal values
 * (`"required"`, …) and threads them into the `store.proxy` type. An
 * annotation/`satisfies` would widen the values to `string` and static
 * renaming would not work (runtime always works regardless).
 */
const mapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("fieldMapping", () => {
  describe("kernel — map construction", () => {
    it("builds externalToInternal as the inverse of fieldMapping", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      expect(store.fieldMapping).toBe(mapping);
      expect(store.externalToInternal).toEqual({
        required: "isRequired",
        disabled: "isDisabled",
        readOnly: "isReadOnly",
        error: "isInvalid",
        helperText: "errorMessage",
        helpText: "description",
      });
    });

    it("without fieldMapping both maps are empty (zero overhead)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.fieldMapping).toEqual({});
      expect(store.externalToInternal).toEqual({});
    });
  });

  describe("strict — config in external names (normalization on input)", () => {
    it("ingest sees external config keys: required feeds validation", async () => {
      // required:true is authored in the config using the external name. The
      // normalizer → isRequired, and it reaches computeFieldState (not just
      // the output spread).
      const store = new Palistor({
        config: { email: { value: "", required: true } },
        fieldMapping: { isRequired: "required" },
      });
      // the map here contains only isRequired→required, so invalidity is read
      // by the internal name isInvalid.
      expect((store.proxy.email as any).isInvalid).toBeFalsy(); // before submit revalidate=false
      await store.submit();
      expect((store.proxy.email as any).isInvalid).toBe(true); // required worked on the ingest path
    });

    it("ingest sees external disabled → FieldState.isDisabled", () => {
      const store = new Palistor({
        config: { email: { value: "", disabled: true } },
        fieldMapping: { isDisabled: "disabled" },
      });
      expect(store.proxy.email.disabled).toBe(true);
      expect((store.proxy.email as any).isDisabled).toBe(true);
    });

    it("strict: an internal config-key name with an active mapping → error", () => {
      expect(
        () =>
          new Palistor({
            // `as any` — the config is intentionally invalid (an internal name
            // with an active map); this checks the RUNTIME throw, not the type
            // (types catch this separately, see "the config validator catches
            // internal names").
            config: { email: { value: "", isRequired: true } } as any,
            fieldMapping: { isRequired: "required" },
          }),
      ).toThrow(/write "required" instead of internal "isRequired"/);
    });

    it("strict: a computed key (error) in the config → error", () => {
      expect(
        () =>
          new Palistor({
            config: { email: { value: "", error: true } as any },
            fieldMapping: { isInvalid: "error" },
          }),
      ).toThrow(/computed/);
    });

    it("the normalizer does not mutate the original config", () => {
      const config = { email: { value: "", required: true } };
      new Palistor({ config, fieldMapping: { isRequired: "required" } });
      // the original keeps the external name
      expect((config.email as any).required).toBe(true);
      expect((config.email as any).isRequired).toBeUndefined();
    });
  });

  describe("GET via the source proxy", () => {
    it("external names return the computed field state (typed)", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      // No `as any` — the names are typed via the captured TMapping.
      const required: boolean = store.proxy.email.required;
      const disabled: boolean = store.proxy.email.disabled;
      const helpText: string | undefined = store.proxy.email.helpText;
      expect(required).toBe(true);
      expect(disabled).toBe(false);
      expect(helpText).toBe("Your email");
    });

    it("internal names still resolve at runtime (types hide them)", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      // Runtime safety: the old name resolves through the regular handler.
      // At the type level the name is hidden → access via `any`.
      const email = store.proxy.email as any;
      expect(email.isRequired).toBe(true);
      expect(email.isDisabled).toBe(false);
      expect(email.description).toBe("Your email");
    });

    it("keys not in the map stay unchanged", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const value: string = store.proxy.email.value;
      const label: string | undefined = store.proxy.email.label;
      expect(value).toBe("");
      expect(label).toBe("Email");
      expect(typeof store.proxy.email.onValueChange).toBe("function");
    });

    it("error/helperText reflect validation after submit", async () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      // before submit revalidate=false → no errors
      expect(store.proxy.email.error).toBeFalsy();
      expect(store.proxy.email.helperText).toBeUndefined();

      await store.submit();

      // external (typed)
      const error: boolean | undefined = store.proxy.email.error;
      const helperText: string | undefined = store.proxy.email.helperText;
      expect(error).toBe(true);
      expect(helperText).toBe("Email is required");
      // internal — the same value resolves at runtime
      expect((store.proxy.email as any).isInvalid).toBe(true);
      expect((store.proxy.email as any).errorMessage).toBe("Email is required");
    });
  });

  describe("SET via the source proxy", () => {
    it("writing value (not renamed) works as usual", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      store.proxy.email.value = "a@b.com";
      expect(store.proxy.email.value).toBe("a@b.com");
    });

    it("a write through a renamed value translates to internal (runtime)", () => {
      const store = new Palistor({
        // value is renamed to `val` → the config also uses `val`.
        config: { email: { val: "", label: "Email" } },
        fieldMapping: { value: "val" },
      });
      // Renaming `value` itself is exotic (UI kits call it `value`).
      // The runtime works; the proxy value type isn't inferred when `value`
      // is remapped (value is structural for type derivation) → access via `any`.
      const email = store.proxy.email as any;
      email.val = "x@y.com";
      expect(email.val).toBe("x@y.com");
      expect((store.getValues() as any).email).toBe("x@y.com");
    });
  });

  describe("spread / ownKeys", () => {
    it("only external names are visible in a spread", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const keys = Object.keys({ ...store.proxy.email });

      expect(keys).toContain("required");
      expect(keys).toContain("disabled");
      expect(keys).toContain("helpText");
      // internal names disappear from the spread
      expect(keys).not.toContain("isRequired");
      expect(keys).not.toContain("isDisabled");
      expect(keys).not.toContain("description");
    });

    it("spread values are correct, componentProps keys are preserved", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const spread = { ...store.proxy.email };
      expect(spread.required).toBe(true);
      expect(spread.helpText).toBe("Your email");
      expect(spread.value).toBe("");
      expect(spread.label).toBe("Email");
      // componentProps is never in the map — the key passes without renaming
      expect(Object.keys(spread)).toContain("size");
      expect(typeof spread.onValueChange).toBe("function");
    });

    it("group: mappable keys (dirty/loading) are projected into the spread", () => {
      const store = new Palistor({
        config: makeConfig(),
        fieldMapping: { dirty: "isDirty", loading: "isLoading" },
      });
      const keys = Object.keys({ ...store.proxy.profile });
      expect(keys).toContain("isDirty");
      expect(keys).toContain("isLoading");
      expect(keys).not.toContain("dirty");
      expect(keys).not.toContain("loading");
      // non-mappable group keys are untouched
      expect(keys).toContain("submit");
      expect(keys).toContain("value");
    });

    it("group: reading a renamed dirty returns the computed state", () => {
      const store = new Palistor({
        config: makeConfig(),
        fieldMapping: { dirty: "isDirty" },
      });
      expect(store.proxy.profile.isDirty).toBe(false);
      // make the group dirty — the renamed key must reflect it
      store.proxy.profile.firstName.value = "Changed";
      expect(store.proxy.profile.isDirty).toBe(true);
      // the internal name is still resolvable at runtime
      expect((store.proxy.profile as any).dirty).toBe(true);
    });
  });

  describe("list proxy", () => {
    it("external loading/dirty names are readable and projected into the spread", () => {
      const store = new Palistor({
        config: makeListConfig(),
        fieldMapping: { loading: "isLoading", dirty: "isDirty" },
      });
      const isLoading: boolean = store.proxy.users.isLoading;
      const isDirty: boolean = store.proxy.users.isDirty;
      expect(isLoading).toBe(false);
      expect(isDirty).toBe(false);

      const keys = Object.keys({ ...store.proxy.users });
      expect(keys).toContain("isLoading");
      expect(keys).toContain("isDirty");
      expect(keys).not.toContain("loading");
      expect(keys).not.toContain("dirty");
      // non-mappable list keys are preserved
      expect(keys).toContain("items");
      expect(keys).toContain("add");
    });
  });

  describe("identity — empty fieldMapping ≡ current behavior", () => {
    it("GET and spread match the no-map behavior (types unchanged)", () => {
      const store = new Palistor({ config: makeConfig() });
      // Without a map the static type is the old one: internal names are direct.
      const isRequired: boolean = store.proxy.email.isRequired;
      expect(isRequired).toBe(true);
      const keys = Object.keys({ ...store.proxy.email });
      expect(keys).toContain("isRequired");
      expect(keys).toContain("value");
      expect(keys).not.toContain("required");
    });
  });

  describe("static typing (compile-time)", () => {
    it("external names are typed, internal ones are hidden", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });

      // the external name exists in the type
      const required: boolean = store.proxy.email.required;
      expect(typeof required).toBe("boolean");

      // @ts-expect-error the internal name was renamed → absent from the type
      store.proxy.email.isRequired;

      // @ts-expect-error errorMessage was renamed to helperText
      store.proxy.email.errorMessage;
    });

    it("useForm(store) preserves the mapping in the type", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));

      const required: boolean = result.current.email.required;
      expect(required).toBe(true);

      // @ts-expect-error the internal name is hidden in the tracking proxy too
      result.current.email.isRequired;
    });

    // External-config validator. Type-level checks only; the function body is
    // NEVER called, so the normalizer's runtime throw doesn't fire.
    // (There is no type-test runner in the repo — validated via `tsc --noEmit`.)
    it("the config validator catches internal names with an active mapping", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      function _typeOnly() {
        // a pure external config — compiles
        new Palistor({
          fieldMapping: mapping,
          config: { email: { value: "", required: true, helpText: "hi" } },
        });
        // the internal name of a remapped key — type error
        new Palistor({
          fieldMapping: mapping,
          // @ts-expect-error write "required" instead of internal "isRequired"
          config: { email: { value: "", isRequired: true } },
        });
        // a nested group
        new Palistor({
          fieldMapping: mapping,
          config: {
            // @ts-expect-error write "disabled" instead of internal "isDisabled"
            passport: { number: { value: "", isDisabled: true } },
          },
        });
        // without a mapping internal names are valid
        new Palistor({ config: { email: { value: "", isRequired: true } } });
      }
      expect(typeof _typeOnly).toBe("function");
    });
  });

  describe("tracking proxy (useForm)", () => {
    it("external names read through the tracking proxy (typed)", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));
      const required: boolean = result.current.email.required;
      const helpText: string | undefined = result.current.email.helpText;
      expect(required).toBe(true);
      expect(helpText).toBe("Your email");
    });

    it("spread via the tracking proxy shows only external names", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));
      const keys = Object.keys({ ...result.current.email });
      expect(keys).toContain("required");
      expect(keys).not.toContain("isRequired");
    });

    it("re-renders the component when a renamed prop changes", async () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const renderCount = vi.fn();

      function Comp() {
        renderCount();
        const form = useForm(store);
        return <span data-testid="ht">{form.email.helperText ?? "—"}</span>;
      }

      render(<Comp />);
      expect(screen.getByTestId("ht").textContent).toBe("—");
      const before = renderCount.mock.calls.length;

      await act(async () => {
        await store.submit();
      });

      expect(screen.getByTestId("ht").textContent).toBe("Email is required");
      expect(renderCount.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
