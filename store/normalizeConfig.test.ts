import { describe, it, expect } from "vitest";
import { normalizeConfig } from "./normalizeConfig";
import { defineFieldMapping } from "./defineFieldMapping";
import { defineList } from "./defineList";
import type { FieldMapping } from "./store/types";

/** Строит обратную карту так же, как конструктор Palistor. */
function e2i(fwd: FieldMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const internal in fwd) {
    const external = fwd[internal as keyof FieldMapping];
    if (external !== undefined) out[external] = internal;
  }
  return out;
}

const fwd = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

describe("normalizeConfig", () => {
  it("пустая карта → возвращает исходный объект без копии (нулевой оверхед)", () => {
    const config = { email: { value: "", isRequired: true } };
    const result = normalizeConfig(config, {}, {});
    expect(result).toBe(config); // тот же референс
  });

  it("переименовывает external config-ключи в internal", () => {
    const config = {
      email: { value: "", label: "Email", required: true, disabled: false, helpText: "hi" },
    };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.email).toEqual({
      value: "",
      label: "Email",
      isRequired: true,
      isDisabled: false,
      description: "hi",
    });
  });

  it("не мутирует исходное дерево", () => {
    const config = { email: { value: "", required: true } };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect((config.email as any).required).toBe(true);
    expect((config.email as any).isRequired).toBeUndefined();
    expect(result.email.isRequired).toBe(true);
    expect(result).not.toBe(config);
  });

  it("рекурсирует во вложенные группы", () => {
    const config = {
      passport: {
        number: { value: "", required: true },
        issue: { value: "", disabled: true },
      },
    };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.passport.number).toEqual({ value: "", isRequired: true });
    expect(result.passport.issue).toEqual({ value: "", isDisabled: true });
  });

  it("нормализует шаблон list-узла (defineList и массив-форма)", () => {
    const typed = defineList<{ id: string; name: string }>({
      template: {
        id: { value: "" },
        name: { value: "", required: true } as any,
      },
      resolve: { resolver: async () => [] },
    });
    const config = { users: typed, products: [{ title: { value: "", disabled: true } }] };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    // defineList: [template, {resolve}]
    expect(result.users[0].name).toEqual({ value: "", isRequired: true });
    expect(result.users[1]).toHaveProperty("resolve");
    // массив-форма
    expect(result.products[0].title).toEqual({ value: "", isDisabled: true });
  });

  it("служебные ключи (validate/componentProps/resolve) не рекурсируются и не трогаются", () => {
    const validate = (v: string) => (v ? undefined : "req");
    const componentProps = { size: "lg" };
    const config = { email: { value: "", required: true, validate, componentProps } };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.email.validate).toBe(validate);
    expect(result.email.componentProps).toBe(componentProps); // тот же референс
    expect(result.email.isRequired).toBe(true);
  });

  it("dependencies (массив) в служебном ключе не принимается за list-узел", () => {
    const config = { city: { value: "", dependencies: ["country"] } };
    const result = normalizeConfig(config, e2i(fwd), fwd) as any;
    expect(result.city.dependencies).toEqual(["country"]);
  });

  it("rename value → leaf-detection не ломается (value присутствует)", () => {
    const vfwd = defineFieldMapping({ value: "val" });
    const config = { email: { val: "x", label: "Email" } };
    const result = normalizeConfig(config, e2i(vfwd), vfwd) as any;
    expect(result.email).toEqual({ value: "x", label: "Email" });
    expect("value" in result.email).toBe(true);
  });

  it("strict: internal-имя активно ремапленного config-ключа → бросает", () => {
    const config = { email: { value: "", isRequired: true } };
    expect(() => normalizeConfig(config, e2i(fwd), fwd)).toThrow(
      /write "required" instead of internal "isRequired"/,
    );
  });

  it("strict: вычисляемый ключ (error/helperText) в конфиге → бросает", () => {
    const config = { email: { value: "", error: true } };
    expect(() => normalizeConfig(config, e2i(fwd), fwd)).toThrow(/computed/);
  });

  it("output-only ключи, НЕ написанные в конфиге, не мешают (dirty/loading карта)", () => {
    const dfwd = defineFieldMapping({ dirty: "isDirty", loading: "isLoading" });
    const config = { email: { value: "", isRequired: true, description: "d" } };
    // isRequired/description здесь НЕ ремапятся (карта только по dirty/loading) →
    // internal-имена остаются валидными, ошибки нет.
    const result = normalizeConfig(config, e2i(dfwd), dfwd) as any;
    expect(result.email).toEqual({ value: "", isRequired: true, description: "d" });
  });
});
