import { describe, it, expect } from "vitest";
import { parseValue } from "./parser";

describe("parseValue", () => {
  describe("String dataType", () => {
    it("should convert number to string", () => {
      expect(parseValue(42, "String")).toBe("42");
    });

    it("should keep string as string", () => {
      expect(parseValue("hello", "String")).toBe("hello");
    });

    it("should throw error for boolean", () => {
      expect(() => parseValue(true, "String")).toThrow(
        '[Palistor] Invalid value type for dataType "String"'
      );
    });

    it("should throw error for object", () => {
      expect(() => parseValue({}, "String")).toThrow(
        '[Palistor] Invalid value type for dataType "String"'
      );
    });

    it("should throw error for array", () => {
      expect(() => parseValue([], "String")).toThrow(
        '[Palistor] Invalid value type for dataType "String"'
      );
    });
  });

  describe("Number dataType", () => {
    it("should keep number as number", () => {
      expect(parseValue(42, "Number")).toBe(42);
    });

    it("should convert string to number", () => {
      expect(parseValue("42", "Number")).toBe(42);
    });

    it("should convert string with decimals to number", () => {
      expect(parseValue("3.14", "Number")).toBe(3.14);
    });

    it("should return NaN for non-numeric string", () => {
      expect(parseValue("hello", "Number")).toBeNaN();
    });

    it("should throw error for boolean", () => {
      expect(() => parseValue(true, "Number")).toThrow(
        '[Palistor] Invalid value type for dataType "Number"'
      );
    });

    it("should throw error for object", () => {
      expect(() => parseValue({}, "Number")).toThrow(
        '[Palistor] Invalid value type for dataType "Number"'
      );
    });
  });

  describe("Boolean dataType", () => {
    it("should accept boolean value", () => {
      expect(parseValue(true, "Boolean")).toBe(true);
      expect(parseValue(false, "Boolean")).toBe(false);
    });

    it("should throw error for string", () => {
      expect(() => parseValue("true", "Boolean")).toThrow(
        '[Palistor] Invalid value type for dataType "Boolean"'
      );
    });

    it("should throw error for number", () => {
      expect(() => parseValue(1, "Boolean")).toThrow(
        '[Palistor] Invalid value type for dataType "Boolean"'
      );
    });
  });

  describe("Date dataType", () => {
    it("should accept Date object", () => {
      const date = new Date();
      expect(parseValue(date, "Date")).toBe(date);
    });

    it("should accept any object (including Date)", () => {
      const obj = { date: "2024-01-01" };
      expect(parseValue(obj, "Date")).toBe(obj);
    });

    it("should throw error for string", () => {
      expect(() => parseValue("2024-01-01", "Date")).toThrow(
        '[Palistor] Invalid value type for dataType "Date"'
      );
    });

    it("should throw error for number", () => {
      expect(() => parseValue(1234567890, "Date")).toThrow(
        '[Palistor] Invalid value type for dataType "Date"'
      );
    });
  });

  describe("Array dataType", () => {
    it("should accept array", () => {
      const arr = [1, 2, 3];
      expect(parseValue(arr, "Array")).toBe(arr);
    });

    it("should accept empty array", () => {
      const arr: unknown[] = [];
      expect(parseValue(arr, "Array")).toBe(arr);
    });

    it("should accept any object (including arrays)", () => {
      const obj = { items: [] };
      expect(parseValue(obj, "Array")).toBe(obj);
    });

    it("should throw error for string", () => {
      expect(() => parseValue("[]", "Array")).toThrow(
        '[Palistor] Invalid value type for dataType "Array"'
      );
    });

    it("should throw error for number", () => {
      expect(() => parseValue(123, "Array")).toThrow(
        '[Palistor] Invalid value type for dataType "Array"'
      );
    });
  });

  describe("Object dataType", () => {
    it("should accept plain object", () => {
      const obj = { key: "value" };
      expect(parseValue(obj, "Object")).toBe(obj);
    });

    it("should accept empty object", () => {
      const obj = {};
      expect(parseValue(obj, "Object")).toBe(obj);
    });

    it("should accept arrays (as they are objects)", () => {
      const arr = [1, 2, 3];
      expect(parseValue(arr, "Object")).toBe(arr);
    });

    it("should accept Date objects", () => {
      const date = new Date();
      expect(parseValue(date, "Object")).toBe(date);
    });

    it("should throw error for string", () => {
      expect(() => parseValue("{}", "Object")).toThrow(
        '[Palistor] Invalid value type for dataType "Object"'
      );
    });

    it("should throw error for number", () => {
      expect(() => parseValue(123, "Object")).toThrow(
        '[Palistor] Invalid value type for dataType "Object"'
      );
    });

    it("should throw error for boolean", () => {
      expect(() => parseValue(true, "Object")).toThrow(
        '[Palistor] Invalid value type for dataType "Object"'
      );
    });
  });

  describe("Edge cases", () => {
    it("should handle null value for Object type", () => {
      expect(parseValue(null, "Object")).toBe(null);
    });

    it("should throw error for undefined value for Object type", () => {
      expect(() => parseValue(undefined, "Object")).toThrow(
        '[Palistor] Invalid value type for dataType "Object"'
      );
    });

    it("should convert empty string to empty string for String type", () => {
      expect(parseValue("", "String")).toBe("");
    });

    it("should convert empty string to 0 for Number type", () => {
      expect(parseValue("", "Number")).toBe(0);
    });

    it("should convert 0 to '0' for String type", () => {
      expect(parseValue(0, "String")).toBe("0");
    });
  });
});
