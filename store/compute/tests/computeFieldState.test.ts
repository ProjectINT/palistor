import { describe, it, expect } from "vitest";
import { computeFieldState } from "../computeFieldState";

// ─── Базовый конфиг ──────────────────────────────────────────────────────────

const baseConfig = {
  label: "Email",
  placeholder: "user@example.com",
  description: "Your email address",
};

describe("computeFieldState", () => {
  describe("basic flags defaults", () => {
    it("isVisible defaults to true", () => {
      const state = computeFieldState(baseConfig, "", {}, true, (v) => v);
      expect(state.isVisible).toBe(true);
    });

    it("isRequired defaults to false", () => {
      const state = computeFieldState(baseConfig, "", {}, true, (v) => v);
      expect(state.isRequired).toBe(false);
    });

    it("isDisabled defaults to false", () => {
      const state = computeFieldState(baseConfig, "", {}, true, (v) => v);
      expect(state.isDisabled).toBe(false);
    });

    it("isReadOnly defaults to false", () => {
      const state = computeFieldState(baseConfig, "", {}, true, (v) => v);
      expect(state.isReadOnly).toBe(false);
    });
  });

  describe("string properties", () => {
    it("resolves label, placeholder, description from config", () => {
      const state = computeFieldState(baseConfig, "", {}, true, (v) => v);
      expect(state.label).toBe("Email");
      expect(state.placeholder).toBe("user@example.com");
      expect(state.description).toBe("Your email address");
    });

    it("leaves string properties undefined when not in config", () => {
      const state = computeFieldState({}, "", {}, true, (v) => v);
      expect(state.label).toBeUndefined();
      expect(state.placeholder).toBeUndefined();
      expect(state.description).toBeUndefined();
    });

    it("resolves label from function using identity translator", () => {
      const config = { label: (t: any) => t("form.email") };
      const state = computeFieldState(config, "", {}, true, (v) => v);
      expect(state.label).toBe("form.email");
    });
  });

  describe("value", () => {
    it("stores currentValue in state.value", () => {
      const state = computeFieldState(baseConfig, "test@test.com", {}, true, (v) => v);
      expect(state.value).toBe("test@test.com");
    });

    it("stores numeric value", () => {
      expect(computeFieldState({}, 42, {}, true, (v) => v).value).toBe(42);
    });
  });

  describe("flag resolution", () => {
    it("evaluates boolean isVisible=false", () => {
      const state = computeFieldState({ isVisible: false }, "", {}, true, (v) => v);
      expect(state.isVisible).toBe(false);
    });

    it("evaluates function isVisible using allValues", () => {
      const config = { isVisible: (v: any) => v.type === "bank" };
      expect(computeFieldState(config, "", { type: "card" }, true, (v) => v).isVisible).toBe(false);
      expect(computeFieldState(config, "", { type: "bank" }, true, (v) => v).isVisible).toBe(true);
    });

    it("evaluates function isRequired using allValues", () => {
      const config = { isRequired: (v: any) => v.type === "card" };
      expect(computeFieldState(config, "", { type: "card" }, true, (v) => v).isRequired).toBe(true);
      expect(computeFieldState(config, "", { type: "bank" }, true, (v) => v).isRequired).toBe(false);
    });
  });

  describe("validation — revalidate=true (default)", () => {
    it("sets isInvalid when isRequired=true and value is empty", () => {
      const config = { isRequired: true };
      const state = computeFieldState(config, "", {}, true, (v) => v);
      expect(state.isInvalid).toBe(true);
      expect(state.errorMessage).toBe("required");
    });

    it("uses custom string message from isRequired", () => {
      const config = { isRequired: "Field is required" };
      const state = computeFieldState(config, "", {}, true, (v) => v);
      expect(state.isInvalid).toBe(true);
      expect(state.errorMessage).toBe("Field is required");
    });

    it("no isInvalid when isRequired=true and value is non-empty", () => {
      const config = { isRequired: true };
      const state = computeFieldState(config, "hello", {}, true, (v) => v);
      expect(state.isInvalid).toBeUndefined();
      expect(state.errorMessage).toBeUndefined();
    });

    it("custom validate overrides isRequired error message", () => {
      const config = {
        isRequired: true,
        validate: (v: string) => !v ? "custom error" : undefined,
      };
      const state = computeFieldState(config, "", {}, true, (v) => v);
      expect(state.isInvalid).toBe(true);
      expect(state.errorMessage).toBe("custom error");
    });

    it("custom validate runs independently when isRequired is not set", () => {
      const config = { validate: (v: string) => v.length > 5 ? "too long" : undefined };
      expect(computeFieldState(config, "toolong", {}, true, (v) => v).errorMessage).toBe("too long");
      expect(computeFieldState(config, "ok", {}, true, (v) => v).isInvalid).toBeUndefined();
    });

    it("passes translate function to custom validate", () => {
      let receivedT: any;
      const config = { validate: (_v: any, _vals: any, t: any) => { receivedT = t; return undefined; } };
      const translator = (k: string) => `[${k}]`;
      computeFieldState(config, "x", {}, true, translator);
      expect(receivedT).toBe(translator);
    });
  });

  describe("validation — revalidate=false", () => {
    it("skips validation when revalidate=false", () => {
      const config = { isRequired: true };
      const state = computeFieldState(config, "", {}, false, (v) => v);
      expect(state.isInvalid).toBeUndefined();
      expect(state.errorMessage).toBeUndefined();
    });

    it("does not call custom validate when revalidate=false", () => {
      let called = false;
      const config = { validate: () => { called = true; return "err"; } };
      computeFieldState(config, "", {}, false, (v) => v);
      expect(called).toBe(false);
    });
  });
});
