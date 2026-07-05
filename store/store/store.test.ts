import { describe, it, expect, vi } from "vitest";
import { Palistor } from ".";

// ─── Test config ─────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Palistor", () => {
  describe("reading initial state", () => {
    it("reads value from the config", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.value).toBe("");
      expect(store.proxy.paymentType.value).toBe("card");
    });

    it("applies initialValues over the config", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "user@test.com" } as any,
      });
      expect(store.proxy.email.value).toBe("user@test.com");
    });

    it("reads label from the config (string)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.label).toBe("Email");
      expect(store.proxy.cardNumber.label).toBe("Card Number");
    });

    it("computes isRequired (boolean)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.isRequired).toBe(true);
    });

    it("computes isRequired (function)", () => {
      const store = new Palistor({ config: makeConfig() });
      // paymentType = "card" → cardNumber.isRequired = true
      expect(store.proxy.cardNumber.isRequired).toBe(true);
    });

    it("computes isVisible (function)", () => {
      const store = new Palistor({ config: makeConfig() });
      // paymentType = "card" → cardNumber.isVisible = true
      expect(store.proxy.cardNumber.isVisible).toBe(true);
      // paymentType = "card" → passport.isVisible = false
      expect(store.proxy.passport.isVisible).toBe(false);
    });

    it("isInvalid is hidden before the first submit (revalidate=false by default)", () => {
      const store = new Palistor({ config: makeConfig() });
      // revalidate=false → errors are not computed until a submit happens
      expect(store.proxy.email.isInvalid).toBeUndefined();
      expect(store.proxy.email.errorMessage).toBeUndefined();
    });

    it("isInvalid shows after submit (revalidate=true)", async () => {
      const store = new Palistor({ config: makeConfig() });
      // First submit with an empty email → fail → revalidate=true
      const result = await store.submit();
      expect(result.success).toBe(false);
      // Errors are visible now
      expect(store.proxy.email.isInvalid).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("isInvalid = undefined when validation passes", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "user@test.com" } as any,
      });
      expect(store.proxy.email.isInvalid).toBeUndefined();
      expect(store.proxy.email.errorMessage).toBeUndefined();
    });

    it("isDisabled and isReadOnly default to false", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.isDisabled).toBe(false);
      expect(store.proxy.email.isReadOnly).toBe(false);
    });
  });

  describe("nested fields", () => {
    it("dot access to nested fields", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.passport.number.value).toBe("");
      expect(store.proxy.passport.number.label).toBe("Passport Number");
      expect(store.proxy.passport.number.isRequired).toBe(true);
    });

    it("isVisible on a group (intermediate node)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.passport.isVisible).toBe(false); // paymentType = "card"
    });

    it("initialValues for nested fields", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { passport: { number: "AB123" } } as any,
      });
      expect(store.proxy.passport.number.value).toBe("AB123");
    });
  });

  describe("writing value", () => {
    it("updates the field value", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "new@test.com";
      expect(store.proxy.email.value).toBe("new@test.com");
    });

    it("re-runs validate after a write (when revalidate=true)", async () => {
      const store = new Palistor({ config: makeConfig() });
      // Before submit — no errors (revalidate=false)
      expect(store.proxy.email.isInvalid).toBeUndefined();

      // Trigger revalidate via failed submit
      await store.submit();

      expect(store.proxy.email.isInvalid).toBe(true); // empty, revalidate=true

      store.proxy.email.value = "filled";
      expect(store.proxy.email.isInvalid).toBeUndefined(); // filled

      store.proxy.email.value = "";
      expect(store.proxy.email.isInvalid).toBe(true); // empty again
    });

    it("recomputes isVisible of dependent fields", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.cardNumber.isVisible).toBe(true); // paymentType = "card"
      expect(store.proxy.passport.isVisible).toBe(false);

      store.proxy.paymentType.value = "bank";
      expect(store.proxy.cardNumber.isVisible).toBe(false); // now bank
      expect(store.proxy.passport.isVisible).toBe(true);
    });

    it("recomputes isRequired of dependent fields", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.cardNumber.isRequired).toBe(true);

      store.proxy.paymentType.value = "bank";
      expect(store.proxy.cardNumber.isRequired).toBe(false);
    });

    it("applies the formatter on write", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.amount.value = "42";
      expect(store.proxy.amount.value).toBe(42);
    });

    it("writes to nested fields", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.passport.number.value = "XY999";
      expect(store.proxy.passport.number.value).toBe("XY999");
    });
  });

  describe("subscriptions and notifications", () => {
    it("calls the listener when value is written", () => {
      const config = makeConfig();
      const store = new Palistor({ config });
      const listener = vi.fn();

      // Subscribe to the email config node
      store.subscribe((config as any).email, listener);
      store.proxy.email.value = "hello";

      expect(listener).toHaveBeenCalled();
    });

    it("notifies dependent fields on change", () => {
      const config = makeConfig();
      const store = new Palistor({ config });
      const cardListener = vi.fn();

      store.subscribe((config as any).cardNumber, cardListener);
      // Changing paymentType → cardNumber.isVisible is recomputed → notification
      store.proxy.paymentType.value = "bank";

      expect(cardListener).toHaveBeenCalled();
    });

    it("unsubscribe works", () => {
      const config = makeConfig();
      const store = new Palistor({ config });
      const listener = vi.fn();

      const unsub = store.subscribe((config as any).email, listener);
      unsub();

      store.proxy.email.value = "hello";
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not notify when the computed state did not change", () => {
      const config = makeConfig();
      const store = new Palistor({ config });
      const issueDateListener = vi.fn();

      store.subscribe((config as any).passport.issueDate, issueDateListener);
      // issueDate doesn't depend on email; its state won't change
      store.proxy.email.value = "x";

      expect(issueDateListener).not.toHaveBeenCalled();
    });
  });

  describe("getValues", () => {
    it("returns a nested object with the values", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "test@test.com" } as any,
      });

      const values = store.getValues();
      expect(values.email).toBe("test@test.com");
      expect(values.paymentType).toBe("card");
      expect(values.passport.number).toBe("");
      expect(values.passport.issueDate).toBe("");
    });

    it("reflects changes after writes", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "updated";
      store.proxy.passport.number.value = "AB123";

      const values = store.getValues();
      expect(values.email).toBe("updated");
      expect(values.passport.number).toBe("AB123");
    });
  });

  describe("proxy caching", () => {
    it("the same path returns the same proxy", () => {
      const store = new Palistor({ config: makeConfig() });
      const p1 = store.proxy.passport;
      const p2 = store.proxy.passport;
      expect(p1).toBe(p2);
    });

    it("the config is not mutated", () => {
      const config = makeConfig();
      const originalValue = config.email.value;
      const store = new Palistor({ config });

      store.proxy.email.value = "mutated";
      expect(config.email.value).toBe(originalValue);
    });
  });

  describe("onValueChange", () => {
    it("sets value via onValueChange", () => {
      const store = new Palistor({ config: makeConfig() });

      store.proxy.email.onValueChange("hello@test.com");

      expect(store.proxy.email.value).toBe("hello@test.com");
      expect(store.getValues().email).toBe("hello@test.com");
    });

    it("onValueChange invokes the formatter", () => {
      const store = new Palistor({ config: makeConfig() });

      store.proxy.amount.onValueChange("42");

      expect(store.proxy.amount.value).toBe(42);
    });

    it("onValueChange triggers a recompute of dependent fields", () => {
      const store = new Palistor({ config: makeConfig() });

      expect(store.proxy.cardNumber.isVisible).toBe(true);
      expect(store.proxy.passport.isVisible).toBe(false);

      store.proxy.paymentType.onValueChange("bank");

      expect(store.proxy.cardNumber.isVisible).toBe(false);
      expect(store.proxy.passport.isVisible).toBe(true);
    });

    it("onValueChange invokes validate (when revalidate=true)", async () => {
      const store = new Palistor({ config: makeConfig() });

      // Trigger revalidate via failed submit
      await store.submit();

      store.proxy.email.onValueChange("valid@test.com");
      expect(store.proxy.email.isInvalid).toBeUndefined();

      store.proxy.email.onValueChange("");
      expect(store.proxy.email.isInvalid).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("onValueChange notifies subscribers", () => {
      const store = new Palistor({ config: makeConfig() });
      const listener = vi.fn();

      store.subscribeGlobal(listener);

      store.proxy.email.onValueChange("notify@test.com");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("onValueChange returns a stable reference", () => {
      const store = new Palistor({ config: makeConfig() });

      const fn1 = store.proxy.email.onValueChange;
      const fn2 = store.proxy.email.onValueChange;

      expect(fn1).toBe(fn2);
    });

    it("onValueChange works for nested fields", () => {
      const store = new Palistor({ config: makeConfig() });

      store.proxy.passport.number.onValueChange("AB123");

      expect(store.proxy.passport.number.value).toBe("AB123");
      expect(store.getValues().passport.number).toBe("AB123");
    });
  });

  describe("label as a function (translate)", () => {
    it("invokes the function for label", () => {
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
        },
      };
      const store = new Palistor({ config: config as any });
      // translate is identity for now → returns the key
      expect(store.proxy.name.label).toBe("form.name");
    });
  });

  describe("spread proxy ({...proxy})", () => {
    it("does not leak validate when spreading a leaf node", () => {
      const store = new Palistor({ config: makeConfig() });
      const spread = { ...store.proxy.cardNumber };

      // validate must not be in the spread
      expect(spread).not.toHaveProperty("validate");
      expect(spread).not.toHaveProperty("formatter");
      expect(spread).not.toHaveProperty("setter");
      expect(spread).not.toHaveProperty("dependencies");
      expect(spread).not.toHaveProperty("types");
    });

    it("spread contains all SPREADABLE_FIELD_STATE_PROPS and onValueChange", () => {
      const store = new Palistor({ config: makeConfig() });
      const spread = { ...store.proxy.email };

      expect(spread).toHaveProperty("value");
      expect(spread).toHaveProperty("label");
      expect(spread).toHaveProperty("isVisible");
      expect(spread).toHaveProperty("isRequired");
      expect(spread).toHaveProperty("isDisabled");
      expect(spread).toHaveProperty("isReadOnly");
      expect(spread).toHaveProperty("isInvalid");
      expect(spread).toHaveProperty("errorMessage");
      expect(spread).toHaveProperty("onValueChange");

      // dirty and loading are excluded from a leaf node's spread
      expect(spread).not.toHaveProperty("dirty");
      expect(spread).not.toHaveProperty("loading");
    });

    it("Object.keys contains no internal config keys", () => {
      const store = new Palistor({ config: makeConfig() });
      const keys = Object.keys(store.proxy.cardNumber);

      expect(keys).not.toContain("validate");
      expect(keys).not.toContain("formatter");
      expect(keys).not.toContain("setter");
      expect(keys).not.toContain("dependencies");
      expect(keys).toContain("value");
      expect(keys).toContain("onValueChange");
    });

    it("spreading a group node yields GROUP_SPREAD_KEYS", () => {
      const store = new Palistor({ config: makeConfig() });
      const keys = Object.keys(store.proxy.passport);

      // A group node spreads only service keys
      expect(keys).toContain("submitting");
      expect(keys).toContain("dirty");
      expect(keys).toContain("loading");
      expect(keys).toContain("submit");
      expect(keys).toContain("reset");

      // Child and internal keys stay out of the spread
      expect(keys).not.toContain("number");
      expect(keys).not.toContain("issueDate");
      expect(keys).not.toContain("validate");
      expect(keys).not.toContain("formatter");
    });

    it("validate runs after submit (not via spread)", async () => {
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
      const store = new Palistor({ config });

      // Before submit — errors are not computed
      expect(store.proxy.cardNumber.isInvalid).toBeUndefined();

      // After submit — revalidate=true → errors are visible
      await store.submit();
      expect(store.proxy.cardNumber.isInvalid).toBe(true);
      expect(store.proxy.cardNumber.errorMessage).toBe("required");

      // But it does NOT leak in a spread
      const spread = { ...store.proxy.cardNumber };
      expect(spread).not.toHaveProperty("validate");
    });
  });

  describe("computed values (value as a function)", () => {
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

    it("computes the initial computed value", () => {
      const store = new Palistor({ config: makeComputedConfig() });
      expect(store.proxy.total.value).toBe(100); // 100 * 1
    });

    it("recomputes the computed value when a dependency changes", () => {
      const store = new Palistor({ config: makeComputedConfig() });
      expect(store.proxy.total.value).toBe(100);

      store.proxy.quantity.value = 5;
      expect(store.proxy.total.value).toBe(500); // 100 * 5

      store.proxy.price.value = 200;
      expect(store.proxy.total.value).toBe(1000); // 200 * 5
    });

    it("the computed value is reflected in getValues()", () => {
      const store = new Palistor({ config: makeComputedConfig() });
      store.proxy.price.value = 50;
      store.proxy.quantity.value = 3;

      const values = store.getValues();
      expect(values.total).toBe(150); // 50 * 3
    });

    it("the computed value is exposed via isReadOnly", () => {
      const store = new Palistor({ config: makeComputedConfig() });
      expect(store.proxy.total.isReadOnly).toBe(true);
    });

    it("notifies subscribers when the computed value changes", () => {
      const config = makeComputedConfig();
      const store = new Palistor({ config });
      const listener = vi.fn();

      store.subscribe((config as any).total, listener);
      store.proxy.price.value = 200;

      expect(listener).toHaveBeenCalled();
    });

    it("computed chain: A → B → C", () => {
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
      const store = new Palistor({ config });
      expect(store.proxy.doubled.value).toBe(20);
      expect(store.proxy.quadrupled.value).toBe(40);

      store.proxy.base.value = 5;
      expect(store.proxy.doubled.value).toBe(10);
      expect(store.proxy.quadrupled.value).toBe(20);
    });

    it("initialValues overrides regular fields feeding computed ones", () => {
      const store = new Palistor({
        config: makeComputedConfig(),
        initialValues: { price: 50, quantity: 4 } as any,
      });
      // total is recomputed from the new price/quantity
      expect(store.proxy.total.value).toBe(200); // 50 * 4
    });
  });

  describe("setter (write side-effect)", () => {
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

    it("the setter resets another field's value on write", () => {
      const store = new Palistor({ config: makeSetterConfig() });
      expect(store.proxy.cardNumber.value).toBe("4111111111111111");

      store.proxy.paymentType.value = "bank";
      expect(store.proxy.paymentType.value).toBe("bank");
      expect(store.proxy.cardNumber.value).toBe(""); // reset by the setter
    });

    it("the setter does not touch unspecified fields", () => {
      const store = new Palistor({ config: makeSetterConfig() });
      store.proxy.bankAccount.value = "40817810099910004312";

      store.proxy.paymentType.value = "bank";
      // bankAccount is not in the patch → untouched
      expect(store.proxy.bankAccount.value).toBe("40817810099910004312");
    });

    it("setter + computed together", () => {
      const config = {
        price: { value: 100, dependencies: [] },
        quantity: {
          value: 1,
          dependencies: [],
          setter: (value: number) => {
            // Setting quantity > 10 automatically applies a discount
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
      const store = new Palistor({ config });
      expect(store.proxy.total.value).toBe(100); // 100 * 1

      store.proxy.quantity.value = 15;
      // the setter lowered price to 80, the computed recalculated total
      expect(store.proxy.price.value).toBe(80);
      expect(store.proxy.total.value).toBe(1200); // 80 * 15
    });

    it("setter for nested fields", () => {
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
      const store = new Palistor({ config });

      store.proxy.country.value = "us";
      expect(store.proxy.address.city.value).toBe("New York");
      expect(store.proxy.address.zip.value).toBe(""); // untouched
    });

    it("getValues reflects setter changes", () => {
      const store = new Palistor({ config: makeSetterConfig() });
      store.proxy.paymentType.value = "bank";

      const values = store.getValues();
      expect(values.paymentType).toBe("bank");
      expect(values.cardNumber).toBe("");
    });
  });

  // ─── Setter patch: subscriber notifications on a bulk update ─────────────

  describe("setter patch → subscriber notifications", () => {
    /**
     * A config where one field's setter (currency) patches several other
     * fields at once (symbol, decimals, nested prefix). Verifies that
     * subscribers of ALL affected fields get notified in one write cycle,
     * without a separate `.value = …` for each field.
     */
    const makePatchConfig = () => ({
      currency: {
        value: "USD" as string,
        label: "Currency",
        /**
         * setter: on a currency change — a single patch updates the symbol,
         * decimal count and the nested prefix. The setter thus *replaces*
         * the need to manually assign `.value = …` for each of those fields.
         */
        setter: (value: string) => {
          const presets: Record<string, { symbol: string; decimals: number; display: { prefix: string } }> = {
            USD: { symbol: "$", decimals: 2, display: { prefix: "US" } },
            EUR: { symbol: "€", decimals: 2, display: { prefix: "EU" } },
            BTC: { symbol: "₿", decimals: 8, display: { prefix: "BT" } },
          };
          const preset = presets[value] ?? presets.USD;
          // The patch is a nested object matching the config structure
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

    it("the setter patches several fields in one write — values updated", () => {
      const store = new Palistor({ config: makePatchConfig() });

      // Before the patch — the initial USD values
      expect(store.proxy.symbol.value).toBe("$");
      expect(store.proxy.decimals.value).toBe(2);
      expect(store.proxy.display.prefix.value).toBe("US");

      // One write → the setter returns a patch → all fields updated
      store.proxy.currency.value = "BTC";

      expect(store.proxy.currency.value).toBe("BTC");
      expect(store.proxy.symbol.value).toBe("₿");
      expect(store.proxy.decimals.value).toBe(8);
      expect(store.proxy.display.prefix.value).toBe("BT");
    });

    it("subscribers of ALL patched fields are notified in one cycle", () => {
      const config = makePatchConfig();
      const store = new Palistor({ config });

      // Subscribe to every field touched by the patch
      const symbolListener = vi.fn();
      const decimalsListener = vi.fn();
      const prefixListener = vi.fn();
      const currencyListener = vi.fn();

      store.subscribe((config as any).symbol, symbolListener);
      store.subscribe((config as any).decimals, decimalsListener);
      store.subscribe((config as any).display.prefix, prefixListener);
      store.subscribe((config as any).currency, currencyListener);

      // One write — the setter patches symbol, decimals, display.prefix
      store.proxy.currency.value = "EUR";

      // All subscribers must fire exactly once:
      // — currencyListener: the field's own value changed
      // — symbolListener:   updated by the setter patch ($ → €)
      // — decimalsListener: patched by the setter (2 → 2; recompute may skip
      //                     it when the value is unchanged — checked below)
      // — prefixListener:   updated by the setter patch (US → EU)
      expect(currencyListener).toHaveBeenCalledTimes(1);
      expect(symbolListener).toHaveBeenCalledTimes(1);
      expect(prefixListener).toHaveBeenCalledTimes(1);

      // decimals: 2 → 2 (unchanged) — the subscriber is NOT invoked,
      // because recomputeAll filters by fieldStateChanged
      expect(decimalsListener).not.toHaveBeenCalled();
    });

    it("the global subscriber is notified exactly once for a patch", () => {
      const store = new Palistor({ config: makePatchConfig() });
      const globalListener = vi.fn();

      store.subscribeGlobal(globalListener);
      store.proxy.currency.value = "BTC";

      // Even though the setter changed 3+ fields,
      // the global subscriber fires exactly once per write cycle
      expect(globalListener).toHaveBeenCalledTimes(1);
    });

    it("getValues reflects all setter-patch changes", () => {
      const store = new Palistor({ config: makePatchConfig() });
      store.proxy.currency.value = "EUR";

      const values = store.getValues();
      expect(values).toEqual({
        currency: "EUR",
        symbol: "€",
        decimals: 2,
        display: { prefix: "EU" },
      });
    });

    it("a setter patch does NOT require a separate .value = per field", () => {
      /**
       * The key scenario: the setter *replaces* the default multi-write
       * behavior. Instead of:
       *
       *   proxy.symbol.value = "₿";
       *   proxy.decimals.value = 8;
       *   proxy.display.prefix.value = "BT";
       *
       * a single write suffices — the setter does the rest:
       *
       *   proxy.currency.value = "BTC";
       */
      const config = makePatchConfig();
      const store = new Palistor({ config });

      // Subscribers counting invocations
      const symbolCalls = vi.fn();
      const decimalsCalls = vi.fn();
      const prefixCalls = vi.fn();

      store.subscribe((config as any).symbol, symbolCalls);
      store.subscribe((config as any).decimals, decimalsCalls);
      store.subscribe((config as any).display.prefix, prefixCalls);

      // One write replaces three — the setter patches everything at once
      store.proxy.currency.value = "BTC";

      // Values are correct
      expect(store.proxy.symbol.value).toBe("₿");
      expect(store.proxy.decimals.value).toBe(8);
      expect(store.proxy.display.prefix.value).toBe("BT");

      // Subscribers fired — the UI redraws the affected fields
      expect(symbolCalls).toHaveBeenCalled();
      expect(prefixCalls).toHaveBeenCalled();
      // decimals changed too (2 → 8) — the subscriber fired
      expect(decimalsCalls).toHaveBeenCalled();
    });

    it("the node version is bumped for every patched field", () => {
      const config = makePatchConfig();
      const store = new Palistor({ config });

      // Remember the initial versions
      const symbolV0 = store.getNodeVersion((config as any).symbol);
      const prefixV0 = store.getNodeVersion((config as any).display.prefix);

      store.proxy.currency.value = "BTC";

      // Versions must increase — meaning the field was touched
      expect(store.getNodeVersion((config as any).symbol)).toBeGreaterThan(symbolV0);
      expect(store.getNodeVersion((config as any).display.prefix)).toBeGreaterThan(prefixV0);
    });

    it("re-patching with the same values — subscribers are NOT invoked", () => {
      const config = makePatchConfig();
      const store = new Palistor({ config });

      // First time: USD → EUR
      store.proxy.currency.value = "EUR";

      const symbolListener = vi.fn();
      const prefixListener = vi.fn();

      store.subscribe((config as any).symbol, symbolListener);
      store.subscribe((config as any).display.prefix, prefixListener);

      // Second time: EUR → EUR (same values)
      store.proxy.currency.value = "EUR";

      // Values unchanged → recomputeAll won't include them in changed →
      // subscribers are NOT invoked (except currency itself, which is
      // always added to changed via changed.add(node))
      expect(symbolListener).not.toHaveBeenCalled();
      expect(prefixListener).not.toHaveBeenCalled();
    });
  });

  // ─── Translator (setTranslator / getTranslator) ───────────────────────────

  describe("setTranslator", () => {
    it("without a translator — a label function returns the key (identity fallback)", () => {
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
          placeholder: (t: (key: string) => string) => t("form.namePlaceholder"),
        },
      };
      const store = new Palistor({ config: config as any });
      expect(store.proxy.name.label).toBe("form.name");
      expect(store.proxy.name.placeholder).toBe("form.namePlaceholder");
    });

    it("after setTranslator — label resolves through the translator", () => {
      const translations: Record<string, string> = {
        "form.name": "Name",
        "form.namePlaceholder": "Enter your name",
        "form.desc": "Field description",
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
      const store = new Palistor({ config: config as any });

      store.setTranslator(t);

      expect(store.proxy.name.label).toBe("Name");
      expect(store.proxy.name.placeholder).toBe("Enter your name");
      expect(store.proxy.name.description).toBe("Field description");
    });

    it("setTranslator(null) reverts to the fallback (keys)", () => {
      const t = (key: string) => `[${key}]`;
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
        },
      };
      const store = new Palistor({ config: config as any });

      store.setTranslator(t);
      expect(store.proxy.name.label).toBe("[form.name]");

      store.setTranslator(null);
      expect(store.proxy.name.label).toBe("form.name"); // fallback to identity
    });

    it("setTranslator bumps the version and notifies subscribers", () => {
      const config = {
        name: {
          value: "",
          label: (t: (key: string) => string) => t("form.name"),
        },
      };
      const store = new Palistor({ config: config as any });
      const versionBefore = store.getVersion();

      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.setTranslator((key) => `translated:${key}`);

      expect(store.getVersion()).toBe(versionBefore + 1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("setTranslator with the same translator causes no extra notifications", () => {
      const t = (key: string) => key.toUpperCase();
      const config = {
        name: { value: "", label: (t: (key: string) => string) => t("form.name") },
      };
      const store = new Palistor({ config: config as any });

      store.setTranslator(t);
      const versionAfterFirst = store.getVersion();

      const listener = vi.fn();
      store.subscribeGlobal(listener);

      store.setTranslator(t); // same reference
      expect(store.getVersion()).toBe(versionAfterFirst); // no bump
      expect(listener).not.toHaveBeenCalled();
    });

    it("static string labels don't depend on the translator", () => {
      const config = {
        name: { value: "", label: "Static Label" },
      };
      const store = new Palistor({ config: config as any });

      store.setTranslator((key) => `translated:${key}`);
      // A static string is not called as a function
      expect(store.proxy.name.label).toBe("Static Label");
    });

    it("spread resolves label through the translator correctly", () => {
      const t = (key: string) => `[${key}]`;
      const config = {
        name: {
          value: "test",
          label: (t: (key: string) => string) => t("form.name"),
          placeholder: (t: (key: string) => string) => t("form.namePlaceholder"),
        },
      };
      const store = new Palistor({ config: config as any });
      store.setTranslator(t);

      const spread = { ...store.proxy.name };
      expect(spread.label).toBe("[form.name]");
      expect(spread.placeholder).toBe("[form.namePlaceholder]");
      expect(spread.value).toBe("test");
    });
  });
});
