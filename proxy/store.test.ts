import { describe, it, expect, vi } from "vitest";
import { createProxyStore } from "./store/store";

// ─── Тестовый конфиг ─────────────────────────────────────────────────────────

const makeConfig = () => ({
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
    issueDate: {
      value: "",
      label: "Issue Date",
    },
  },
  amount: {
    value: 0,
    label: "Amount",
    formatter: (v: any) => (typeof v === "string" ? Number(v) || 0 : v),
  },
});

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("createProxyStore", () => {
  describe("чтение начального состояния", () => {
    it("читает value из конфига", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.email.value).toBe("");
      expect(store.proxy.paymentType.value).toBe("card");
    });

    it("применяет initialValues поверх конфига", () => {
      const store = createProxyStore({
        config: makeConfig(),
        initialValues: { email: "user@test.com" } as any,
      });
      expect(store.proxy.email.value).toBe("user@test.com");
    });

    it("читает label из конфига (строка)", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.email.label).toBe("Email");
      expect(store.proxy.cardNumber.label).toBe("Card Number");
    });

    it("вычисляет isRequired (boolean)", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.email.isRequired).toBe(true);
    });

    it("вычисляет isRequired (function)", () => {
      const store = createProxyStore({ config: makeConfig() });
      // paymentType = "card" → cardNumber.isRequired = true
      expect(store.proxy.cardNumber.isRequired).toBe(true);
    });

    it("вычисляет isVisible (function)", () => {
      const store = createProxyStore({ config: makeConfig() });
      // paymentType = "card" → cardNumber.isVisible = true
      expect(store.proxy.cardNumber.isVisible).toBe(true);
      // paymentType = "card" → passport.isVisible = false
      expect(store.proxy.passport.isVisible).toBe(false);
    });

    it("вычисляет error через validate", () => {
      const store = createProxyStore({ config: makeConfig() });
      // email пустой, validate = (v) => !v ? "required" : undefined
      expect(store.proxy.email.error).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("error = undefined когда валидация проходит", () => {
      const store = createProxyStore({
        config: makeConfig(),
        initialValues: { email: "user@test.com" } as any,
      });
      expect(store.proxy.email.error).toBeUndefined();
      expect(store.proxy.email.errorMessage).toBeUndefined();
    });

    it("isDisabled и isReadOnly по умолчанию false", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.email.isDisabled).toBe(false);
      expect(store.proxy.email.isReadOnly).toBe(false);
    });
  });

  describe("вложенные поля", () => {
    it("доступ через точку к вложенным полям", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.passport.number.value).toBe("");
      expect(store.proxy.passport.number.label).toBe("Passport Number");
      expect(store.proxy.passport.number.isRequired).toBe(true);
    });

    it("isVisible на группе (промежуточном узле)", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.passport.isVisible).toBe(false); // paymentType = "card"
    });

    it("initialValues для вложенных полей", () => {
      const store = createProxyStore({
        config: makeConfig(),
        initialValues: { passport: { number: "AB123" } } as any,
      });
      expect(store.proxy.passport.number.value).toBe("AB123");
    });
  });

  describe("запись value", () => {
    it("обновляет значение поля", () => {
      const store = createProxyStore({ config: makeConfig() });
      store.proxy.email.value = "new@test.com";
      expect(store.proxy.email.value).toBe("new@test.com");
    });

    it("пересчитывает validate после записи", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.email.error).toBe(true); // пустой

      store.proxy.email.value = "filled";
      expect(store.proxy.email.error).toBeUndefined(); // заполнен

      store.proxy.email.value = "";
      expect(store.proxy.email.error).toBe(true); // снова пустой
    });

    it("пересчитывает isVisible зависимых полей", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.cardNumber.isVisible).toBe(true); // paymentType = "card"
      expect(store.proxy.passport.isVisible).toBe(false);

      store.proxy.paymentType.value = "bank";
      expect(store.proxy.cardNumber.isVisible).toBe(false); // теперь bank
      expect(store.proxy.passport.isVisible).toBe(true);
    });

    it("пересчитывает isRequired зависимых полей", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.proxy.cardNumber.isRequired).toBe(true);

      store.proxy.paymentType.value = "bank";
      expect(store.proxy.cardNumber.isRequired).toBe(false);
    });

    it("применяет formatter при записи", () => {
      const store = createProxyStore({ config: makeConfig() });
      store.proxy.amount.value = "42";
      expect(store.proxy.amount.value).toBe(42);
    });

    it("запись в вложенные поля", () => {
      const store = createProxyStore({ config: makeConfig() });
      store.proxy.passport.number.value = "XY999";
      expect(store.proxy.passport.number.value).toBe("XY999");
    });
  });

  describe("подписка и уведомления", () => {
    it("вызывает listener при записи value", () => {
      const config = makeConfig();
      const store = createProxyStore({ config });
      const listener = vi.fn();

      // Подписываемся на узел email конфига
      store.subscribe((config as any).email, listener);
      store.proxy.email.value = "hello";

      expect(listener).toHaveBeenCalled();
    });

    it("уведомляет зависимые поля при изменении", () => {
      const config = makeConfig();
      const store = createProxyStore({ config });
      const cardListener = vi.fn();

      store.subscribe((config as any).cardNumber, cardListener);
      // Меняем paymentType → cardNumber.isVisible пересчитывается → уведомление
      store.proxy.paymentType.value = "bank";

      expect(cardListener).toHaveBeenCalled();
    });

    it("отписка работает", () => {
      const config = makeConfig();
      const store = createProxyStore({ config });
      const listener = vi.fn();

      const unsub = store.subscribe((config as any).email, listener);
      unsub();

      store.proxy.email.value = "hello";
      expect(listener).not.toHaveBeenCalled();
    });

    it("не уведомляет, если computed-состояние не изменилось", () => {
      const config = makeConfig();
      const store = createProxyStore({ config });
      const issueDateListener = vi.fn();

      store.subscribe((config as any).passport.issueDate, issueDateListener);
      // issueDate не зависит от email, его состояние не изменится
      store.proxy.email.value = "x";

      expect(issueDateListener).not.toHaveBeenCalled();
    });
  });

  describe("getValues", () => {
    it("возвращает вложенный объект со значениями", () => {
      const store = createProxyStore({
        config: makeConfig(),
        initialValues: { email: "test@test.com" } as any,
      });

      const values = store.getValues();
      expect(values.email).toBe("test@test.com");
      expect(values.paymentType).toBe("card");
      expect(values.passport.number).toBe("");
      expect(values.passport.issueDate).toBe("");
    });

    it("отражает изменения после записи", () => {
      const store = createProxyStore({ config: makeConfig() });
      store.proxy.email.value = "updated";
      store.proxy.passport.number.value = "AB123";

      const values = store.getValues();
      expect(values.email).toBe("updated");
      expect(values.passport.number).toBe("AB123");
    });
  });

  describe("кэширование прокси", () => {
    it("одинаковые пути возвращают один и тот же прокси", () => {
      const store = createProxyStore({ config: makeConfig() });
      const p1 = store.proxy.passport;
      const p2 = store.proxy.passport;
      expect(p1).toBe(p2);
    });

    it("конфиг не мутируется", () => {
      const config = makeConfig();
      const originalValue = config.email.value;
      const store = createProxyStore({ config });

      store.proxy.email.value = "mutated";
      expect(config.email.value).toBe(originalValue);
    });
  });

  describe("label как функция (translate)", () => {
    it("вызывает функцию для label", () => {
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
        },
      };
      const store = createProxyStore({ config: config as any });
      // Пока translate = identity → вернёт ключ
      expect(store.proxy.name.label).toBe("form.name");
    });
  });
});
