import { describe, it, expect } from "vitest";
import { resolveFlag } from "../resolveFlag";

describe("resolveFlag", () => {
  describe("undefined configValue", () => {
    it("returns defaultValue=true when configValue is undefined", () => {
      expect(resolveFlag(undefined, {}, true)).toBe(true);
    });

    it("returns defaultValue=false when configValue is undefined", () => {
      expect(resolveFlag(undefined, {}, false)).toBe(false);
    });
  });

  describe("boolean configValue", () => {
    it("returns true when configValue is true", () => {
      expect(resolveFlag(true, {}, false)).toBe(true);
    });

    it("returns false when configValue is false", () => {
      expect(resolveFlag(false, {}, true)).toBe(false);
    });
  });

  describe("function configValue", () => {
    it("calls the function with values and returns its result", () => {
      const fn = (values: any) => values.active === true;
      expect(resolveFlag(fn, { active: true }, false)).toBe(true);
      expect(resolveFlag(fn, { active: false }, true)).toBe(false);
    });

    it("passes entire values object to the function", () => {
      const values = { a: 1, b: 2 };
      let received: any;
      resolveFlag((v) => { received = v; return true; }, values, false);
      expect(received).toBe(values);
    });
  });
});
