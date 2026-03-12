import { describe, it, expect } from "vitest";
import { resolveString } from "../resolveString";

describe("resolveString", () => {
  describe("undefined configValue", () => {
    it("returns undefined", () => {
      expect(resolveString(undefined)).toBeUndefined();
      expect(resolveString(undefined, { a: 1 })).toBeUndefined();
    });
  });

  describe("string configValue", () => {
    it("returns the string as-is", () => {
      expect(resolveString("Email")).toBe("Email");
    });

    it("ignores values when configValue is a plain string", () => {
      expect(resolveString("label", { x: 1 })).toBe("label");
    });
  });

  describe("function configValue", () => {
    it("calls the function with identity translator returning translation key", () => {
      const fn = (t: (v: string) => string) => t("form.email.label");
      expect(resolveString(fn)).toBe("form.email.label");
    });

    it("calls the function with provided values", () => {
      const values = { type: "card" };
      let receivedValues: any;
      resolveString((_t, v) => { receivedValues = v; return "x"; }, values);
      expect(receivedValues).toBe(values);
    });

    it("calls the function with a real translator when provided via identity fallback", () => {
      const fn = (t: (v: string) => string, values: any) =>
        `${t("prefix")}:${values.suffix}`;
      expect(resolveString(fn, { suffix: "end" })).toBe("prefix:end");
    });

    it("uses empty object as default values when not provided", () => {
      const fn = (_t: any, values: any) => String(Object.keys(values).length);
      expect(resolveString(fn)).toBe("0");
    });
  });
});
