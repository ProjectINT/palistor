/**
 * Entity-leaf callbacks on React components — mirror of leafCallbacks.react.test.tsx
 *
 * Covers onChange and onSubmit on an entity leaf node through real React components.
 * The form is obtained via useForm(entityProxy, (s) => s.editTemplate).
 *
 * onChange (fire-and-forget):
 *   L-1: onChange fires when an entity leaf's value is written and updates a sibling field (patch)
 *   L-2: onChange receives {fieldKey, newValue, previousValue, allValues}
 *   L-5: onChange is NOT invoked on an entity leaf's submit()
 *
 * onSubmit (full pipeline via proxy.field.submit()):
 *   L-6: onSubmit receives (value, store, entityParentProxy) on an entity-leaf submit
 *   L-7: the submitting flag is visible in the component during the entity-leaf submit pipeline
 *   L-8: validate blocks the entity-leaf submit, errorMessage is available
 *   L-9: afterSubmit is called with the result and a reset action on the entity leaf
 *   L-10: parent.id and parent.<sibling>.value are available in the entity leaf's onSubmit
 *   L-11: onChange and onSubmit on one template field are independent
 *
 * Additionally:
 *   a setter on an entity leaf patches a sibling entity leaf (mirror of runSetter)
 *   beforeSubmit transforms the value before onSubmit
 *   isRequired/isDisabled are computed from entity siblings via allValues
 *   the formatter from the template rules is applied on write
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
// L-1: onChange updates a sibling field via a patch (entity mode)
// ═════════════════════════════════════════════════════════════════════════════

describe("L-1 entity: onChange updates a sibling field via a patch", () => {
  it("writing the entity leaf's country updates city via the patch returned from onChange", async () => {
    const editTemplate = {
      id: { value: "" },
      country: {
        value: "",
        onChange: async ({ newValue }: { newValue: string }) => {
          return { city: newValue === "RU" ? "Moscow" : "Unknown" };
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

    expect(screen.getByTestId("city").textContent).toBe("Moscow");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-5: onChange is NOT invoked on an entity leaf's submit()
// ═════════════════════════════════════════════════════════════════════════════

describe("L-5 entity: onChange does not fire when submit() is called on the entity leaf", () => {
  it("after the entity leaf's submit() onChange was not invoked", async () => {
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
// L-6: onSubmit receives (value, store, entityParentProxy)
// ═════════════════════════════════════════════════════════════════════════════

describe("L-6 entity: onSubmit receives the right arguments on an entity-leaf submit", () => {
  it("onSubmit(value, store, entityParentProxy) — all arguments are passed", async () => {
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
      true,            // value — the entity leaf's current value
      store,           // store — the Palistor instance
      expect.anything(), // entityParentProxy — the entity projection proxy
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-7: the submitting flag is visible in the component during the submit pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe("L-7 entity: the submitting flag shows on the entity leaf during the submit pipeline", () => {
  it("submitting=true while the pipeline runs, false after it completes", async () => {
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
// L-8: validate blocks the entity-leaf submit — onSubmit is not invoked
// ═════════════════════════════════════════════════════════════════════════════

describe("L-8 entity: validation blocks the submit — onSubmit is not invoked, errorMessage is available", () => {
  it("empty entity-leaf email → submit returns errors, onSubmit is not called", async () => {
    const onSubmitSpy = vi.fn();
    let submitResult: any;

    const editTemplate = {
      id: { value: "" },
      email: {
        value: "",
        validate: (v: string) => (!v ? "Email is required" : undefined),
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

describe("L-9 entity: afterSubmit gets the onSubmit result and can reset the entity leaf", () => {
  it("afterSubmit is called with the result; reset restores the entity leaf's initial value", async () => {
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

    // reset() inside afterSubmit restores the entity leaf's initial value ""
    await waitFor(() => {
      expect(screen.getByTestId("notes").getAttribute("value")).toBe("");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// L-10: parent.id and parent.<sibling>.value are available in the entity leaf's onSubmit
// ═════════════════════════════════════════════════════════════════════════════

describe("L-10 entity: the parent proxy and store.context are available in the entity leaf's onSubmit", () => {
  it("onSubmit reads parent.id, parent.name.value and store.context.accountId", async () => {
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
// L-11: onChange and onSubmit on one template field are independent
// ═════════════════════════════════════════════════════════════════════════════

describe("L-11 entity: onChange and onSubmit on one template field work independently", () => {
  it("writing the value triggers only onChange; submit() triggers only onSubmit", async () => {
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

// ═════════════════════════════════════════════════════════════════════════════
// Additionally: a setter on an entity leaf patches a sibling entity leaf
// ═════════════════════════════════════════════════════════════════════════════

describe("entity setter: writing a field with a setter patches a sibling entity leaf", () => {
  it("writing priority with a setter updates the sibling urgencyLabel", async () => {
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
// L-2 entity: onChange receives {fieldKey, newValue, previousValue, allValues}
// ═════════════════════════════════════════════════════════════════════════════

describe("L-2 entity: the onChange callback is invoked with the full change context", () => {
  it("onChange receives fieldKey, newValue, previousValue, allValues from the entity", async () => {
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
// beforeSubmit on an entity leaf transforms the value before onSubmit
// ═════════════════════════════════════════════════════════════════════════════

describe("entity beforeSubmit: transforms the value before onSubmit", () => {
  it("beforeSubmit returns a trimmed value — onSubmit receives the processed value", async () => {
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

  it("beforeSubmit receives parentValues with the current entity siblings", async () => {
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
// isRequired / isDisabled are computed from entity siblings via allValues
// ═════════════════════════════════════════════════════════════════════════════

describe("entity computed flags: isRequired/isDisabled from entity sibling values", () => {
  it("isRequired(allValues) → true when the sibling flag is on", async () => {
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

  it("isDisabled(allValues) → true when the sibling status is locked", async () => {
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
// The formatter from the template rules is applied when the entity leaf is written
// ═════════════════════════════════════════════════════════════════════════════

describe("entity formatter: the template formatter is applied when the entity leaf is written", () => {
  it("the formatter uppercases the string — the component sees the formatted value", async () => {
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
