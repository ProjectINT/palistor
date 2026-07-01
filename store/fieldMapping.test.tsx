import { describe, it, expect, vi } from "vitest";
import { render, screen, act, renderHook } from "@testing-library/react";
import { Palistor } from "./store";
import { defineFieldMapping } from "./defineFieldMapping";
import { useForm } from "../react/useForm";

// ─── Тестовый конфиг ─────────────────────────────────────────────────────────

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
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
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

  describe("GET через source proxy", () => {
    it("external-имена возвращают вычисленное состояние поля (типизированно)", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      // Никаких `as any` — имена типизированы через captured TMapping.
      const required: boolean = store.proxy.email.required;
      const disabled: boolean = store.proxy.email.disabled;
      const helpText: string | undefined = store.proxy.email.helpText;
      expect(required).toBe(true);
      expect(disabled).toBe(false);
      expect(helpText).toBe("Your email");
    });

    it("internal-имена всё ещё читаются в рантайме (тип их скрывает)", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      // Рантайм-безопасность из RFC: старое имя резолвится штатным обработчиком.
      // На уровне типов имя скрыто → доступ через `any`.
      const email = store.proxy.email as any;
      expect(email.isRequired).toBe(true);
      expect(email.isDisabled).toBe(false);
      expect(email.description).toBe("Your email");
    });

    it("не указанные в карте ключи остаются как есть", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      const value: string = store.proxy.email.value;
      const label: string | undefined = store.proxy.email.label;
      expect(value).toBe("");
      expect(label).toBe("Email");
      expect(typeof store.proxy.email.onValueChange).toBe("function");
    });

    it("error/helperText отражают валидацию после submit", async () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
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
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      store.proxy.email.value = "a@b.com";
      expect(store.proxy.email.value).toBe("a@b.com");
    });

    it("запись через переименованный value транслируется в internal (типизированно)", () => {
      const store = new Palistor({
        config: makeConfig(),
        fieldMapping: { value: "val" },
      });
      // `val` типизирован как записываемое свойство (перенос геттера/сеттера value).
      store.proxy.email.val = "x@y.com";
      const val: string = store.proxy.email.val;
      expect(val).toBe("x@y.com");
      expect((store.getValues() as any).email).toBe("x@y.com");
    });
  });

  describe("spread / ownKeys", () => {
    it("из spread видны только external-имена", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
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
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
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
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });

      // external-имя присутствует в типе
      const required: boolean = store.proxy.email.required;
      expect(typeof required).toBe("boolean");

      // @ts-expect-error internal-имя переименовано → отсутствует в типе
      store.proxy.email.isRequired;

      // @ts-expect-error errorMessage переименован в helperText
      store.proxy.email.errorMessage;
    });

    it("useForm(store) сохраняет маппинг в типе", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));

      const required: boolean = result.current.email.required;
      expect(required).toBe(true);

      // @ts-expect-error internal-имя скрыто и в tracking proxy
      result.current.email.isRequired;
    });
  });

  describe("tracking proxy (useForm)", () => {
    it("external-имена читаются через tracking proxy (типизированно)", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));
      const required: boolean = result.current.email.required;
      const helpText: string | undefined = result.current.email.helpText;
      expect(required).toBe(true);
      expect(helpText).toBe("Your email");
    });

    it("spread через tracking proxy показывает только external", () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
      const { result } = renderHook(() => useForm(store));
      const keys = Object.keys({ ...result.current.email });
      expect(keys).toContain("required");
      expect(keys).not.toContain("isRequired");
    });

    it("ре-рендерит компонент при изменении переименованного prop", async () => {
      const store = new Palistor({ config: makeConfig(), fieldMapping: mapping });
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
