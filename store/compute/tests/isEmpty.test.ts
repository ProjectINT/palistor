import { describe, it, expect } from "vitest";
import { isEmpty } from "../isEmpty";

describe("isEmpty", () => {
  describe("null / undefined", () => {
    it("considers null empty", () => {
      expect(isEmpty(null)).toBe(true);
    });

    it("considers undefined empty", () => {
      expect(isEmpty(undefined)).toBe(true);
    });
  });

  describe("strings", () => {
    it("considers empty string empty", () => {
      expect(isEmpty("")).toBe(true);
    });

    it("considers whitespace-only string empty", () => {
      expect(isEmpty("   ")).toBe(true);
      expect(isEmpty("\t\n")).toBe(true);
    });

    it("considers non-empty string not empty", () => {
      expect(isEmpty("a")).toBe(false);
      expect(isEmpty("hello")).toBe(false);
    });
  });

  describe("numbers", () => {
    it("considers NaN empty", () => {
      expect(isEmpty(NaN)).toBe(true);
    });

    it("considers 0 not empty", () => {
      expect(isEmpty(0)).toBe(false);
    });

    it("considers regular numbers not empty", () => {
      expect(isEmpty(1)).toBe(false);
      expect(isEmpty(-1)).toBe(false);
      expect(isEmpty(3.14)).toBe(false);
    });
  });

  describe("other types", () => {
    it("considers false not empty", () => {
      expect(isEmpty(false)).toBe(false);
    });

    it("considers true not empty", () => {
      expect(isEmpty(true)).toBe(false);
    });

    it("considers empty array not empty", () => {
      expect(isEmpty([])).toBe(false);
    });

    it("considers empty object not empty", () => {
      expect(isEmpty({})).toBe(false);
    });
  });
});
