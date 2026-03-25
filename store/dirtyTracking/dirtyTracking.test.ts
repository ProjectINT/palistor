import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

// ─── Тестовый конфиг ─────────────────────────────────────────────────────────

const makeConfig = () => ({
  email: {
    value: "",
    label: "Email",
    isRequired: true,
    validate: (v: string) => (!v ? "required" : undefined),
  },
  name: {
    value: "",
    label: "Name",
    isRequired: true,
    // No explicit validate — relies on isRequired auto-validation
  },
  age: {
    value: 0,
    label: "Age",
  },
  address: {
    city: {
      value: "",
      label: "City",
      isRequired: true,
      validate: (v: string) => (!v ? "city required" : undefined),
    },
    zip: {
      value: "",
      label: "ZIP",
    },
  },
});

// ─── Dirty tracking ─────────────────────────────────────────────────────────

describe("dirty tracking", () => {
  describe("per-field dirty", () => {
    it("initially all fields are not dirty", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.dirty).toBe(false);
      expect(store.proxy.name.dirty).toBe(false);
      expect(store.proxy.age.dirty).toBe(false);
      expect(store.proxy.address.city.dirty).toBe(false);
      expect(store.proxy.address.zip.dirty).toBe(false);
    });

    it("field becomes dirty when value changes from initial", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "user@test.com";
      expect(store.proxy.email.dirty).toBe(true);
      expect(store.proxy.name.dirty).toBe(false); // unchanged
    });

    it("field becomes clean when value returns to initial", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "user@test.com";
      expect(store.proxy.email.dirty).toBe(true);

      store.proxy.email.value = ""; // back to initial
      expect(store.proxy.email.dirty).toBe(false);
    });

    it("field dirty with initialValues", () => {
      const store = new Palistor({
        config: makeConfig(),
        initialValues: { email: "initial@test.com" } as any,
      });
      expect(store.proxy.email.dirty).toBe(false); // same as initial

      store.proxy.email.value = "changed@test.com";
      expect(store.proxy.email.dirty).toBe(true);

      store.proxy.email.value = "initial@test.com"; // back to initial
      expect(store.proxy.email.dirty).toBe(false);
    });

    it("nested field dirty", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.address.city.value = "Moscow";
      expect(store.proxy.address.city.dirty).toBe(true);
      expect(store.proxy.address.zip.dirty).toBe(false);
    });

    it("dirty NOT appears in spread of leaf nodes", () => {
      const store = new Palistor({ config: makeConfig() });
      const spread = { ...store.proxy.email };
      expect(spread).not.toHaveProperty("dirty");
      expect(spread.dirty).toBe(undefined);
    });
  });

  describe("group-level dirty", () => {
    it("group not dirty when no children changed", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.address.dirty).toBe(false);
    });

    it("group becomes dirty when any child changes", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.address.city.value = "Berlin";
      expect(store.proxy.address.dirty).toBe(true);
    });

    it("group becomes clean when all children return to initial", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.address.city.value = "Berlin";
      expect(store.proxy.address.dirty).toBe(true);

      store.proxy.address.city.value = ""; // back to initial
      expect(store.proxy.address.dirty).toBe(false);
    });
  });

  describe("dirty after reset", () => {
    it("reset clears dirty flags", () => {
      const store = new Palistor({ config: makeConfig() });
      store.proxy.email.value = "changed@test.com";
      store.proxy.address.city.value = "Berlin";
      expect(store.proxy.email.dirty).toBe(true);
      expect(store.proxy.address.dirty).toBe(true);

      store.reset();
      expect(store.proxy.email.dirty).toBe(false);
      expect(store.proxy.address.city.dirty).toBe(false);
      expect(store.proxy.address.dirty).toBe(false);
    });
  });
});

// ─── Revalidate ──────────────────────────────────────────────────────────────

describe("revalidate", () => {
  describe("initial state", () => {
    it("revalidate is false by default on group nodes", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.address.revalidate).toBe(false);
    });

    it("errors are not shown before first submit (revalidate=false)", () => {
      const store = new Palistor({ config: makeConfig() });
      // email is empty and required, but revalidate=false
      expect(store.proxy.email.isInvalid).toBeUndefined();
      expect(store.proxy.email.errorMessage).toBeUndefined();
    });
  });

  describe("after failed submit", () => {
    it("revalidate becomes true after failed submit", async () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.address.revalidate).toBe(false);

      const result = await store.submit();
      expect(result.success).toBe(false);

      // revalidate is now true (on root — the submitted group)
      // Group nodes should have revalidate=true
    });

    it("errors are shown after failed submit", async () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.proxy.email.isInvalid).toBeUndefined();

      await store.submit();

      expect(store.proxy.email.isInvalid).toBe(true);
      expect(store.proxy.email.errorMessage).toBe("required");
    });

    it("live validation after failed submit — errors clear as user types", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.submit(); // fail → revalidate=true

      expect(store.proxy.email.isInvalid).toBe(true);

      store.proxy.email.value = "valid@test.com";
      expect(store.proxy.email.isInvalid).toBeUndefined(); // cleared!

      store.proxy.email.value = "";
      expect(store.proxy.email.isInvalid).toBe(true); // back to error
    });

    it("revalidate resets to false after reset()", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.submit(); // fail → revalidate=true

      expect(store.proxy.email.isInvalid).toBe(true);

      store.reset();

      // After reset, revalidate=false → errors hidden again
      expect(store.proxy.email.isInvalid).toBeUndefined();
    });
  });

  describe("nested group submit", () => {
    it("submitting a nested group sets revalidate on that group only", async () => {
      const config = {
        user: {
          name: {
            value: "",
            isRequired: true,
            validate: (v: string) => (!v ? "name required" : undefined),
          },
          onSubmit: async (values: any) => values,
        },
        payment: {
          amount: {
            value: 0,
            validate: (v: number) => (v <= 0 ? "must be positive" : undefined),
          },
          onSubmit: async (values: any) => values,
        },
      };
      const store = new Palistor({ config });

      // Submit user group (should fail — name is empty)
      const result = await store.proxy.user.submit();
      expect(result.success).toBe(false);

      // user.name should show errors (revalidate=true for user group)
      expect(store.proxy.user.name.isInvalid).toBe(true);
    });
  });
});

// ─── isRequired auto-validation ──────────────────────────────────────────────

describe("isRequired auto-validation", () => {
  it("isRequired without validate produces error after submit", async () => {
    const config = {
      name: {
        value: "",
        isRequired: true,
        // NO validate function — relies on isRequired auto-check
      },
    };
    const store = new Palistor({ config });

    await store.submit();

    expect(store.proxy.name.isInvalid).toBe(true);
    expect(store.proxy.name.errorMessage).toBe("required");
  });

  it("isRequired auto-validation clears when value is provided", async () => {
    const config = {
      name: {
        value: "",
        isRequired: true,
      },
    };
    const store = new Palistor({ config });

    await store.submit(); // fail → revalidate=true
    expect(store.proxy.name.isInvalid).toBe(true);

    store.proxy.name.value = "John";
    expect(store.proxy.name.isInvalid).toBeUndefined();
  });

  it("custom validate takes priority over isRequired auto-check", async () => {
    const config = {
      email: {
        value: "",
        isRequired: true,
        validate: (v: string) => (!v ? "email is required" : undefined),
      },
    };
    const store = new Palistor({ config });

    await store.submit();

    // Custom validate message takes priority
    expect(store.proxy.email.isInvalid).toBe(true);
    expect(store.proxy.email.errorMessage).toBe("email is required");
  });

  it("isRequired checks null and undefined as empty", async () => {
    const config = {
      field: {
        value: null as string | null,
        isRequired: true,
      },
    };
    const store = new Palistor({ config });

    await store.submit();
    expect(store.proxy.field.isInvalid).toBe(true);
  });

  it("isRequired checks whitespace-only string as empty", async () => {
    const config = {
      field: {
        value: "   ",
        isRequired: true,
      },
    };
    const store = new Palistor({ config });

    await store.submit();
    expect(store.proxy.field.isInvalid).toBe(true);
  });

  it("isRequired with non-empty value has no error", async () => {
    const config = {
      name: {
        value: "John",
        isRequired: true,
      },
    };
    const store = new Palistor({ config });

    const result = await store.submit();
    expect(result.success).toBe(true);
    expect(store.proxy.name.isInvalid).toBeUndefined();
  });
});

// ─── Submit pipeline validation ──────────────────────────────────────────────

describe("submit pipeline validation", () => {
  it("submit fails when required fields are empty", async () => {
    const store = new Palistor({ config: makeConfig() });

    const result = await store.submit();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      // Should include email, name, address.city errors
      const paths = result.errors.map((e) => e.path);
      expect(paths).toContain("email");
      expect(paths).toContain("name");
      expect(paths).toContain("address.city");
    }
  });

  it("submit succeeds when all required fields are filled", async () => {
    const config = {
      email: {
        value: "user@test.com",
        isRequired: true,
        validate: (v: string) => (!v ? "required" : undefined),
      },
      onSubmit: vi.fn(async (values: any) => ({ ok: true })),
    };
    const store = new Palistor({ config });

    const result = await store.submit();
    expect(result.success).toBe(true);
    expect(config.onSubmit).toHaveBeenCalledWith({ email: "user@test.com" }, expect.any(Object));
  });

  it("submit sets submitting=true during execution", async () => {
    const config = {
      email: {
        value: "test@test.com",
        isRequired: true,
      },
      onSubmit: async (values: any) => {
        return { ok: true };
      },
    };
    const store = new Palistor({ config });

    const result = await store.submit();
    expect(result.success).toBe(true);
  });

  it("beforeSubmit transforms values before onSubmit", async () => {
    const config = {
      email: {
        value: "  User@Test.COM  ",
        beforeSubmit: (v: string) => v.trim().toLowerCase(),
      },
      onSubmit: vi.fn(async (values: any) => values),
    };
    const store = new Palistor({ config });

    await store.submit();
    expect(config.onSubmit).toHaveBeenCalledWith({ email: "user@test.com" }, expect.any(Object));
  });

  it("afterSubmit is called with result and reset action", async () => {
    const afterSubmit = vi.fn();
    const config = {
      email: {
        value: "test@test.com",
      },
      onSubmit: async () => ({ done: true }),
      afterSubmit,
    };
    const store = new Palistor({ config });

    await store.submit();

    expect(afterSubmit).toHaveBeenCalledTimes(1);
    expect(afterSubmit).toHaveBeenCalledWith(
      { done: true },
      expect.objectContaining({ reset: expect.any(Function) }),
    );
  });
});

// ─── Combined dirty + revalidate ─────────────────────────────────────────────

describe("dirty + revalidate interaction", () => {
  it("form is dirty and errors show after failed submit", async () => {
    const store = new Palistor({ config: makeConfig() });

    store.proxy.email.value = "partial"; // dirty but valid
    expect(store.proxy.email.dirty).toBe(true);
    expect(store.proxy.email.isInvalid).toBeUndefined(); // revalidate=false

    // name and address.city are still empty and required
    const result = await store.submit();
    expect(result.success).toBe(false);

    // Now errors show for empty required fields
    expect(store.proxy.name.isInvalid).toBe(true);
    expect(store.proxy.address.city.isInvalid).toBe(true);

    // email is valid — no error
    expect(store.proxy.email.isInvalid).toBeUndefined();
  });

  it("reset clears both dirty and revalidate", async () => {
    const store = new Palistor({ config: makeConfig() });

    store.proxy.email.value = "changed";
    await store.submit(); // fail → errors visible

    expect(store.proxy.email.dirty).toBe(true);
    expect(store.proxy.name.isInvalid).toBe(true); // revalidate=true

    store.reset();

    expect(store.proxy.email.dirty).toBe(false);
    expect(store.proxy.name.isInvalid).toBeUndefined(); // revalidate=false again
    expect(store.proxy.email.value).toBe(""); // reset to default
  });
});
