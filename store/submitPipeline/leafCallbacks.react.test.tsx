/**
 * Leaf-level callbacks on React components — comprehensive integration tests
 *
 * Covers onChange and onSubmit on a leaf node through real React components:
 *
 * onChange (fire-and-forget):
 *   L-1: onChange fires when value is written and updates a sibling field (patch)
 *   L-2: onChange receives fieldKey, newValue, previousValue, allValues
 *   L-3: the component reacts to the onChange update — the patch applies and the render updates
 *   L-4: onChange on the leaf AND on an ancestor group — both fire (leaf first)
 *   L-5: onChange is not invoked on submit — only on a value write
 *
 * onSubmit (full pipeline via proxy.field.submit()):
 *   L-6: a button calls submit() — onSubmit receives (value, store, parent)
 *   L-7: the submitting flag is visible in the component while the pipeline runs
 *   L-8: on a validation error submit() returns errors, onSubmit is not called
 *   L-9: afterSubmit is called after onSubmit with the result and a reset action
 *   L-10: the parent proxy gives access to sibling fields and store.context
 *   L-11: onChange + onSubmit on one field are independent and don't interfere
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Palistor } from "../store/palistor";
import { useForm } from "../../react/useForm";

// ─── Helper: flush async ──────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ═════════════════════════════════════════════════════════════════════════════
// L-1: onChange updates a sibling field via a patch
// ═════════════════════════════════════════════════════════════════════════════

describe("L-1: onChange updates a sibling field via a patch", () => {
  it("writing country updates city via the patch returned from onChange", async () => {
    const store = new Palistor({
      config: {
        country: {
          value: "",
          onChange: async ({ newValue }: { newValue: string }) => {
            return { city: newValue === "RU" ? "Moscow" : "Unknown" };
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

    expect(screen.getByTestId("city").textContent).toBe("Moscow");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-2: onChange receives the right arguments
// ═════════════════════════════════════════════════════════════════════════════

describe("L-2: onChange receives fieldKey, newValue, previousValue, allValues", () => {
  it("the callback is invoked with the full change context", async () => {
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
// L-3: the component reacts to the onChange patch — the render updates
// ═════════════════════════════════════════════════════════════════════════════

describe("L-3: the component sees the onChange patch applied", () => {
  it("urgencyLabel is recomputed and shown after a priority change", async () => {
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
// L-4: leaf and ancestor onChange both fire (leaf first)
// ═════════════════════════════════════════════════════════════════════════════

describe("L-4: the leaf's and the ancestor group's onChange — both fire, leaf first", () => {
  it("call order: leaf-onChange → group-onChange", async () => {
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
// L-5: onChange is NOT invoked on submit() — only on a value write
// ═════════════════════════════════════════════════════════════════════════════

describe("L-5: onChange does not fire when submit() is called", () => {
  it("after submit() onChange was not invoked additionally", async () => {
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
// L-6: onSubmit receives (value, store, parent) when called from a component
// ═════════════════════════════════════════════════════════════════════════════

describe("L-6: onSubmit receives the right arguments when called from a component", () => {
  it("onSubmit(value, store, parent) — all arguments are passed", async () => {
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
      true,           // value — the leaf's current value
      store,          // store — the Palistor instance
      expect.anything(), // parent — the parent group's proxy
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-7: the submitting flag is visible in the component during the pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe("L-7: the submitting flag shows in the component during the submit pipeline", () => {
  it("submitting=true while the pipeline runs, false after it completes", async () => {
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

    // Start the submit — the pipeline hangs on resolveSubmit
    act(() => { screen.getByTestId("save-btn").click(); });

    await waitFor(() => {
      expect(screen.getByTestId("submitting").textContent).toBe("saving");
    });

    // Complete the pipeline
    await act(async () => {
      resolveSubmit();
      await flushPromises();
    });

    expect(screen.getByTestId("submitting").textContent).toBe("idle");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-8: on a validation error submit() returns errors, onSubmit is not called
// ═════════════════════════════════════════════════════════════════════════════

describe("L-8: validation blocks the submit — onSubmit is not called, the error is shown", () => {
  it("empty email → submit returns errors, errorMessage is visible in the DOM", async () => {
    const onSubmitSpy = vi.fn();
    let submitResult: any;

    const store = new Palistor({
      config: {
        email: {
          value: "",
          validate: (v: string) => (!v ? "Email is required" : undefined),
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
    expect(submitResult.errors[0].message).toBe("Email is required");
    expect(onSubmitSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("Email is required");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-9: afterSubmit is called after onSubmit with the result and a reset action
// ═════════════════════════════════════════════════════════════════════════════

describe("L-9: afterSubmit gets the onSubmit result and can reset the form", () => {
  it("afterSubmit is called with the result; reset restores the field value", async () => {
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

    // reset() inside afterSubmit restores the field's initial value
    await waitFor(() => {
      expect(screen.getByTestId("notes").getAttribute("value")).toBe("");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-10: the parent proxy gives access to sibling fields and store.context
// ═════════════════════════════════════════════════════════════════════════════

describe("L-10: the parent proxy and store.context are available in onSubmit", () => {
  it("onSubmit reads parent.name.value and store.context.accountId", async () => {
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
// L-11: onChange + onSubmit on one field are independent
// ═════════════════════════════════════════════════════════════════════════════

describe("L-11: onChange and onSubmit on one field work independently", () => {
  it("writing the value triggers only onChange; submit() triggers only onSubmit", async () => {
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

    // Change the value → only onChange
    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId("priority"), "high");
      await flushPromises();
    });

    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onSubmitSpy).not.toHaveBeenCalled();

    onChangeSpy.mockClear();

    // Press Save → only onSubmit
    await act(async () => {
      screen.getByTestId("save-btn").click();
      await flushPromises();
    });

    expect(onSubmitSpy).toHaveBeenCalledTimes(1);
    expect(onSubmitSpy).toHaveBeenCalledWith("high", store, expect.anything());
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
