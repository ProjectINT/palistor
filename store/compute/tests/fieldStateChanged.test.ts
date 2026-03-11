import { describe, it, expect } from "vitest";
import type { FieldState } from "../types";
import { fieldStateChanged } from "../fieldStateChanged";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<FieldState> = {}): FieldState {
  return {
    value: "",
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    ...overrides,
  };
}

describe("fieldStateChanged", () => {
  describe("identical states", () => {
    it("returns false when both states are equal", () => {
      const a = makeState();
      const b = makeState();
      expect(fieldStateChanged(a, b)).toBe(false);
    });

    it("returns false with all optional fields set to the same value", () => {
      const a = makeState({
        label: "Name",
        placeholder: "Enter name",
        description: "Your full name",
        isInvalid: true,
        errorMessage: "required",
        submitting: false,
        dirty: true,
        revalidate: true,
        loading: false,
      });
      const b = { ...a };
      expect(fieldStateChanged(a, b)).toBe(false);
    });
  });

  describe("value changes", () => {
    it("detects change in value", () => {
      const a = makeState({ value: "old" });
      const b = makeState({ value: "new" });
      expect(fieldStateChanged(a, b)).toBe(true);
    });

    it("detects change from string to number", () => {
      const a = makeState({ value: "0" });
      const b = makeState({ value: 0 });
      expect(fieldStateChanged(a, b)).toBe(true);
    });
  });

  describe("boolean flag changes", () => {
    it("detects change in isVisible", () => {
      expect(fieldStateChanged(makeState({ isVisible: true }), makeState({ isVisible: false }))).toBe(true);
    });

    it("detects change in isRequired", () => {
      expect(fieldStateChanged(makeState({ isRequired: false }), makeState({ isRequired: true }))).toBe(true);
    });

    it("detects change in isDisabled", () => {
      expect(fieldStateChanged(makeState({ isDisabled: false }), makeState({ isDisabled: true }))).toBe(true);
    });

    it("detects change in isReadOnly", () => {
      expect(fieldStateChanged(makeState({ isReadOnly: false }), makeState({ isReadOnly: true }))).toBe(true);
    });
  });

  describe("string property changes", () => {
    it("detects change in label", () => {
      expect(fieldStateChanged(makeState({ label: "A" }), makeState({ label: "B" }))).toBe(true);
    });

    it("detects change in placeholder", () => {
      expect(fieldStateChanged(makeState({ placeholder: "A" }), makeState({ placeholder: "B" }))).toBe(true);
    });

    it("detects change in description", () => {
      expect(fieldStateChanged(makeState({ description: "A" }), makeState({ description: "B" }))).toBe(true);
    });

    it("detects change from defined to undefined label", () => {
      expect(fieldStateChanged(makeState({ label: "Label" }), makeState({ label: undefined }))).toBe(true);
    });
  });

  describe("validation state changes", () => {
    it("detects change in isInvalid", () => {
      expect(fieldStateChanged(makeState({ isInvalid: undefined }), makeState({ isInvalid: true }))).toBe(true);
    });

    it("detects change in errorMessage", () => {
      expect(fieldStateChanged(makeState({ errorMessage: undefined }), makeState({ errorMessage: "required" }))).toBe(true);
    });
  });

  describe("async / lifecycle state changes", () => {
    it("detects change in submitting", () => {
      expect(fieldStateChanged(makeState({ submitting: false }), makeState({ submitting: true }))).toBe(true);
    });

    it("detects change in dirty", () => {
      expect(fieldStateChanged(makeState({ dirty: false }), makeState({ dirty: true }))).toBe(true);
    });

    it("detects change in revalidate", () => {
      expect(fieldStateChanged(makeState({ revalidate: false }), makeState({ revalidate: true }))).toBe(true);
    });

    it("detects change in loading", () => {
      expect(fieldStateChanged(makeState({ loading: false }), makeState({ loading: true }))).toBe(true);
    });
  });
});
