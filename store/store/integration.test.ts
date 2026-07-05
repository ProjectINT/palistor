/**
 * Integration test — the full Palistor flow.
 *
 * Covers: init → write → recompute → notify → submit → reset → resolve.
 * This test must pass unchanged throughout any refactoring.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from ".";

// ─── Test config ─────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    email: {
      value: "",
      label: "Email",
      isRequired: true,
      validate: (v: string) => (!v ? "required" : undefined),
    },
    paymentType: {
      value: "card",
      label: "Payment Type",
    },
    cardNumber: {
      value: "",
      label: "Card Number",
      isVisible: (values: any) => values.paymentType === "card",
      isRequired: (values: any) => values.paymentType === "card",
      validate: (v: string, values: any) =>
        values.paymentType === "card" && !v ? "required" : undefined,
    },
    passport: {
      isVisible: (values: any) => values.paymentType === "bank",
      number: {
        value: "",
        label: "Passport Number",
        isRequired: true,
        validate: (v: string) => (!v ? "required" : undefined),
      },
    },
    amount: {
      value: 0,
      label: "Amount",
      formatter: (v: any) => (typeof v === "string" ? Number(v) || 0 : v),
    },
  };
}

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Test ────────────────────────────────────────────────────────────────────

describe("Integration: the full flow", () => {
  // ─── Init ─────────────────────────────────────────────────────────────────
  describe("init — initial state", () => {
    it("creates the store and reads values from the config", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.value).toBe("");
      expect(store.proxy.paymentType.value).toBe("card");
      expect(store.proxy.amount.value).toBe(0);
    });

    it("applies initialValues", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "user@test.com", amount: 500 } as any,
      });
      expect(store.proxy.email.value).toBe("user@test.com");
      expect(store.proxy.amount.value).toBe(500);
    });

    it("computes computed props at init", () => {
      const store = new Palistor({ config: makeConfig() });
      // paymentType = "card" → cardNumber visible, passport invisible
      expect(store.proxy.cardNumber.isVisible).toBe(true);
      expect(store.proxy.passport.isVisible).toBe(false);
      expect(store.proxy.cardNumber.isRequired).toBe(true);
    });

    it("isInvalid = undefined before the first submit (revalidate=false)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.isInvalid).toBeUndefined();
    });
  });

  // ─── Write ────────────────────────────────────────────────────────────────
  describe("write — writing values", () => {
    it("writes a value through the proxy setter", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "new@test.com";
      expect(store.proxy.email.value).toBe("new@test.com");
    });

    it("applies the formatter on write", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.amount.value = "150" as any;
      expect(store.proxy.amount.value).toBe(150);
    });

    it("setValues updates several fields", () => {
      const store = new Palistor({ config: makeConfig() });
      store.setValues({ email: "bulk@test.com", amount: 999 } as any);
      expect(store.proxy.email.value).toBe("bulk@test.com");
      expect(store.proxy.amount.value).toBe(999);
    });
  });

  // ─── Recompute ────────────────────────────────────────────────────────────
  describe("recompute — dependency recalculation", () => {
    it("recomputes computed props after a write", () => {
      const store = new Palistor({ config: makeConfig() });
      // Initially card-mode
      expect(store.proxy.cardNumber.isVisible).toBe(true);
      expect(store.proxy.passport.isVisible).toBe(false);

      // Switch to bank-mode
      store.proxy.paymentType.value = "bank";

      expect(store.proxy.cardNumber.isVisible).toBe(false);
      expect(store.proxy.passport.isVisible).toBe(true);
      expect(store.proxy.cardNumber.isRequired).toBe(false);
    });

    it("re-runs validate after a write (revalidate=true)", async () => {
      const store = new Palistor({ config: makeConfig() });
      // Submit to set revalidate=true
      await store.submit();
      expect(store.proxy.email.isInvalid).toBe(true);

      // Fix email value → error should clear
      store.proxy.email.value = "valid@test.com";
      expect(store.proxy.email.isInvalid).toBeUndefined();
    });
  });

  // ─── Notify ───────────────────────────────────────────────────────────────
  describe("notify — subscriber notifications", () => {
    it("subscribeGlobal fires on a change", () => {
      const store = new Palistor({ config: makeConfig() });
      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.proxy.email.value = "notify@test.com";
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("a node subscription fires only when that node changes", () => {
      const config = makeConfig();
      const store = new Palistor({ config });
      const emailListener = vi.fn();
      store.subscribe((config as any).email, emailListener);

      store.proxy.amount.value = 100;
      expect(emailListener).not.toHaveBeenCalled();

      store.proxy.email.value = "sub@test.com";
      expect(emailListener).toHaveBeenCalledTimes(1);
    });

    it("subscribers are NOT invoked when the value is unchanged", () => {
      const store = new Palistor({ config: makeConfig() });
      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.proxy.email.value = ""; // same as initial
      expect(listener).not.toHaveBeenCalled();
    });

    it("getVersion grows after a change", () => {
      const store = new Palistor({ config: makeConfig() });
      const v0 = store.getVersion();
      store.proxy.email.value = "version@test.com";
      expect(store.getVersion()).toBeGreaterThan(v0);
    });
  });

  // ─── Submit ───────────────────────────────────────────────────────────────
  describe("submit — form submission", () => {
    it("submit returns success=false when there are errors", async () => {
      const store = new Palistor({ config: makeConfig() });
      const result = await store.submit();
      expect(result.success).toBe(false);
    });

    it("submit returns success=true when the form is valid", async () => {
      // Use a simple config without nested required groups
      const config = {
        email: {
          value: "",
          validate: (v: string) => (!v ? "required" : undefined),
        },
        name: { value: "" },
      };
      const store = new Palistor({
        config,
        initialValues: { email: "user@test.com" } as any,
      });
      const result = await store.submit();
      expect(result.success).toBe(true);
    });

    it("submit turns revalidate on — errors are visible", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.submit();
      expect(store.proxy.email.isInvalid).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("getValues returns the current values snapshot", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "snap@test.com" } as any,
      });
      const values = store.getValues();
      expect((values as any).email).toBe("snap@test.com");
    });
  });

  // ─── Reset ────────────────────────────────────────────────────────────────
  describe("reset — resetting values", () => {
    it("resets to the initial values", async () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "initial@test.com" } as any,
      });
      store.proxy.email.value = "changed@test.com";
      expect(store.proxy.email.value).toBe("changed@test.com");

      store.reset();
      expect(store.proxy.email.value).toBe("initial@test.com");
    });

    it("reset with a patch applies the new values", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "dirty@test.com";

      store.reset({ email: "fresh@test.com" } as any);
      expect(store.proxy.email.value).toBe("fresh@test.com");
    });

    it("reset clears revalidate and errors", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.submit(); // set revalidate=true, show errors
      expect(store.proxy.email.isInvalid).toBe(true);

      store.reset({ email: "fresh@reset.com" } as any);
      // After reset revalidate=false, no errors
      expect(store.proxy.email.isInvalid).toBeUndefined();
    });

    it("the dirty flag is cleared after reset", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "dirty@test.com";
      expect(store.proxy.email.dirty).toBe(true);

      store.reset();
      expect(store.proxy.email.dirty).toBe(false);
    });
  });

  // ─── Resolve ──────────────────────────────────────────────────────────────
  describe("resolve — the async resolver", () => {
    it("the resolver loads data into the group fields", async () => {
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => ({ brand: "Toyota", model: "Camry" })),
            onError: vi.fn(),
          },
          brand: { value: "" },
          model: { value: "" },
        },
      };
      const store = new Palistor({ config });

      // Proxy access triggers the lazy resolve (deferred via microtask)
      const carProxy = (store.proxy as any).car;
      const _brand = carProxy.brand.value;

      // Flush microtask — triggerResolve is deferred
      await Promise.resolve();

      expect(carProxy.loading).toBe(true);

      await flushPromises();

      expect(carProxy.brand.value).toBe("Toyota");
      expect(carProxy.model.value).toBe("Camry");
      expect(carProxy.loading).toBe(false);
    });

    it("lazy: false launches the resolver immediately (eager)", async () => {
      const resolver = vi.fn(async () => ({ brand: "Honda" }));
      const config = {
        car: {
          resolve: {
            resolver,
            onError: vi.fn(),
            options: { lazy: false },
          },
          brand: { value: "" },
        },
      };
      new Palistor({ config });

      // With lazy: false, resolver should be called immediately (during init)
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it("onError is called when the resolver fails", async () => {
      const error = new Error("Network error");
      const onError = vi.fn();
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => { throw error; }),
            onError,
          },
          brand: { value: "" },
        },
      };
      const store = new Palistor({ config });
      // Lazy resolve: proxy access launches the resolver
      void (store.proxy as any).car.brand.value;
      await flushPromises();

      expect(onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ notify: expect.any(Function) }),
      );
    });
  });
});
