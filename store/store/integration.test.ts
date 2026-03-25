/**
 * Integration test — полный flow Palistor.
 *
 * Покрывает: init → write → recompute → notify → submit → reset → resolve.
 * Этот тест должен проходить без изменений на протяжении всего рефакторинга.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from ".";

// ─── Тестовый конфиг ─────────────────────────────────────────────────────────

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

// ─── Тест ────────────────────────────────────────────────────────────────────

describe("Integration: полный flow", () => {
  // ─── Init ─────────────────────────────────────────────────────────────────
  describe("init — начальное состояние", () => {
    it("создаёт store и читает значения из конфига", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.value).toBe("");
      expect(store.proxy.paymentType.value).toBe("card");
      expect(store.proxy.amount.value).toBe(0);
    });

    it("применяет initialValues", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "user@test.com", amount: 500 } as any,
      });
      expect(store.proxy.email.value).toBe("user@test.com");
      expect(store.proxy.amount.value).toBe(500);
    });

    it("вычисляет computed-свойства при init", () => {
      const store = new Palistor({ config: makeConfig() });
      // paymentType = "card" → cardNumber visible, passport invisible
      expect(store.proxy.cardNumber.isVisible).toBe(true);
      expect(store.proxy.passport.isVisible).toBe(false);
      expect(store.proxy.cardNumber.isRequired).toBe(true);
    });

    it("isInvalid = undefined до первого submit (revalidate=false)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.isInvalid).toBeUndefined();
    });
  });

  // ─── Write ────────────────────────────────────────────────────────────────
  describe("write — запись значений", () => {
    it("записывает значение через proxy setter", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "new@test.com";
      expect(store.proxy.email.value).toBe("new@test.com");
    });

    it("применяет formatter при записи", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.amount.value = "150" as any;
      expect(store.proxy.amount.value).toBe(150);
    });

    it("setValues обновляет несколько полей", () => {
      const store = new Palistor({ config: makeConfig() });
      store.setValues({ email: "bulk@test.com", amount: 999 } as any);
      expect(store.proxy.email.value).toBe("bulk@test.com");
      expect(store.proxy.amount.value).toBe(999);
    });
  });

  // ─── Recompute ────────────────────────────────────────────────────────────
  describe("recompute — пересчёт зависимостей", () => {
    it("пересчитывает computed-свойства после write", () => {
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

    it("пересчитывает validate после write (revalidate=true)", async () => {
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
  describe("notify — уведомления подписчиков", () => {
    it("subscribeGlobal вызывается при изменении", () => {
      const store = new Palistor({ config: makeConfig() });
      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.proxy.email.value = "notify@test.com";
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("subscribe на узел вызывается только при изменении этого узла", () => {
      const config = makeConfig();
      const store = new Palistor({ config });
      const emailListener = vi.fn();
      store.subscribe((config as any).email, emailListener);

      store.proxy.amount.value = 100;
      expect(emailListener).not.toHaveBeenCalled();

      store.proxy.email.value = "sub@test.com";
      expect(emailListener).toHaveBeenCalledTimes(1);
    });

    it("подписчики НЕ вызываются если значение не изменилось", () => {
      const store = new Palistor({ config: makeConfig() });
      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.proxy.email.value = ""; // same as initial
      expect(listener).not.toHaveBeenCalled();
    });

    it("getVersion увеличивается после изменения", () => {
      const store = new Palistor({ config: makeConfig() });
      const v0 = store.getVersion();
      store.proxy.email.value = "version@test.com";
      expect(store.getVersion()).toBeGreaterThan(v0);
    });
  });

  // ─── Submit ───────────────────────────────────────────────────────────────
  describe("submit — отправка формы", () => {
    it("submit возвращает success=false если есть ошибки", async () => {
      const store = new Palistor({ config: makeConfig() });
      const result = await store.submit();
      expect(result.success).toBe(false);
    });

    it("submit возвращает success=true если форма валидна", async () => {
      // Используем простой конфиг без вложенных обязательных групп
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

    it("после submit включает revalidate — ошибки видны", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.submit();
      expect(store.proxy.email.isInvalid).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("getValues возвращает текущий снапшот значений", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "snap@test.com" } as any,
      });
      const values = store.getValues();
      expect((values as any).email).toBe("snap@test.com");
    });
  });

  // ─── Reset ────────────────────────────────────────────────────────────────
  describe("reset — сброс значений", () => {
    it("сбрасывает к начальным значениям", async () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "initial@test.com" } as any,
      });
      store.proxy.email.value = "changed@test.com";
      expect(store.proxy.email.value).toBe("changed@test.com");

      store.reset();
      expect(store.proxy.email.value).toBe("initial@test.com");
    });

    it("reset с патчем применяет новые значения", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "dirty@test.com";

      store.reset({ email: "fresh@test.com" } as any);
      expect(store.proxy.email.value).toBe("fresh@test.com");
    });

    it("после reset убирает revalidate и ошибки", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.submit(); // set revalidate=true, show errors
      expect(store.proxy.email.isInvalid).toBe(true);

      store.reset({ email: "fresh@reset.com" } as any);
      // After reset revalidate=false, no errors
      expect(store.proxy.email.isInvalid).toBeUndefined();
    });

    it("dirty флаг сбрасывается после reset", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "dirty@test.com";
      expect(store.proxy.email.dirty).toBe(true);

      store.reset();
      expect(store.proxy.email.dirty).toBe(false);
    });
  });

  // ─── Resolve ──────────────────────────────────────────────────────────────
  describe("resolve — асинхронный резолвер", () => {
    it("резолвер загружает данные в поля группы", async () => {
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

      // Доступ через proxy запускает lazy-resolve (deferred via microtask)
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

    it("lazy: false запускает резолвер сразу (eager)", async () => {
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

    it("onError вызывается при ошибке резолвера", async () => {
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
      // Lazy resolve: доступ через proxy запускает резолвер
      void (store.proxy as any).car.brand.value;
      await flushPromises();

      expect(onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ notify: expect.any(Function) }),
      );
    });
  });
});
