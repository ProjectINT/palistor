import { describe, it, expect, vi } from "vitest";
import { createProxyStore } from "./store";

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

    it("error скрыт до первого submit (revalidate=false по умолчанию)", () => {
      const store = createProxyStore({ config: makeConfig() });
      // revalidate=false → ошибки не вычисляются, пока не было submit
      expect(store.proxy.email.error).toBeUndefined();
      expect(store.proxy.email.errorMessage).toBeUndefined();
    });

    it("error показывается после submit (revalidate=true)", async () => {
      const store = createProxyStore({ config: makeConfig() });
      // Первый submit с пустым email → fail → revalidate=true
      const result = await store.submit();
      expect(result.success).toBe(false);
      // Теперь ошибки видны
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

    it("пересчитывает validate после записи (когда revalidate=true)", async () => {
      const store = createProxyStore({ config: makeConfig() });
      // До submit — ошибок нет (revalidate=false)
      expect(store.proxy.email.error).toBeUndefined();

      // Trigger revalidate via failed submit
      await store.submit();

      expect(store.proxy.email.error).toBe(true); // пустой, revalidate=true

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

  describe("onValueChange", () => {
    it("устанавливает value через onValueChange", () => {
      const store = createProxyStore({ config: makeConfig() });

      store.proxy.email.onValueChange("hello@test.com");

      expect(store.proxy.email.value).toBe("hello@test.com");
      expect(store.getValues().email).toBe("hello@test.com");
    });

    it("onValueChange вызывает formatter", () => {
      const store = createProxyStore({ config: makeConfig() });

      store.proxy.amount.onValueChange("42");

      expect(store.proxy.amount.value).toBe(42);
    });

    it("onValueChange вызывает пересчёт зависимых полей", () => {
      const store = createProxyStore({ config: makeConfig() });

      expect(store.proxy.cardNumber.isVisible).toBe(true);
      expect(store.proxy.passport.isVisible).toBe(false);

      store.proxy.paymentType.onValueChange("bank");

      expect(store.proxy.cardNumber.isVisible).toBe(false);
      expect(store.proxy.passport.isVisible).toBe(true);
    });

    it("onValueChange вызывает validate (когда revalidate=true)", async () => {
      const store = createProxyStore({ config: makeConfig() });

      // Trigger revalidate via failed submit
      await store.submit();

      store.proxy.email.onValueChange("valid@test.com");
      expect(store.proxy.email.error).toBeUndefined();

      store.proxy.email.onValueChange("");
      expect(store.proxy.email.error).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("onValueChange уведомляет подписчиков", () => {
      const store = createProxyStore({ config: makeConfig() });
      const listener = vi.fn();

      store.subscribeGlobal(listener);

      store.proxy.email.onValueChange("notify@test.com");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("onValueChange возвращает стабильную ссылку", () => {
      const store = createProxyStore({ config: makeConfig() });

      const fn1 = store.proxy.email.onValueChange;
      const fn2 = store.proxy.email.onValueChange;

      expect(fn1).toBe(fn2);
    });

    it("onValueChange работает для вложенных полей", () => {
      const store = createProxyStore({ config: makeConfig() });

      store.proxy.passport.number.onValueChange("AB123");

      expect(store.proxy.passport.number.value).toBe("AB123");
      expect(store.getValues().passport.number).toBe("AB123");
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

  describe("spread proxy ({...proxy})", () => {
    it("не утекает validate при spread листового узла", () => {
      const store = createProxyStore({ config: makeConfig() });
      const spread = { ...store.proxy.cardNumber };

      // validate не должен быть в spread
      expect(spread).not.toHaveProperty("validate");
      expect(spread).not.toHaveProperty("formatter");
      expect(spread).not.toHaveProperty("setter");
      expect(spread).not.toHaveProperty("dependencies");
      expect(spread).not.toHaveProperty("types");
    });

    it("spread содержит все SPREADABLE_FIELD_STATE_PROPS и onValueChange", () => {
      const store = createProxyStore({ config: makeConfig() });
      const spread = { ...store.proxy.email };

      expect(spread).toHaveProperty("value");
      expect(spread).toHaveProperty("label");
      expect(spread).toHaveProperty("isVisible");
      expect(spread).toHaveProperty("isRequired");
      expect(spread).toHaveProperty("isDisabled");
      expect(spread).toHaveProperty("isReadOnly");
      expect(spread).toHaveProperty("error");
      expect(spread).toHaveProperty("errorMessage");
      expect(spread).toHaveProperty("onValueChange");

      // dirty и loading исключены из spread листового узла
      expect(spread).not.toHaveProperty("dirty");
      expect(spread).not.toHaveProperty("loading");
    });

    it("Object.keys не содержит внутренних ключей конфига", () => {
      const store = createProxyStore({ config: makeConfig() });
      const keys = Object.keys(store.proxy.cardNumber);

      expect(keys).not.toContain("validate");
      expect(keys).not.toContain("formatter");
      expect(keys).not.toContain("setter");
      expect(keys).not.toContain("dependencies");
      expect(keys).toContain("value");
      expect(keys).toContain("onValueChange");
    });

    it("spread группового узла содержит GROUP_SPREAD_KEYS", () => {
      const store = createProxyStore({ config: makeConfig() });
      const keys = Object.keys(store.proxy.passport);

      // Групповой узел спредит только служебные ключи
      expect(keys).toContain("submitting");
      expect(keys).toContain("dirty");
      expect(keys).toContain("loading");
      expect(keys).toContain("submit");
      expect(keys).toContain("reset");

      // Дочерние и внутренние ключи не попадают в spread
      expect(keys).not.toContain("number");
      expect(keys).not.toContain("issueDate");
      expect(keys).not.toContain("validate");
      expect(keys).not.toContain("formatter");
    });

    it("validate вызывается после submit (не через spread)", async () => {
      const config = {
        paymentType: { value: "card" },
        cardNumber: {
          value: "",
          validate: (v: string, values: any) => {
            if (values.paymentType !== "card") return;
            if (!v) return "required";
          },
        },
      };
      const store = createProxyStore({ config });

      // До submit — ошибки не вычисляются
      expect(store.proxy.cardNumber.error).toBeUndefined();

      // После submit — revalidate=true → ошибки видны
      await store.submit();
      expect(store.proxy.cardNumber.error).toBe(true);
      expect(store.proxy.cardNumber.errorMessage).toBe("required");

      // Но НЕ утекает при spread
      const spread = { ...store.proxy.cardNumber };
      expect(spread).not.toHaveProperty("validate");
    });
  });

  describe("computed values (value как функция)", () => {
    const makeComputedConfig = () => ({
      price: {
        value: 100,
        label: "Price",
        dependencies: [],
      },
      quantity: {
        value: 1,
        label: "Quantity",
        dependencies: [],
      },
      total: {
        value: (values: any) => values.price * values.quantity,
        label: "Total",
        isReadOnly: true,
        dependencies: ["price", "quantity"],
      },
    });

    it("вычисляет начальное computed value", () => {
      const store = createProxyStore({ config: makeComputedConfig() });
      expect(store.proxy.total.value).toBe(100); // 100 * 1
    });

    it("пересчитывает computed value при изменении зависимости", () => {
      const store = createProxyStore({ config: makeComputedConfig() });
      expect(store.proxy.total.value).toBe(100);

      store.proxy.quantity.value = 5;
      expect(store.proxy.total.value).toBe(500); // 100 * 5

      store.proxy.price.value = 200;
      expect(store.proxy.total.value).toBe(1000); // 200 * 5
    });

    it("computed value отражается в getValues()", () => {
      const store = createProxyStore({ config: makeComputedConfig() });
      store.proxy.price.value = 50;
      store.proxy.quantity.value = 3;

      const values = store.getValues();
      expect(values.total).toBe(150); // 50 * 3
    });

    it("computed value доступен через isReadOnly", () => {
      const store = createProxyStore({ config: makeComputedConfig() });
      expect(store.proxy.total.isReadOnly).toBe(true);
    });

    it("уведомляет подписчиков при изменении computed value", () => {
      const config = makeComputedConfig();
      const store = createProxyStore({ config });
      const listener = vi.fn();

      store.subscribe((config as any).total, listener);
      store.proxy.price.value = 200;

      expect(listener).toHaveBeenCalled();
    });

    it("цепочка computed: A → B → C", () => {
      const config = {
        base: { value: 10, dependencies: [] },
        doubled: {
          value: (values: any) => values.base * 2,
          dependencies: ["base"],
        },
        quadrupled: {
          value: (values: any) => values.doubled * 2,
          dependencies: ["doubled"],
        },
      };
      const store = createProxyStore({ config });
      expect(store.proxy.doubled.value).toBe(20);
      expect(store.proxy.quadrupled.value).toBe(40);

      store.proxy.base.value = 5;
      expect(store.proxy.doubled.value).toBe(10);
      expect(store.proxy.quadrupled.value).toBe(20);
    });

    it("initialValues перекрывает computed для обычных полей", () => {
      const store = createProxyStore({
        config: makeComputedConfig(),
        initialValues: { price: 50, quantity: 4 } as any,
      });
      // total пересчитывается из новых price/quantity
      expect(store.proxy.total.value).toBe(200); // 50 * 4
    });
  });

  describe("setter (сайд-эффект записи)", () => {
    const makeSetterConfig = () => ({
      paymentType: {
        value: "card" as string,
        label: "Payment Type",
        setter: (value: string) => {
          if (value === "bank") {
            return { cardNumber: "" };
          }
          return {};
        },
      },
      cardNumber: {
        value: "4111111111111111",
        label: "Card Number",
      },
      bankAccount: {
        value: "",
        label: "Bank Account",
      },
    });

    it("setter сбрасывает значение другого поля при записи", () => {
      const store = createProxyStore({ config: makeSetterConfig() });
      expect(store.proxy.cardNumber.value).toBe("4111111111111111");

      store.proxy.paymentType.value = "bank";
      expect(store.proxy.paymentType.value).toBe("bank");
      expect(store.proxy.cardNumber.value).toBe(""); // сброшено setter-ом
    });

    it("setter не трогает не указанные поля", () => {
      const store = createProxyStore({ config: makeSetterConfig() });
      store.proxy.bankAccount.value = "40817810099910004312";

      store.proxy.paymentType.value = "bank";
      // bankAccount не указан в patch → не тронут
      expect(store.proxy.bankAccount.value).toBe("40817810099910004312");
    });

    it("setter + computed вместе", () => {
      const config = {
        price: { value: 100, dependencies: [] },
        quantity: {
          value: 1,
          dependencies: [],
          setter: (value: number) => {
            // При установке quantity > 10 — автоматически даём скидку
            if (value > 10) return { price: 80 };
            return {};
          },
        },
        total: {
          value: (values: any) => values.price * values.quantity,
          isReadOnly: true,
          dependencies: ["price", "quantity"],
        },
      };
      const store = createProxyStore({ config });
      expect(store.proxy.total.value).toBe(100); // 100 * 1

      store.proxy.quantity.value = 15;
      // setter уменьшил price до 80, computed пересчитал total
      expect(store.proxy.price.value).toBe(80);
      expect(store.proxy.total.value).toBe(1200); // 80 * 15
    });

    it("setter для вложенных полей", () => {
      const config = {
        country: {
          value: "ru" as string,
          setter: (value: string) => {
            if (value === "us") {
              return { address: { city: "New York" } };
            }
            return {};
          },
        },
        address: {
          city: { value: "", label: "City" },
          zip: { value: "", label: "ZIP" },
        },
      };
      const store = createProxyStore({ config });

      store.proxy.country.value = "us";
      expect(store.proxy.address.city.value).toBe("New York");
      expect(store.proxy.address.zip.value).toBe(""); // не тронут
    });

    it("getValues отражает изменения от setter", () => {
      const store = createProxyStore({ config: makeSetterConfig() });
      store.proxy.paymentType.value = "bank";

      const values = store.getValues();
      expect(values.paymentType).toBe("bank");
      expect(values.cardNumber).toBe("");
    });
  });

  // ─── Setter-патч: уведомления подписчиков при массовом обновлении ────────

  describe("setter patch → уведомления подписчиков", () => {
    /**
     * Конфиг, в котором setter одного поля (currency) патчит сразу несколько
     * других полей (symbol, decimals, nested prefix). Это позволяет проверить,
     * что подписчики ВСЕХ затронутых полей получают уведомление за один цикл
     * записи, без необходимости отдельного `.value = …` для каждого поля.
     */
    const makePatchConfig = () => ({
      currency: {
        value: "USD" as string,
        label: "Currency",
        /**
         * setter: при смене валюты — одним патчем обновляем символ,
         * количество десятичных знаков и вложенный префикс.
         * Таким образом setter *заменяет* необходимость
         * ручного вызова `.value = …` для каждого из этих полей.
         */
        setter: (value: string) => {
          const presets: Record<string, { symbol: string; decimals: number; display: { prefix: string } }> = {
            USD: { symbol: "$", decimals: 2, display: { prefix: "US" } },
            EUR: { symbol: "€", decimals: 2, display: { prefix: "EU" } },
            BTC: { symbol: "₿", decimals: 8, display: { prefix: "BT" } },
          };
          const preset = presets[value] ?? presets.USD;
          // Патч — вложенный объект, совпадающий по структуре с конфигом
          return {
            symbol: preset.symbol,
            decimals: preset.decimals,
            display: preset.display,
          };
        },
      },
      symbol: {
        value: "$",
        label: "Symbol",
      },
      decimals: {
        value: 2,
        label: "Decimals",
      },
      display: {
        prefix: {
          value: "US",
          label: "Prefix",
        },
      },
    });

    it("setter патчит несколько полей за одну запись — значения обновлены", () => {
      const store = createProxyStore({ config: makePatchConfig() });

      // До патча — начальные значения USD
      expect(store.proxy.symbol.value).toBe("$");
      expect(store.proxy.decimals.value).toBe(2);
      expect(store.proxy.display.prefix.value).toBe("US");

      // Одна запись → setter возвращает патч → все поля обновлены
      store.proxy.currency.value = "BTC";

      expect(store.proxy.currency.value).toBe("BTC");
      expect(store.proxy.symbol.value).toBe("₿");
      expect(store.proxy.decimals.value).toBe(8);
      expect(store.proxy.display.prefix.value).toBe("BT");
    });

    it("подписчики ВСЕХ запатченных полей уведомлены за один цикл", () => {
      const config = makePatchConfig();
      const store = createProxyStore({ config });

      // Подписываемся на каждое поле, затронутое патчем
      const symbolListener = vi.fn();
      const decimalsListener = vi.fn();
      const prefixListener = vi.fn();
      const currencyListener = vi.fn();

      store.subscribe((config as any).symbol, symbolListener);
      store.subscribe((config as any).decimals, decimalsListener);
      store.subscribe((config as any).display.prefix, prefixListener);
      store.subscribe((config as any).currency, currencyListener);

      // Одна запись — setter патчит symbol, decimals, display.prefix
      store.proxy.currency.value = "EUR";

      // Все подписчики должны быть вызваны ровно один раз:
      // — currencyListener: значение самого поля изменилось
      // — symbolListener:   setter обновил через патч ($ → €)
      // — decimalsListener: setter обновил через патч (2 → 2, но recompute может
      //                     не вызвать, если значение не изменилось — проверяем ниже)
      // — prefixListener:   setter обновил через патч (US → EU)
      expect(currencyListener).toHaveBeenCalledTimes(1);
      expect(symbolListener).toHaveBeenCalledTimes(1);
      expect(prefixListener).toHaveBeenCalledTimes(1);

      // decimals: 2 → 2 (не изменилось) — подписчик НЕ вызывается,
      // потому что recomputeAll фильтрует по fieldStateChanged
      expect(decimalsListener).not.toHaveBeenCalled();
    });

    it("глобальный подписчик уведомлён ровно один раз при патче", () => {
      const store = createProxyStore({ config: makePatchConfig() });
      const globalListener = vi.fn();

      store.subscribeGlobal(globalListener);
      store.proxy.currency.value = "BTC";

      // Несмотря на то что setter изменил 3+ поля,
      // глобальный подписчик вызывается ровно один раз за цикл записи
      expect(globalListener).toHaveBeenCalledTimes(1);
    });

    it("getValues отражает все изменения от setter-патча", () => {
      const store = createProxyStore({ config: makePatchConfig() });
      store.proxy.currency.value = "EUR";

      const values = store.getValues();
      expect(values).toEqual({
        currency: "EUR",
        symbol: "€",
        decimals: 2,
        display: { prefix: "EU" },
      });
    });

    it("setter-патч НЕ требует отдельного .value = для каждого поля", () => {
      /**
       * Ключевой сценарий: setter *заменяет* дефолтное поведение
       * множественных записей. Вместо:
       *
       *   proxy.symbol.value = "₿";
       *   proxy.decimals.value = 8;
       *   proxy.display.prefix.value = "BT";
       *
       * Достаточно одной записи — setter сделает всё сам:
       *
       *   proxy.currency.value = "BTC";
       */
      const config = makePatchConfig();
      const store = createProxyStore({ config });

      // Подписчики, которые считают вызовы
      const symbolCalls = vi.fn();
      const decimalsCalls = vi.fn();
      const prefixCalls = vi.fn();

      store.subscribe((config as any).symbol, symbolCalls);
      store.subscribe((config as any).decimals, decimalsCalls);
      store.subscribe((config as any).display.prefix, prefixCalls);

      // Одна запись заменяет три — setter патчит всё за раз
      store.proxy.currency.value = "BTC";

      // Значения корректны
      expect(store.proxy.symbol.value).toBe("₿");
      expect(store.proxy.decimals.value).toBe(8);
      expect(store.proxy.display.prefix.value).toBe("BT");

      // Подписчики вызваны — UI перерисует затронутые поля
      expect(symbolCalls).toHaveBeenCalled();
      expect(prefixCalls).toHaveBeenCalled();
      // decimals тоже изменилось (2 → 8) — подписчик вызван
      expect(decimalsCalls).toHaveBeenCalled();
    });

    it("версия узла обновляется для каждого запатченного поля", () => {
      const config = makePatchConfig();
      const store = createProxyStore({ config });

      // Запоминаем начальные версии
      const symbolV0 = store.getNodeVersion((config as any).symbol);
      const prefixV0 = store.getNodeVersion((config as any).display.prefix);

      store.proxy.currency.value = "BTC";

      // Версии должны увеличиться — означает, что поле было затронуто
      expect(store.getNodeVersion((config as any).symbol)).toBeGreaterThan(symbolV0);
      expect(store.getNodeVersion((config as any).display.prefix)).toBeGreaterThan(prefixV0);
    });

    it("повторный патч с теми же значениями — подписчики НЕ вызываются", () => {
      const config = makePatchConfig();
      const store = createProxyStore({ config });

      // Первый раз: USD → EUR
      store.proxy.currency.value = "EUR";

      const symbolListener = vi.fn();
      const prefixListener = vi.fn();

      store.subscribe((config as any).symbol, symbolListener);
      store.subscribe((config as any).display.prefix, prefixListener);

      // Второй раз: EUR → EUR (те же значения)
      store.proxy.currency.value = "EUR";

      // Значения не изменились → recomputeAll не включит их в changed →
      // подписчики НЕ вызваны (за исключением самого currency, который
      // всегда добавляется в changed через changed.add(node))
      expect(symbolListener).not.toHaveBeenCalled();
      expect(prefixListener).not.toHaveBeenCalled();
    });
  });

  // ─── Translator (setTranslator / getTranslator) ───────────────────────────

  describe("setTranslator / getTranslator", () => {
    it("без translator — label-функция возвращает ключ (identity fallback)", () => {
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
          placeholder: (t: (key: string) => string) => t("form.namePlaceholder"),
        },
      };
      const store = createProxyStore({ config: config as any });
      expect(store.proxy.name.label).toBe("form.name");
      expect(store.proxy.name.placeholder).toBe("form.namePlaceholder");
      expect(store.getTranslator()).toBeTypeOf("function");
    });

    it("после setTranslator — label резолвится через translator", () => {
      const translations: Record<string, string> = {
        "form.name": "Имя",
        "form.namePlaceholder": "Введите имя",
        "form.desc": "Описание поля",
      };
      const t = (key: string) => translations[key] ?? key;

      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
          placeholder: (t: (key: string) => string) => t("form.namePlaceholder"),
          description: (t: (key: string) => string) => t("form.desc"),
        },
      };
      const store = createProxyStore({ config: config as any });

      store.setTranslator(t);

      expect(store.proxy.name.label).toBe("Имя");
      expect(store.proxy.name.placeholder).toBe("Введите имя");
      expect(store.proxy.name.description).toBe("Описание поля");
      expect(store.getTranslator()).toBe(t);
    });

    it("setTranslator(null) возвращает к fallback (ключам)", () => {
      const t = (key: string) => `[${key}]`;
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
        },
      };
      const store = createProxyStore({ config: config as any });

      store.setTranslator(t);
      expect(store.proxy.name.label).toBe("[form.name]");

      store.setTranslator(null);
      expect(store.proxy.name.label).toBe("form.name"); // fallback to identity
      expect(store.getTranslator()).toBeTypeOf("function");
    });

    it("setTranslator инкрементирует версию и уведомляет подписчиков", () => {
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
        },
      };
      const store = createProxyStore({ config: config as any });
      const versionBefore = store.getVersion();

      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.setTranslator((key) => `translated:${key}`);

      expect(store.getVersion()).toBe(versionBefore + 1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("setTranslator с тем же translator не вызывает лишних уведомлений", () => {
      const t = (key: string) => key.toUpperCase();
      const config = {
        name: { value: "", label: (t: (key: string) => string) => t("form.name") },
      };
      const store = createProxyStore({ config: config as any });

      store.setTranslator(t);
      const versionAfterFirst = store.getVersion();

      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.setTranslator(t); // same reference
      expect(store.getVersion()).toBe(versionAfterFirst); // no bump
      expect(listener).not.toHaveBeenCalled();
    });

    it("статические строковые label не зависят от translator", () => {
      const config = {
        name: { value: "", label: "Static Label" },
      };
      const store = createProxyStore({ config: config as any });

      store.setTranslator((key) => `translated:${key}`);
      // Статическая строка — не вызывается как функция
      expect(store.proxy.name.label).toBe("Static Label");
    });

    it("spread корректно резолвит label через translator", () => {
      const t = (key: string) => `[${key}]`;
      const config = {
        name: {
          value: "test",
          label: (t: (key: string) => string) => t("form.name"),
          placeholder: (t: (key: string) => string) => t("form.namePlaceholder"),
        },
      };
      const store = createProxyStore({ config: config as any });
      store.setTranslator(t);

      const spread = { ...store.proxy.name };
      expect(spread.label).toBe("[form.name]");
      expect(spread.placeholder).toBe("[form.namePlaceholder]");
      expect(spread.value).toBe("test");
    });
  });
});
