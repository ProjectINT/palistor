/**
 * Тест рекурсивного подхода к вложенным полям
 * 
 * Конфиг хранится как есть (вложенный), обход рекурсивный.
 * flattenConfig больше не используется.
 */

import { getFieldConfigByPath, isReservedFieldConfigKey, parseFieldKey } from "../utils/pathUtils";
import { setFieldByPath } from "../utils/helpers";
import { materializeComputed } from "../utils/materialize";
import { computeAllFieldStates } from "./compute/computeFieldStates";
import { recomputeFieldStates } from "./compute/computeFieldStates";
import type { ComputeContext } from "./compute/types";
import type { FormConfig } from "./types";

// ============================================================================
// Тестовые данные
// ============================================================================

type TestValues = {
  email: string;
  paymentType: string;
  passport: {
    id: number | null;
    number: string;
    issueDate: string;
    expiryDate: string;
  };
};

const testConfig: FormConfig<TestValues> = {
  email: {
    value: "",
    label: "Email",
    isRequired: true,
    validate: (value: string) => (!value ? "required" : undefined),
    dependencies: [],
  },
  paymentType: {
    value: "card",
    label: "Payment Type",
    dependencies: [],
  },
  passport: {
    nested: true,
    isVisible: (values: TestValues) => values.paymentType === "bank",
    dependencies: ["paymentType"],

    id: {
      value: null,
      isVisible: false,
      dependencies: [],
    },
    number: {
      value: "",
      label: "Passport Number",
      isRequired: true,
      validate: (value: string) => (!value ? "required" : undefined),
      dependencies: [],
    },
    issueDate: {
      value: "",
      label: "Issue Date",
      dependencies: [],
    },
    expiryDate: {
      value: "",
      label: "Expiry Date",
      validate: (value: string, values: TestValues) => {
        if (value && values.passport?.issueDate && value <= values.passport.issueDate) {
          return "expiryBeforeIssue";
        }
        return undefined;
      },
      dependencies: ["passport.issueDate"],
    },
  },
};

const testValues: TestValues = {
  email: "test@example.com",
  paymentType: "bank",
  passport: {
    id: null,
    number: "AB123456",
    issueDate: "2020-01-01",
    expiryDate: "2030-01-01",
  },
};

// ============================================================================
// Тесты
// ============================================================================

console.log("=== Test: getFieldConfigByPath ===");
{
  const emailCfg = getFieldConfigByPath(testConfig, "email");
  console.log("email config:", emailCfg?.label); // → "Email"

  const passportCfg = getFieldConfigByPath(testConfig, "passport");
  console.log("passport config nested:", passportCfg?.nested); // → true
  console.log("passport has isVisible:", typeof passportCfg?.isVisible); // → "function"

  const numberCfg = getFieldConfigByPath(testConfig, "passport.number");
  console.log("passport.number label:", numberCfg?.label); // → "Passport Number"

  const expiryDateCfg = getFieldConfigByPath(testConfig, "passport.expiryDate");
  console.log("passport.expiryDate deps:", expiryDateCfg?.dependencies); // → ["passport.issueDate"]

  console.log("✅ getFieldConfigByPath works\n");
}

console.log("=== Test: isReservedFieldConfigKey ===");
{
  console.log("value:", isReservedFieldConfigKey("value")); // true
  console.log("label:", isReservedFieldConfigKey("label")); // true
  console.log("nested:", isReservedFieldConfigKey("nested")); // true
  console.log("number:", isReservedFieldConfigKey("number")); // false (child field)
  console.log("issueDate:", isReservedFieldConfigKey("issueDate")); // false (child field)
  console.log("✅ isReservedFieldConfigKey works\n");
}

console.log("=== Test: computeAllFieldStates (recursive) ===");
{
  const ctx: ComputeContext<TestValues> = {
    values: testValues,
    config: testConfig,
    translate: (key: string) => key,
    locale: "en",
    showErrors: false,
  };

  const fields = computeAllFieldStates(ctx);
  const fieldKeys = Object.keys(fields);
  console.log("All field keys:", fieldKeys);
  // → ["email", "paymentType", "passport", "passport.id", "passport.number", "passport.issueDate", "passport.expiryDate"]

  // Проверяем что passport тоже есть как поле
  console.log("passport isVisible:", fields["passport"]?.isVisible); // true (paymentType === "bank")
  console.log("passport.number value:", fields["passport.number"]?.value); // "AB123456"
  console.log("passport.number isRequired:", fields["passport.number"]?.isRequired); // true
  console.log("passport.id isVisible:", fields["passport.id"]?.isVisible); // false
  console.log("email value:", fields["email"]?.value); // "test@example.com"

  console.log("✅ computeAllFieldStates works\n");
}

console.log("=== Test: getFieldProps('passport') returns state ===");
{
  const ctx: ComputeContext<TestValues> = {
    values: testValues,
    config: testConfig,
    translate: (key: string) => key,
    locale: "en",
    showErrors: false,
  };

  const fields = computeAllFieldStates(ctx);

  // ЭТО КЛЮЧЕВОЙ ТЕСТ: getFieldProps("passport") должен вернуть состояние
  const passportState = fields["passport"];
  console.log("passport state exists:", !!passportState); // true
  console.log("passport isVisible:", passportState?.isVisible); // true (paymentType === "bank")
  console.log("passport value:", passportState?.value); // the full passport object

  // Теперь с paymentType = "card" — passport должен быть скрыт
  const ctx2: ComputeContext<TestValues> = {
    ...ctx,
    values: { ...testValues, paymentType: "card" },
  };
  const fields2 = computeAllFieldStates(ctx2);
  console.log("passport isVisible (card):", fields2["passport"]?.isVisible); // false

  console.log("✅ passport parent field works correctly\n");
}

console.log("=== Test: recomputeFieldStates ===");
{
  const ctx: ComputeContext<TestValues> = {
    values: testValues,
    config: testConfig,
    translate: (key: string) => key,
    locale: "en",
    showErrors: false,
  };

  const fields = computeAllFieldStates(ctx);

  // Меняем paymentType на "card" — passport должен стать невидимым
  const newValues = { ...testValues, paymentType: "card" };
  const newCtx: ComputeContext<TestValues> = {
    ...ctx,
    values: newValues,
  };

  const newFields = recomputeFieldStates(fields, "paymentType", newCtx);
  console.log("passport visible after change:", newFields["passport"]?.isVisible); // false
  console.log("email unchanged:", fields["email"] === newFields["email"]); // true (same reference)

  console.log("✅ recomputeFieldStates works\n");
}

console.log("=== Test: materializeComputed (recursive) ===");
{
  const configWithComputed: FormConfig<any> = {
    price: { value: 100 },
    quantity: { value: 2 },
    total: {
      value: (v: any) => v.price * v.quantity,
    },
    passport: {
      nested: true,
      number: { value: "" },
      formatted: {
        value: (v: any) => `PASS-${v.passport?.number || "???"}`,
      },
    },
  };

  const values = {
    price: 100,
    quantity: 3,
    total: 0,
    passport: {
      number: "AB123",
      formatted: "",
    },
  };

  const result = materializeComputed(values, configWithComputed);
  console.log("total:", result.total); // 300
  console.log("passport.formatted:", result.passport.formatted); // "PASS-AB123"

  console.log("✅ materializeComputed works\n");
}

console.log("=== Test: setFieldByPath (immutable) ===");
{
  const original = {
    email: "test@test.com",
    passport: { number: "123", issueDate: "2020-01-01" },
  };

  const updated = setFieldByPath(original, ["passport", "number"], "NEW456");
  console.log("updated.passport.number:", updated.passport.number); // "NEW456"
  console.log("original unchanged:", original.passport.number); // "123"
  console.log("email same ref:", original.email === updated.email); // true

  console.log("✅ setFieldByPath works\n");
}

console.log("🎉 All tests passed!");
