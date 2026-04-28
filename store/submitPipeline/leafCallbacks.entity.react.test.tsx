/**
 * Entity-leaf callbacks on React components — зеркало leafCallbacks.react.test.tsx
 *
 * Покрывает onChange и onSubmit на entity-листовом узле через реальные React-компоненты.
 * Форма получается через useForm(entityProxy, (s) => s.editTemplate).
 *
 * onChange (fire-and-forget):
 *   L-1: onChange срабатывает при записи value entity-листа и обновляет соседнее поле (patch)
 *   L-2: onChange получает {fieldKey, newValue, previousValue, allValues}
 *   L-5: onChange НЕ вызывается при submit() entity-листа
 *
 * onSubmit (full pipeline via proxy.field.submit()):
 *   L-6: onSubmit получает (value, store, entityParentProxy) при submit на entity-листе
 *   L-7: submitting флаг виден в компоненте во время submit pipeline на entity-листе
 *   L-8: validate блокирует submit entity-листа, errorMessage доступен
 *   L-9: afterSubmit вызывается с результатом и reset-экшеном на entity-листе
 *   L-10: parent.id и parent.<sibling>.value доступны в onSubmit entity-листа
 *   L-11: onChange и onSubmit на одном template-поле независимы
 *
 * Дополнительно:
 *   setter на entity-листе патчит соседний entity-лист (зеркало runSetter)
 *   beforeSubmit трансформирует value до onSubmit
 *   isRequired/isDisabled вычисляются из entity-сиблингов через allValues
 *   formatter применяется из template rules при записи
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Palistor } from "../store/palistor";
import { useForm } from "../../react/useForm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Setup helper: create store with entity + list + template ─────────────────

function makeStore<T extends Record<string, any>>(
  editTemplate: T,
  entityData: Record<string, any>,
) {
  const store = new Palistor({
    config: {
      users: [{ id: { value: "" } }],
      editTemplate,
    } as any,
  });
  store.set(entityData);
  (store.proxy as any).users.add(entityData.id);
  return store;
}

// ═════════════════════════════════════════════════════════════════════════════
// L-1: onChange обновляет соседнее поле через patch (entity mode)
// ═════════════════════════════════════════════════════════════════════════════

describe("L-1 entity: onChange обновляет соседнее поле через patch", () => {
  it("запись country entity-листа обновляет city через patch, возвращённый из onChange", async () => {
    const editTemplate = {
      id: { value: "" },
      country: {
        value: "",
        onChange: async ({ newValue }: { newValue: string }) => {
          return { city: newValue === "RU" ? "Москва" : "Unknown" };
        },
      },
      city: { value: "" },
    };

    const store = makeStore(editTemplate, { id: "e1", country: "US", city: "New York" });

    function LocationForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <input
            data-testid="country"
            value={form.country.value}
            onChange={(e) => { form.country.value = e.target.value; }}
          />
          <span data-testid="city">{form.city.value}</span>
        </div>
      );
    }

    render(<LocationForm />);

    expect(screen.getByTestId("city").textContent).toBe("New York");

    await act(async () => {
      await userEvent.clear(screen.getByTestId("country"));
      await userEvent.type(screen.getByTestId("country"), "RU");
      await flushPromises();
    });

    expect(screen.getByTestId("city").textContent).toBe("Москва");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-5: onChange НЕ вызывается при submit() entity-листа
// ═════════════════════════════════════════════════════════════════════════════

describe("L-5 entity: onChange не срабатывает при вызове submit() на entity-листе", () => {
  it("после submit() entity-листа onChange не вызван", async () => {
    const onChangeSpy = vi.fn();

    const editTemplate = {
      id: { value: "" },
      isActive: {
        value: true,
        onChange: onChangeSpy,
        onSubmit: vi.fn(),
      },
    };

    const store = makeStore(editTemplate, { id: "e1", isActive: true });

    function ToggleForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <button
          data-testid="submit-btn"
          onClick={() => form.isActive.submit()}
        >
          Save
        </button>
      );
    }

    render(<ToggleForm />);

    await act(async () => {
      screen.getByTestId("submit-btn").click();
      await flushPromises();
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-6: onSubmit получает (value, store, entityParentProxy)
// ═════════════════════════════════════════════════════════════════════════════

describe("L-6 entity: onSubmit получает корректные аргументы при submit на entity-листе", () => {
  it("onSubmit(value, store, entityParentProxy) — все аргументы переданы", async () => {
    const onSubmitSpy = vi.fn();

    const editTemplate = {
      id: { value: "" },
      isActive: {
        value: false,
        onSubmit: onSubmitSpy,
      },
      name: { value: "" },
    };

    const store = makeStore(editTemplate, { id: "e1", isActive: false, name: "Alice" });

    function UserRow() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <input
            data-testid="toggle"
            type="checkbox"
            checked={form.isActive.value}
            onChange={(e) => { form.isActive.value = e.target.checked; }}
          />
          <button
            data-testid="save-btn"
            onClick={() => form.isActive.submit()}
          >
            Save
          </button>
        </div>
      );
    }

    render(<UserRow />);

    await act(async () => {
      screen.getByTestId("toggle").click();
    });

    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(onSubmitSpy).toHaveBeenCalledWith(
      true,            // value — текущее значение entity-листа
      store,           // store — экземпляр Palistor
      expect.anything(), // entityParentProxy — entity projection proxy
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-7: submitting флаг виден в компоненте во время submit pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe("L-7 entity: submitting флаг отображается на entity-листе во время submit pipeline", () => {
  it("submitting=true пока pipeline выполняется, false после завершения", async () => {
    let resolveSubmit!: () => void;

    const editTemplate = {
      id: { value: "" },
      toggle: {
        value: true,
        onSubmit: () => new Promise<void>((r) => { resolveSubmit = r; }),
      },
    };

    const store = makeStore(editTemplate, { id: "e1", toggle: true });

    function ToggleForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <span data-testid="submitting">
            {form.toggle.submitting ? "saving" : "idle"}
          </span>
          <button
            data-testid="save-btn"
            onClick={() => form.toggle.submit()}
          >
            Save
          </button>
        </div>
      );
    }

    render(<ToggleForm />);

    expect(screen.getByTestId("submitting").textContent).toBe("idle");

    // Запускаем submit — pipeline зависает на resolveSubmit
    act(() => { screen.getByTestId("save-btn").click(); });

    await waitFor(() => {
      expect(screen.getByTestId("submitting").textContent).toBe("saving");
    });

    // Завершаем pipeline
    await act(async () => {
      resolveSubmit();
      await flushPromises();
    });

    expect(screen.getByTestId("submitting").textContent).toBe("idle");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-8: validate блокирует submit entity-листа — onSubmit не вызывается
// ═════════════════════════════════════════════════════════════════════════════

describe("L-8 entity: валидация блокирует submit — onSubmit не вызывается, errorMessage доступен", () => {
  it("пустой email entity-листа → submit возвращает errors, onSubmit не вызывается", async () => {
    const onSubmitSpy = vi.fn();
    let submitResult: any;

    const editTemplate = {
      id: { value: "" },
      email: {
        value: "",
        validate: (v: string) => (!v ? "Email обязателен" : undefined),
        onSubmit: onSubmitSpy,
      },
    };

    const store = makeStore(editTemplate, { id: "e1", email: "" });

    function EmailForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <input
            data-testid="email"
            value={form.email.value}
            onChange={(e) => { form.email.value = e.target.value; }}
          />
          {form.email.isInvalid && (
            <span data-testid="error">{form.email.errorMessage}</span>
          )}
          <button
            data-testid="save-btn"
            onClick={async () => {
              submitResult = await form.email.submit();
            }}
          >
            Save
          </button>
        </div>
      );
    }

    render(<EmailForm />);

    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(submitResult.success).toBe(false);
    expect(submitResult.errors[0].message).toBe("Email обязателен");
    expect(onSubmitSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("Email обязателен");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-9: afterSubmit вызывается после onSubmit с результатом и reset-экшеном
// ═════════════════════════════════════════════════════════════════════════════

describe("L-9 entity: afterSubmit получает результат onSubmit и может сбросить entity-лист", () => {
  it("afterSubmit вызван с результатом, reset сбрасывает entity-лист к начальному значению", async () => {
    const afterSubmitSpy = vi.fn((_result: unknown, { reset }: { reset: () => void }) => {
      reset();
    });

    const editTemplate = {
      id: { value: "" },
      notes: {
        value: "",
        onSubmit: async (v: string) => `saved:${v}`,
        afterSubmit: afterSubmitSpy,
      },
    };

    // Entity initial notes = "" (this becomes the reset target)
    const store = makeStore(editTemplate, { id: "e1", notes: "" });

    function NotesForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <input
            data-testid="notes"
            value={form.notes.value}
            onChange={(e) => { form.notes.value = e.target.value; }}
          />
          <button
            data-testid="save-btn"
            onClick={() => form.notes.submit()}
          >
            Save
          </button>
        </div>
      );
    }

    render(<NotesForm />);

    await act(async () => {
      await userEvent.type(screen.getByTestId("notes"), "Hello world");
    });
    expect(screen.getByTestId("notes").getAttribute("value")).toBe("Hello world");

    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(afterSubmitSpy).toHaveBeenCalledWith(
      "saved:Hello world",
      { reset: expect.any(Function) },
    );

    // reset() внутри afterSubmit сбрасывает entity-лист к начальному значению ""
    await waitFor(() => {
      expect(screen.getByTestId("notes").getAttribute("value")).toBe("");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-10: parent.id и parent.<sibling>.value доступны в onSubmit entity-листа
// ═════════════════════════════════════════════════════════════════════════════

describe("L-10 entity: parent proxy и store.context доступны в onSubmit entity-листа", () => {
  it("onSubmit читает parent.id, parent.name.value и store.context.accountId", async () => {
    const capturedArgs: { entityId: string; nameValue: string; accountId: string } = {
      entityId: "",
      nameValue: "",
      accountId: "",
    };

    const editTemplate = {
      id: { value: "" },
      isActive: {
        value: false,
        onSubmit: async (
          _value: unknown,
          storeArg: any,
          parent: any,
        ) => {
          capturedArgs.entityId = parent.id;
          capturedArgs.nameValue = parent.name.value;
          capturedArgs.accountId = storeArg.context.accountId;
        },
      },
      name: { value: "" },
    };

    const store = makeStore(editTemplate, { id: "u1", isActive: false, name: "Bob" });
    store.setContext({ accountId: "tenant-99" });

    function UserStatusRow() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <span data-testid="name">{form.name.value}</span>
          <button
            data-testid="activate-btn"
            onClick={async () => {
              form.isActive.value = true;
              await form.isActive.submit();
            }}
          >
            Activate
          </button>
        </div>
      );
    }

    render(<UserStatusRow />);

    await act(async () => {
      screen.getByTestId("activate-btn").click();
      await flushPromises();
    });

    expect(capturedArgs.entityId).toBe("u1");
    expect(capturedArgs.nameValue).toBe("Bob");
    expect(capturedArgs.accountId).toBe("tenant-99");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-11: onChange и onSubmit на одном template-поле независимы
// ═════════════════════════════════════════════════════════════════════════════

describe("L-11 entity: onChange и onSubmit на одном template-поле работают независимо", () => {
  it("запись value вызывает только onChange; submit() вызывает только onSubmit", async () => {
    const onChangeSpy = vi.fn().mockResolvedValue(undefined);
    const onSubmitSpy = vi.fn().mockResolvedValue("done");

    const editTemplate = {
      id: { value: "" },
      priority: {
        value: "normal",
        onChange: onChangeSpy,
        onSubmit: onSubmitSpy,
      },
      urgencyLabel: { value: "" },
    };

    const store = makeStore(editTemplate, { id: "e1", priority: "normal", urgencyLabel: "" });

    function PriorityCard() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <select
            data-testid="priority"
            value={form.priority.value}
            onChange={(e) => { form.priority.value = e.target.value; }}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <button
            data-testid="save-btn"
            onClick={() => form.priority.submit()}
          >
            Save
          </button>
        </div>
      );
    }

    render(<PriorityCard />);

    // Изменяем значение → только onChange
    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "high");
      await flushPromises();
    });

    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onSubmitSpy).not.toHaveBeenCalled();

    onChangeSpy.mockClear();

    // Нажимаем Save → только onSubmit
    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(onSubmitSpy).toHaveBeenCalledTimes(1);
    expect(onSubmitSpy).toHaveBeenCalledWith("high", store, expect.anything());
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Дополнительно: setter на entity-листе патчит соседний entity-лист
// ═════════════════════════════════════════════════════════════════════════════

describe("entity setter: запись поля с setter патчит соседний entity-лист", () => {
  it("запись priority с setter обновляет urgencyLabel сиблинга", async () => {
    const editTemplate = {
      id: { value: "" },
      priority: {
        value: "normal",
        setter: (v: string) => ({ urgencyLabel: v === "high" ? "!" : "" }),
      },
      urgencyLabel: { value: "" },
    };

    const store = makeStore(editTemplate, { id: "e1", priority: "normal", urgencyLabel: "" });

    function PriorityForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <select
            data-testid="priority"
            value={form.priority.value}
            onChange={(e) => { form.priority.value = e.target.value; }}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <span data-testid="urgency">{form.urgencyLabel.value}</span>
        </div>
      );
    }

    render(<PriorityForm />);

    expect(screen.getByTestId("urgency").textContent).toBe("");

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "high");
      await flushPromises();
    });

    expect(screen.getByTestId("urgency").textContent).toBe("!");

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "normal");
      await flushPromises();
    });

    expect(screen.getByTestId("urgency").textContent).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-2 entity: onChange получает {fieldKey, newValue, previousValue, allValues}
// ═════════════════════════════════════════════════════════════════════════════

describe("L-2 entity: onChange коллбэк вызывается с полным контекстом изменения", () => {
  it("onChange получает fieldKey, newValue, previousValue, allValues из entity", async () => {
    const calls: any[] = [];

    const editTemplate = {
      id: { value: "" },
      score: {
        value: 0,
        onChange: (args: any) => { calls.push(args); },
      },
      bonus: { value: 0 },
    };

    const store = makeStore(editTemplate, { id: "e1", score: 5, bonus: 10 });

    function ScoreForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <input
          data-testid="score"
          value={form.score.value}
          onChange={(e) => { form.score.value = Number(e.target.value); }}
        />
      );
    }

    render(<ScoreForm />);

    // Single change: 5 → 99
    await act(async () => {
      await userEvent.clear(screen.getByTestId("score"));
      await userEvent.type(screen.getByTestId("score"), "99");
      await flushPromises();
    });

    // The first onChange call carries previousValue=5 (original entity value)
    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0];
    expect(firstCall.previousValue).toBe(5);
    expect(firstCall.allValues).toMatchObject({ bonus: 10 });
    expect(firstCall.fieldKey).toBe("score");

    // The last call reflects the final written value (99)
    const lastCall = calls[calls.length - 1];
    expect(lastCall.newValue).toBe(99);
    expect(lastCall.allValues).toMatchObject({ score: 99, bonus: 10 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// beforeSubmit на entity-листе трансформирует value до onSubmit
// ═════════════════════════════════════════════════════════════════════════════

describe("entity beforeSubmit: трансформирует value перед onSubmit", () => {
  it("beforeSubmit возвращает trimmed value — onSubmit получает уже обработанное значение", async () => {
    const onSubmitSpy = vi.fn();

    const editTemplate = {
      id: { value: "" },
      name: {
        value: "",
        beforeSubmit: (v: string) => v.trim(),
        onSubmit: onSubmitSpy,
      },
    };

    const store = makeStore(editTemplate, { id: "e1", name: "  Alice  " });

    function NameForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <button
          data-testid="save-btn"
          onClick={() => form.name.submit()}
        >
          Save
        </button>
      );
    }

    render(<NameForm />);

    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(onSubmitSpy).toHaveBeenCalledWith(
      "Alice",   // trimmed by beforeSubmit
      store,
      expect.anything(),
    );
  });

  it("beforeSubmit получает parentValues с текущими entity-сиблингами", async () => {
    let capturedParentValues: Record<string, unknown> | null = null;

    const editTemplate = {
      id: { value: "" },
      discount: {
        value: 0,
        beforeSubmit: (v: unknown, parentValues: Record<string, unknown>) => {
          capturedParentValues = parentValues;
          return v;
        },
        onSubmit: vi.fn(),
      },
      basePrice: { value: 0 },
    };

    const store = makeStore(editTemplate, { id: "e1", discount: 10, basePrice: 100 });

    function PriceForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <button
          data-testid="save-btn"
          onClick={() => form.discount.submit()}
        >
          Save
        </button>
      );
    }

    render(<PriceForm />);

    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(capturedParentValues).toMatchObject({ discount: 10, basePrice: 100 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// isRequired / isDisabled вычисляются из entity-сиблингов через allValues
// ═════════════════════════════════════════════════════════════════════════════

describe("entity computed flags: isRequired/isDisabled из entity-сиблинговых значений", () => {
  it("isRequired(allValues) → true когда флаг-сиблинг включён", async () => {
    const editTemplate = {
      id: { value: "" },
      requiresComment: { value: false },
      comment: {
        value: "",
        isRequired: (vals: any) => vals.requiresComment === true,
      },
    };

    const store = makeStore(editTemplate, { id: "e1", requiresComment: false, comment: "" });

    function FlagForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <span data-testid="required">{form.comment.isRequired ? "yes" : "no"}</span>
          <input
            data-testid="flag"
            type="checkbox"
            checked={form.requiresComment.value}
            onChange={(e) => { form.requiresComment.value = e.target.checked; }}
          />
        </div>
      );
    }

    render(<FlagForm />);

    expect(screen.getByTestId("required").textContent).toBe("no");

    await act(async () => {
      screen.getByTestId("flag").click();
      await flushPromises();
    });

    expect(screen.getByTestId("required").textContent).toBe("yes");
  });

  it("isDisabled(allValues) → true когда сиблинг-статус заблокирован", async () => {
    const editTemplate = {
      id: { value: "" },
      locked: { value: false },
      title: {
        value: "",
        isDisabled: (vals: any) => vals.locked === true,
      },
    };

    const store = makeStore(editTemplate, { id: "e1", locked: false, title: "Draft" });

    function LockForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <div>
          <span data-testid="disabled">{form.title.isDisabled ? "yes" : "no"}</span>
          <input
            data-testid="lock"
            type="checkbox"
            checked={form.locked.value}
            onChange={(e) => { form.locked.value = e.target.checked; }}
          />
        </div>
      );
    }

    render(<LockForm />);

    expect(screen.getByTestId("disabled").textContent).toBe("no");

    await act(async () => {
      screen.getByTestId("lock").click();
      await flushPromises();
    });

    expect(screen.getByTestId("disabled").textContent).toBe("yes");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// formatter из template rules применяется при записи entity-листа
// ═════════════════════════════════════════════════════════════════════════════

describe("entity formatter: template formatter применяется при записи entity-листа", () => {
  it("formatter приводит строку к uppercase — компонент видит отформатированное значение", async () => {
    const editTemplate = {
      id: { value: "" },
      code: {
        value: "",
        formatter: (v: string) => v.toUpperCase(),
      },
    };

    const store = makeStore(editTemplate, { id: "e1", code: "" });

    function CodeForm() {
      const entityProxy = (store.proxy as any).users.items[0];
      const form = useForm(entityProxy, (s: any) => s.editTemplate);
      return (
        <input
          data-testid="code"
          value={form.code.value}
          onChange={(e) => { form.code.value = e.target.value; }}
        />
      );
    }

    render(<CodeForm />);

    await act(async () => {
      await userEvent.type(screen.getByTestId("code"), "abc");
    });

    expect((screen.getByTestId("code") as HTMLInputElement).value).toBe("ABC");
  });
});
