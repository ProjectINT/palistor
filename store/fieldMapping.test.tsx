import { describe, it, expect, vi } from "vitest";
import { render, screen, act, renderHook } from "@testing-library/react";
import { Palistor } from "./store";
import { defineFieldMapping } from "./defineFieldMapping";
import { useForm } from "../react/useForm";

// ─── Тестовые конфиги ────────────────────────────────────────────────────────

/**
 * Конфиг в ЕДИНОМ ПУБЛИЧНОМ словаре карты `mapping` ниже (external-имена):
 * `required`, `disabled`, `helpText` вместо internal `isRequired`, `isDisabled`,
 * `description`. `value` / `label` картой не переименованы → пишутся как есть.
 * Нормализатор в конструкторе приведёт их к internal перед compute/init.
 */
const makeMappedConfig = () => ({
  email: {
    value: "",
    label: "Email",
    required: true,
    disabled: false,
    helpText: "Your email",
    validate: (v: string) => (!v ? "Email is required" : undefined),
    componentProps: { size: "lg" },
  },
  profile: {
    firstName: { value: "Jane", label: "First" },
  },
});

/**
 * Конфиг в INTERNAL-именах — для сценариев БЕЗ активного маппинга config-ключей
 * (пустая карта либо карта только по вычисляемым ключам dirty/loading, которые
 * в конфиге не пишутся).
 */
const makeConfig = () => ({
  email: {
    value: "",
    label: "Email",
    isRequired: true,
    isDisabled: false,
    description: "Your email",
    validate: (v: string) => (!v ? "Email is required" : undefined),
    componentProps: { size: "lg" },
  },
  profile: {
    firstName: { value: "Jane", label: "First" },
  },
});

const makeListConfig = () => ({
  users: [{ id: { value: "" }, name: { value: "" } }],
});

/**
 * Ant-Design-подобный маппинг (см. RFC).
 *
 * ВАЖНО: `defineFieldMapping` (а не `: FieldMapping` и не `satisfies FieldMapping`)
 * — чтобы TypeScript сохранил литеральные значения (`"required"`, …) и прокинул
 * их в тип `store.proxy`. Аннотация/`satisfies` расширили бы значения до `string`
 * и статическое переименование бы не сработало (рантайм при этом работает всегда).
 */
const mapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("fieldMapping", () => {
  describe("kernel — построение карт", () => {
    it("строит externalToInternal как обратную к fieldMapping", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      expect(store.fieldMapping).toBe(mapping);
      expect(store.externalToInternal).toEqual({
        required: "isRequired",
        disabled: "isDisabled",
        readOnly: "isReadOnly",
        error: "isInvalid",
        helperText: "errorMessage",
        helpText: "description",
      });
    });

    it("без fieldMapping обе карты пусты (нулевой оверхед)", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.fieldMapping).toEqual({});
      expect(store.externalToInternal).toEqual({});
    });
  });

  describe("strict — конфиг в external-именах (нормализация на входе)", () => {
    it("ingest видит external config-ключи: required питает валидацию", async () => {
      // required:true написан в конфиге в external-имени. Нормализатор → isRequired,
      // и это доходит до computeFieldState (не только до spread на выходе).
      const store = new Palistor({
        config: { email: { value: "", required: true } },
        fieldMapping: { isRequired: "required" },
      });
      // карта тут только isRequired→required, поэтому невалидность читаем
      // internal-именем isInvalid.
      expect((store.proxy.email as any).isInvalid).toBeFalsy(); // до submit revalidate=false
      await store.submit();
      expect((store.proxy.email as any).isInvalid).toBe(true); // required сработал на ingest-пути
    });

    it("ingest видит external disabled → FieldState.isDisabled", () => {
      const store = new Palistor({
        config: { email: { value: "", disabled: true } },
        fieldMapping: { isDisabled: "disabled" },
      });
      expect(store.proxy.email.disabled).toBe(true);
      expect((store.proxy.email as any).isDisabled).toBe(true);
    });

    it("strict: internal-имя config-ключа при активном маппинге → ошибка", () => {
      expect(
        () =>
          new Palistor({
            // `as any` — конфиг намеренно невалиден (internal-имя при активной карте);
            // здесь проверяем РАНТАЙМ-throw, а не тип (тип ловит это отдельно, см.
            // «config-валидатор ловит internal-имена»).
            config: { email: { value: "", isRequired: true } } as any,
            fieldMapping: { isRequired: "required" },
          }),
      ).toThrow(/write "required" instead of internal "isRequired"/);
    });

    it("strict: вычисляемый ключ (error) в конфиге → ошибка", () => {
      expect(
        () =>
          new Palistor({
            config: { email: { value: "", error: true } as any },
            fieldMapping: { isInvalid: "error" },
          }),
      ).toThrow(/computed/);
    });

    it("нормализатор не мутирует исходный конфиг", () => {
      const config = { email: { value: "", required: true } };
      new Palistor({ config, fieldMapping: { isRequired: "required" } });
      // оригинал остался в external-имени
      expect((config.email as any).required).toBe(true);
      expect((config.email as any).isRequired).toBeUndefined();
    });
  });

  describe("GET через source proxy", () => {
    it("external-имена возвращают вычисленное состояние поля (типизированно)", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      // Никаких `as any` — имена типизированы через captured TMapping.
      const required: boolean = store.proxy.email.required;
      const disabled: boolean = store.proxy.email.disabled;
      const helpText: string | undefined = store.proxy.email.helpText;
      expect(required).toBe(true);
      expect(disabled).toBe(false);
      expect(helpText).toBe("Your email");
    });

    it("internal-имена всё ещё читаются в рантайме (тип их скрывает)", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      // Рантайм-безопасность из RFC: старое имя резолвится штатным обработчиком.
      // На уровне типов имя скрыто → доступ через `any`.
      const email = store.proxy.email as any;
      expect(email.isRequired).toBe(true);
      expect(email.isDisabled).toBe(false);
      expect(email.description).toBe("Your email");
    });

    it("не указанные в карте ключи остаются как есть", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const value: string = store.proxy.email.value;
      const label: string | undefined = store.proxy.email.label;
      expect(value).toBe("");
      expect(label).toBe("Email");
      expect(typeof store.proxy.email.onValueChange).toBe("function");
    });

    it("error/helperText отражают валидацию после submit", async () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      // до submit revalidate=false → ошибок нет
      expect(store.proxy.email.error).toBeFalsy();
      expect(store.proxy.email.helperText).toBeUndefined();

      await store.submit();

      // external (типизированно)
      const error: boolean | undefined = store.proxy.email.error;
      const helperText: string | undefined = store.proxy.email.helperText;
      expect(error).toBe(true);
      expect(helperText).toBe("Email is required");
      // internal — то же значение читается в рантайме
      expect((store.proxy.email as any).isInvalid).toBe(true);
      expect((store.proxy.email as any).errorMessage).toBe("Email is required");
    });
  });

  describe("SET через source proxy", () => {
    it("запись value (не переименован) работает как обычно", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      store.proxy.email.value = "a@b.com";
      expect(store.proxy.email.value).toBe("a@b.com");
    });

    it("запись через переименованный value транслируется в internal (рантайм)", () => {
      const store = new Palistor({
        // value переименован в `val` → и в конфиге пишем `val`.
        config: { email: { val: "", label: "Email" } },
        fieldMapping: { value: "val" },
      });
      // Переименование самого `value` — экзотика (UI-киты зовут его `value`).
      // Рантайм работает; тип прокси-значения при ремапе `value` не выводится
      // (value структурен для type-derivation) → доступ через `any`.
      const email = store.proxy.email as any;
      email.val = "x@y.com";
      expect(email.val).toBe("x@y.com");
      expect((store.getValues() as any).email).toBe("x@y.com");
    });
  });

  describe("spread / ownKeys", () => {
    it("из spread видны только external-имена", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const keys = Object.keys({ ...store.proxy.email });

      expect(keys).toContain("required");
      expect(keys).toContain("disabled");
      expect(keys).toContain("helpText");
      // internal-имена исчезают из spread
      expect(keys).not.toContain("isRequired");
      expect(keys).not.toContain("isDisabled");
      expect(keys).not.toContain("description");
    });

    it("значения в spread корректны, componentProps-ключи сохраняются", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const spread = { ...store.proxy.email };
      expect(spread.required).toBe(true);
      expect(spread.helpText).toBe("Your email");
      expect(spread.value).toBe("");
      expect(spread.label).toBe("Email");
      // componentProps никогда не в карте — ключ проходит без переименования
      expect(Object.keys(spread)).toContain("size");
      expect(typeof spread.onValueChange).toBe("function");
    });

    it("группа: mappable-ключи (dirty/loading) проецируются в spread", () => {
      const store = new Palistor({
        config: makeConfig(),
        fieldMapping: { dirty: "isDirty", loading: "isLoading" },
      });
      const keys = Object.keys({ ...store.proxy.profile });
      expect(keys).toContain("isDirty");
      expect(keys).toContain("isLoading");
      expect(keys).not.toContain("dirty");
      expect(keys).not.toContain("loading");
      // не-mappable групповые ключи не трогаются
      expect(keys).toContain("submit");
      expect(keys).toContain("value");
    });

    it("группа: чтение переименованного dirty возвращает вычисленное состояние", () => {
      const store = new Palistor({
        config: makeConfig(),
        fieldMapping: { dirty: "isDirty" },
      });
      expect(store.proxy.profile.isDirty).toBe(false);
      // делаем группу dirty — переименованный ключ должен отразить это
      store.proxy.profile.firstName.value = "Changed";
      expect(store.proxy.profile.isDirty).toBe(true);
      // internal-имя по-прежнему доступно в рантайме
      expect((store.proxy.profile as any).dirty).toBe(true);
    });
  });

  describe("list proxy", () => {
    it("external-имена loading/dirty читаются и проецируются в spread", () => {
      const store = new Palistor({
        config: makeListConfig(),
        fieldMapping: { loading: "isLoading", dirty: "isDirty" },
      });
      const isLoading: boolean = store.proxy.users.isLoading;
      const isDirty: boolean = store.proxy.users.isDirty;
      expect(isLoading).toBe(false);
      expect(isDirty).toBe(false);

      const keys = Object.keys({ ...store.proxy.users });
      expect(keys).toContain("isLoading");
      expect(keys).toContain("isDirty");
      expect(keys).not.toContain("loading");
      expect(keys).not.toContain("dirty");
      // не-mappable ключи списка сохраняются
      expect(keys).toContain("items");
      expect(keys).toContain("add");
    });
  });

  describe("identity — пустой fieldMapping ≡ текущее поведение", () => {
    it("GET и spread идентичны отсутствию карты (типы не меняются)", () => {
      const store = new Palistor({ config: makeConfig() });
      // Без карты статический тип прежний: internal-имена доступны напрямую.
      const isRequired: boolean = store.proxy.email.isRequired;
      expect(isRequired).toBe(true);
      const keys = Object.keys({ ...store.proxy.email });
      expect(keys).toContain("isRequired");
      expect(keys).toContain("value");
      expect(keys).not.toContain("required");
    });
  });

  describe("статическая типизация (compile-time)", () => {
    it("external-имена типизированы, internal — скрыты", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });

      // external-имя присутствует в типе
      const required: boolean = store.proxy.email.required;
      expect(typeof required).toBe("boolean");

      // @ts-expect-error internal-имя переименовано → отсутствует в типе
      store.proxy.email.isRequired;

      // @ts-expect-error errorMessage переименован в helperText
      store.proxy.email.errorMessage;
    });

    it("useForm(store) сохраняет маппинг в типе", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));

      const required: boolean = result.current.email.required;
      expect(required).toBe(true);

      // @ts-expect-error internal-имя скрыто и в tracking proxy
      result.current.email.isRequired;
    });

    // Валидатор external-config (Phase 2). Проверки — только на уровне типов;
    // тело функции НЕ вызывается, поэтому рантайм-throw нормализатора не срабатывает.
    // (В репозитории нет type-test-раннера — валидируется через `tsc --noEmit`.)
    it("config-валидатор ловит internal-имена при активном маппинге", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      function _typeOnly() {
        // чистый external-конфиг — компилируется
        new Palistor({
          fieldMapping: mapping,
          config: { email: { value: "", required: true, helpText: "hi" } },
        });
        // internal-имя ремапленного ключа — ошибка типа
        new Palistor({
          fieldMapping: mapping,
          // @ts-expect-error write "required" instead of internal "isRequired"
          config: { email: { value: "", isRequired: true } },
        });
        // вложенная группа
        new Palistor({
          fieldMapping: mapping,
          config: {
            // @ts-expect-error write "disabled" instead of internal "isDisabled"
            passport: { number: { value: "", isDisabled: true } },
          },
        });
        // без маппинга internal-имена валидны
        new Palistor({ config: { email: { value: "", isRequired: true } } });
      }
      expect(typeof _typeOnly).toBe("function");
    });
  });

  describe("tracking proxy (useForm)", () => {
    it("external-имена читаются через tracking proxy (типизированно)", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));
      const required: boolean = result.current.email.required;
      const helpText: string | undefined = result.current.email.helpText;
      expect(required).toBe(true);
      expect(helpText).toBe("Your email");
    });

    it("spread через tracking proxy показывает только external", () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));
      const keys = Object.keys({ ...result.current.email });
      expect(keys).toContain("required");
      expect(keys).not.toContain("isRequired");
    });

    it("ре-рендерит компонент при изменении переименованного prop", async () => {
      const store = new Palistor({ config: makeMappedConfig(), fieldMapping: mapping });
      const renderCount = vi.fn();

      function Comp() {
        renderCount();
        const form = useForm(store);
        return <span data-testid="ht">{form.email.helperText ?? "—"}</span>;
      }

      render(<Comp />);
      expect(screen.getByTestId("ht").textContent).toBe("—");
      const before = renderCount.mock.calls.length;

      await act(async () => {
        await store.submit();
      });

      expect(screen.getByTestId("ht").textContent).toBe("Email is required");
      expect(renderCount.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
