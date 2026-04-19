/**
 * Leaf-level callbacks on React components — комплексные интеграционные тесты
 *
 * Покрывает onChange и onSubmit на листовом узле через реальные React-компоненты:
 *
 * onChange (fire-and-forget):
 *   L-1: onChange срабатывает при записи value и обновляет соседнее поле (patch)
 *   L-2: onChange получает fieldKey, newValue, previousValue, allValues
 *   L-3: компонент реагирует на обновление от onChange — patch применяется и рендер обновляется
 *   L-4: если onChange у листа И у группы-предка — оба срабатывают (лист первым)
 *   L-5: onChange не вызывается при submit — только при записи value
 *
 * onSubmit (full pipeline via proxy.field.submit()):
 *   L-6: кнопка вызывает submit() — onSubmit получает (value, store, parent)
 *   L-7: submitting флаг виден в компоненте во время выполнения pipeline
 *   L-8: при ошибке валидации submit() возвращает errors, onSubmit не вызывается
 *   L-9: afterSubmit вызывается после onSubmit с результатом и reset-экшеном
 *   L-10: parent proxy даёт доступ к соседним полям и store.context
 *   L-11: onChange + onSubmit на одном поле — независимы и не мешают друг другу
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Palistor } from "../store/palistor";
import { useForm } from "../../react/useForm";

// ─── Хелпер: flush async ──────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ═════════════════════════════════════════════════════════════════════════════
// L-1: onChange обновляет соседнее поле через patch
// ═════════════════════════════════════════════════════════════════════════════

describe("L-1: onChange обновляет соседнее поле через patch", () => {
  it("запись country обновляет city через patch, возвращённый из onChange", async () => {
    const store = new Palistor({
      config: {
        country: {
          value: "",
          onChange: async ({ newValue }: { newValue: string }) => {
            return { city: newValue === "RU" ? "Москва" : "Unknown" };
          },
        },
        city: { value: "" },
      },
    });

    function LocationForm() {
      const form = useForm(store);
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

    expect(screen.getByTestId("city").textContent).toBe("");

    await act(async () => {
      await userEvent.clear(screen.getByTestId("country"));
      await userEvent.type(screen.getByTestId("country"), "RU");
      await flushPromises();
    });

    expect(screen.getByTestId("city").textContent).toBe("Москва");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-2: onChange получает корректные аргументы
// ═════════════════════════════════════════════════════════════════════════════

describe("L-2: onChange получает fieldKey, newValue, previousValue, allValues", () => {
  it("коллбэк вызывается с полным контекстом изменения", async () => {
    const onChangeSpy = vi.fn();

    const store = new Palistor({
      config: {
        priority: {
          value: "normal",
          onChange: onChangeSpy,
        },
        note: { value: "keep" },
      },
    });

    function PriorityForm() {
      const form = useForm(store);
      return (
        <select
          data-testid="priority"
          value={form.priority.value}
          onChange={(e) => { form.priority.value = e.target.value; }}
        >
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      );
    }

    render(<PriorityForm />);

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "high");
      await flushPromises();
    });

    expect(onChangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldKey: "priority",
        newValue: "high",
        previousValue: "normal",
        allValues: expect.objectContaining({ priority: "high", note: "keep" }),
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-3: компонент реагирует на patch от onChange — рендер обновляется
// ═════════════════════════════════════════════════════════════════════════════

describe("L-3: компонент видит обновлённый patch от onChange", () => {
  it("urgencyLabel пересчитывается и отображается после изменения priority", async () => {
    const store = new Palistor({
      config: {
        priority: {
          value: "normal",
          onChange: async ({ newValue }: { newValue: string }) => ({
            urgencyLabel: newValue === "high" ? "!" : "",
          }),
        },
        urgencyLabel: { value: "" },
      },
    });

    function TaskForm() {
      const form = useForm(store);
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
          <span data-testid="label">{form.urgencyLabel.value}</span>
        </div>
      );
    }

    render(<TaskForm />);
    expect(screen.getByTestId("label").textContent).toBe("");

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "high");
      await flushPromises();
    });

    expect(screen.getByTestId("label").textContent).toBe("!");

    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "normal");
      await flushPromises();
    });

    expect(screen.getByTestId("label").textContent).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-4: лист-предок onChange срабатывают оба (лист первым)
// ═════════════════════════════════════════════════════════════════════════════

describe("L-4: onChange листа и onChange группы-предка — оба срабатывают, лист первым", () => {
  it("порядок вызовов: leaf-onChange → group-onChange", async () => {
    const order: string[] = [];

    const store = new Palistor({
      config: {
        status: {
          value: "draft",
          onChange: () => { order.push("leaf"); },
        },
        log: { value: "" },
        onChange: () => { order.push("group"); },
      } as any,
    });

    function StatusForm() {
      const form = useForm(store) as any;
      return (
        <input
          data-testid="status"
          value={form.status.value}
          onChange={(e) => { form.status.value = e.target.value; }}
        />
      );
    }

    render(<StatusForm />);

    await act(async () => {
      await userEvent.clear(screen.getByTestId("status"));
      await userEvent.type(screen.getByTestId("status"), "active");
      await flushPromises();
    });

    expect(order.indexOf("leaf")).toBeLessThan(order.indexOf("group"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-5: onChange НЕ вызывается при submit() — только при записи value
// ═════════════════════════════════════════════════════════════════════════════

describe("L-5: onChange не срабатывает при вызове submit()", () => {
  it("после submit() onChange не вызван дополнительно", async () => {
    const onChangeSpy = vi.fn();

    const store = new Palistor({
      config: {
        isActive: {
          value: true,
          onChange: onChangeSpy,
          onSubmit: vi.fn(),
        },
      },
    });

    function ToggleForm() {
      const form = useForm(store);
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
// L-6: onSubmit получает (value, store, parent) при вызове из компонента
// ═════════════════════════════════════════════════════════════════════════════

describe("L-6: onSubmit получает корректные аргументы при вызове из компонента", () => {
  it("onSubmit(value, store, parent) — все аргументы переданы", async () => {
    const onSubmitSpy = vi.fn();

    const store = new Palistor({
      config: {
        isActive: {
          value: false,
          onSubmit: onSubmitSpy,
        },
        name: { value: "Alice" },
      },
    });

    function UserRow() {
      const form = useForm(store);
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
      true,           // value — текущее значение листа
      store,          // store — экземпляр Palistor
      expect.anything(), // parent — proxy родительской группы
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-7: submitting флаг виден в компоненте во время pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe("L-7: submitting флаг отображается в компоненте во время submit pipeline", () => {
  it("submitting=true пока pipeline выполняется, false после завершения", async () => {
    let resolveSubmit!: () => void;
    const submittingValues: boolean[] = [];

    const store = new Palistor({
      config: {
        toggle: {
          value: true,
          onSubmit: () => new Promise<void>((r) => { resolveSubmit = r; }),
        },
      },
    });

    function ToggleForm() {
      const form = useForm(store);
      submittingValues.push(form.toggle.submitting);
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
// L-8: при ошибке валидации submit() возвращает errors, onSubmit не вызывается
// ═════════════════════════════════════════════════════════════════════════════

describe("L-8: валидация блокирует submit — onSubmit не вызывается, ошибка отображается", () => {
  it("пустой email → submit возвращает errors, errorMessage виден в DOM", async () => {
    const onSubmitSpy = vi.fn();
    let submitResult: any;

    const store = new Palistor({
      config: {
        email: {
          value: "",
          validate: (v: string) => (!v ? "Email обязателен" : undefined),
          onSubmit: onSubmitSpy,
        },
      },
    });

    function EmailForm() {
      const form = useForm(store);
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

describe("L-9: afterSubmit получает результат onSubmit и может сбросить форму", () => {
  it("afterSubmit вызван с результатом, reset сбрасывает значение поля", async () => {
    const afterSubmitSpy = vi.fn((_result: unknown, { reset }: { reset: () => void }) => {
      reset();
    });

    const store = new Palistor({
      config: {
        notes: {
          value: "",
          onSubmit: async (v: string) => `saved:${v}`,
          afterSubmit: afterSubmitSpy,
        },
      },
    });

    function NotesForm() {
      const form = useForm(store);
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

    // reset() внутри afterSubmit сбрасывает поле к начальному значению
    await waitFor(() => {
      expect(screen.getByTestId("notes").getAttribute("value")).toBe("");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-10: parent proxy даёт доступ к соседним полям и store.context
// ═════════════════════════════════════════════════════════════════════════════

describe("L-10: parent proxy и store.context доступны в onSubmit", () => {
  it("onSubmit читает parent.name.value и store.context.accountId", async () => {
    const capturedArgs: { nameValue: string; accountId: string } = {
      nameValue: "",
      accountId: "",
    };

    const store = new Palistor({
      config: {
        isActive: {
          value: false,
          onSubmit: async (
            _value: unknown,
            storeArg: any,
            parent: any,
          ) => {
            capturedArgs.nameValue = parent.name.value;
            capturedArgs.accountId = storeArg.context.accountId;
          },
        },
        name: { value: "Bob" },
      },
    });

    store.setContext({ accountId: "tenant-99" });

    function UserStatusRow() {
      const form = useForm(store);
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

    expect(capturedArgs.nameValue).toBe("Bob");
    expect(capturedArgs.accountId).toBe("tenant-99");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-11: onChange + onSubmit на одном поле — независимы
// ═════════════════════════════════════════════════════════════════════════════

describe("L-11: onChange и onSubmit на одном поле работают независимо", () => {
  it("запись value вызывает только onChange; submit() вызывает только onSubmit", async () => {
    const onChangeSpy = vi.fn().mockResolvedValue(undefined);
    const onSubmitSpy = vi.fn().mockResolvedValue("done");

    const store = new Palistor({
      config: {
        priority: {
          value: "normal",
          onChange: onChangeSpy,
          onSubmit: onSubmitSpy,
        },
        urgencyLabel: { value: "" },
      },
    });

    function PriorityCard() {
      const form = useForm(store);
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
