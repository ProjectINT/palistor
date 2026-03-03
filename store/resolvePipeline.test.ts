import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProxyStore } from "./store";
import type { ResolveState } from "./resolvePipeline";

// ─── Helper: flush microtasks ──────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Test config builders ──────────────────────────────────────────────────

function createBasicResolveConfig() {
  return {
    user: {
      id: { value: "user-1" },
      name: { value: "" },
    },
    car: {
      resolve: {
        resolver: vi.fn(async () => ({
          brand: "Toyota",
          model: "Camry",
        })),
        onError: vi.fn(),
      },
      brand: { value: "" },
      model: { value: "" },
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("resolvePipeline", () => {
  describe("basic resolve lifecycle", () => {
    it("should not run resolver immediately (lazy: true by default)", () => {
      const config = createBasicResolveConfig();
      createProxyStore({ config });

      // Resolver should NOT have been called (lazy by default)
      expect(config.car.resolve.resolver).not.toHaveBeenCalled();
    });

    it("should trigger resolver on first proxy access (lazy trigger)", async () => {
      const config = createBasicResolveConfig();
      const store = createProxyStore({ config });

      // Access a child field through proxy → triggers resolve
      const _brand = (store.proxy as any).car.brand.value;

      // Resolver should have been called
      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(1);
    });

    it("should set loading: true while resolver is pending", async () => {
      let resolvePromise: (v: any) => void;
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(() => new Promise((r) => { resolvePromise = r; })),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });

      // Access to trigger resolve
      const carProxy = (store.proxy as any).car;
      const _brand = carProxy.brand.value;

      // loading should be true
      expect(carProxy.loading).toBe(true);

      // Resolve
      resolvePromise!({ brand: "Toyota" });
      await flushPromises();

      // loading should be false
      expect(carProxy.loading).toBe(false);
    });

    it("should apply resolver result to subtree", async () => {
      const config = createBasicResolveConfig();
      const store = createProxyStore({ config });

      // Trigger resolve
      const carProxy = (store.proxy as any).car;
      void carProxy.brand.value;

      await flushPromises();

      expect(carProxy.brand.value).toBe("Toyota");
      expect(carProxy.model.value).toBe("Camry");
    });

    it("should run resolver immediately when lazy: false", async () => {
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => ({ brand: "Honda" })),
            onError: vi.fn(),
            options: { lazy: false },
          },
          brand: { value: "" },
        },
      };

      createProxyStore({ config });

      // Resolver should have been called immediately
      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(1);
    });
  });

  describe("deduplication", () => {
    it("should not re-run resolver if already pending", async () => {
      let resolvePromise: (v: any) => void;
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(() => new Promise((r) => { resolvePromise = r; })),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const carProxy = (store.proxy as any).car;

      // Multiple accesses while pending
      void carProxy.brand.value;
      void carProxy.brand.value;
      void carProxy.brand.value;

      // Resolver should only be called once
      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(1);

      resolvePromise!({ brand: "Toyota" });
      await flushPromises();
    });
  });

  describe("error handling", () => {
    it("should call onError when resolver fails", async () => {
      const error = new Error("Network error");
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => { throw error; }),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const carProxy = (store.proxy as any).car;
      void carProxy.brand.value;

      await flushPromises();

      expect(config.car.resolve.onError).toHaveBeenCalledTimes(1);
      expect(config.car.resolve.onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ notify: null }),
      );
    });

    it("should set loading: false after error", async () => {
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const carProxy = (store.proxy as any).car;
      void carProxy.brand.value;

      await flushPromises();

      expect(carProxy.loading).toBe(false);
    });

    it("should pass notifier to onError when registered", async () => {
      const notifyFn = vi.fn();
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      store.setNotifier(notifyFn);

      const carProxy = (store.proxy as any).car;
      void carProxy.brand.value;

      await flushPromises();

      expect(config.car.resolve.onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ notify: notifyFn }),
      );
    });
  });

  describe("retry", () => {
    it("should retry specified number of times before calling onError", async () => {
      let callCount = 0;
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => {
              callCount++;
              throw new Error(`fail ${callCount}`);
            }),
            onError: vi.fn(),
            options: {
              retry: { attempts: 2, delay: 10 },
            },
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const carProxy = (store.proxy as any).car;
      void carProxy.brand.value;

      // Wait for retries to complete (initial + 2 retries, each with 10ms delay)
      await delay(100);

      // 1 initial + 2 retries = 3 total calls
      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(3);
      expect(config.car.resolve.onError).toHaveBeenCalledTimes(1);
    });

    it("should succeed on retry without calling onError", async () => {
      let callCount = 0;
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => {
              callCount++;
              if (callCount < 2) throw new Error("fail");
              return { brand: "Toyota" };
            }),
            onError: vi.fn(),
            options: {
              retry: { attempts: 2, delay: 10 },
            },
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const carProxy = (store.proxy as any).car;
      void carProxy.brand.value;

      await delay(100);

      expect(carProxy.brand.value).toBe("Toyota");
      expect(config.car.resolve.onError).not.toHaveBeenCalled();
    });
  });

  describe("side-effects (batch mode)", () => {
    it("should buffer writes and apply them in one flush", async () => {
      const config = {
        user: {
          id: { value: "user-1" },
          vehicleExists: { value: false },
        },
        car: {
          resolve: {
            resolver: vi.fn(async (values: any) => {
              // Side-effect: write to values outside subtree
              values.user.vehicleExists = true;
              return { brand: "Toyota" };
            }),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const proxy = store.proxy as any;

      // Trigger resolve
      void proxy.car.brand.value;

      await flushPromises();

      // Side-effect should have been applied
      expect(proxy.user.vehicleExists.value).toBe(true);
      // Main result should also be applied
      expect(proxy.car.brand.value).toBe("Toyota");
    });
  });

  describe("optimistic resolver", () => {
    it("should apply optimistic values immediately before resolver completes", async () => {
      let resolvePromise: (v: any) => void;
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(() => new Promise((r) => { resolvePromise = r; })),
            optimisticResolver: vi.fn(() => ({
              brand: "Loading...",
            })),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const carProxy = (store.proxy as any).car;

      // Trigger resolve
      void carProxy.brand.value;

      // Optimistic value should be set immediately (synchronously after trigger)
      expect(carProxy.brand.value).toBe("Loading...");
      expect(carProxy.loading).toBe(true);

      // Resolve with real data
      resolvePromise!({ brand: "Toyota" });
      await flushPromises();

      expect(carProxy.brand.value).toBe("Toyota");
      expect(carProxy.loading).toBe(false);
    });
  });

  describe("auto-deps", () => {
    it("should re-run resolver when read dependency changes", async () => {
      let callCount = 0;
      const config = {
        user: {
          id: { value: "user-1" },
        },
        car: {
          resolve: {
            resolver: vi.fn(async (values: any) => {
              callCount++;
              const id = values.user.id; // auto-dep on user.id
              return { brand: `Car-for-${id}` };
            }),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const proxy = store.proxy as any;

      // Trigger resolve
      void proxy.car.brand.value;
      await flushPromises();

      expect(proxy.car.brand.value).toBe("Car-for-user-1");
      expect(callCount).toBe(1);

      // Change the dependency
      proxy.user.id.value = "user-2";

      // Wait for re-resolve
      await flushPromises();

      expect(proxy.car.brand.value).toBe("Car-for-user-2");
      expect(callCount).toBe(2);
    });

    it("should NOT re-run resolver when unrelated field changes", async () => {
      const config = {
        user: {
          id: { value: "user-1" },
          name: { value: "John" },
        },
        car: {
          resolve: {
            resolver: vi.fn(async (values: any) => {
              const id = values.user.id; // only reads user.id
              return { brand: `Car-for-${id}` };
            }),
            onError: vi.fn(),
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const proxy = store.proxy as any;

      // Trigger resolve
      void proxy.car.brand.value;
      await flushPromises();

      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(1);

      // Change unrelated field
      proxy.user.name.value = "Jane";
      await flushPromises();

      // Resolver should NOT be re-called
      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(1);
    });

    it("should work with explicit deps before first run", async () => {
      const config = {
        user: {
          id: { value: "user-1" },
        },
        car: {
          resolve: {
            resolver: vi.fn(async () => ({ brand: "Toyota" })),
            onError: vi.fn(),
            deps: ["user.id"],
          },
          brand: { value: "" },
        },
      };

      const store = createProxyStore({ config });
      const proxy = store.proxy as any;

      // Trigger initial resolve
      void proxy.car.brand.value;
      await flushPromises();

      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(1);

      // Change explicit dep
      proxy.user.id.value = "user-2";
      await flushPromises();

      // Should have been re-called
      expect(config.car.resolve.resolver).toHaveBeenCalledTimes(2);
    });
  });

  describe("nested resolve priority", () => {
    it("parent resolve should overwrite child data (atomicity)", async () => {
      const config = {
        car: {
          resolve: {
            resolver: vi.fn(async () => ({
              brand: "From-Parent",
              document: {
                series: "PP",
                number: "123",
              },
            })),
            onError: vi.fn(),
            options: { lazy: false },
          },
          brand: { value: "" },
          document: {
            series: { value: "" },
            number: { value: "" },
          },
        },
      };

      const store = createProxyStore({ config });
      await flushPromises();

      const proxy = store.proxy as any;
      expect(proxy.car.brand.value).toBe("From-Parent");
      expect(proxy.car.document.series.value).toBe("PP");
      expect(proxy.car.document.number.value).toBe("123");
    });
  });

  describe("getValues with resolve", () => {
    it("should include resolved values in getValues()", async () => {
      const config = createBasicResolveConfig();
      const store = createProxyStore({ config });

      // Trigger resolve
      void (store.proxy as any).car.brand.value;
      await flushPromises();

      const values = store.getValues();
      expect((values as any).car.brand).toBe("Toyota");
      expect((values as any).car.model).toBe("Camry");
    });
  });
});
