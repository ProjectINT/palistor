import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

type AnyConfigNode = Record<string, any>;

// ─── SubmitPipeline (via Palistor) ────────────────────────────────────────────

describe("SubmitPipeline", () => {
  it("returns success:true when there are no errors and calls onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue("ok");
    const root: AnyConfigNode = { x: { value: 1 }, onSubmit };
    const store = new Palistor({ config: root });

    const result = await store.submit();

    expect(result).toEqual({ success: true, result: "ok" });
    expect(onSubmit).toHaveBeenCalledWith({ x: 1 }, expect.any(Object), undefined);
  });

  it("returns success:false when validation errors exist", async () => {
    const root: AnyConfigNode = {
      field: { value: "", isRequired: true },
    };
    const store = new Palistor({ config: root });

    const result = await store.submit();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("sets submitting=false in finally even when onSubmit throws", async () => {
    const root: AnyConfigNode = {
      onSubmit: vi.fn().mockRejectedValue(new Error("server error")),
    };
    const store = new Palistor({ config: root });

    await expect(store.submit()).rejects.toThrow("server error");

    expect(store.proxy.submitting).toBe(false);
  });

  it("calls afterSubmit with the result and a reset action", async () => {
    const afterSubmit = vi.fn();
    const root: AnyConfigNode = {
      onSubmit: vi.fn().mockResolvedValue(42),
      afterSubmit,
    };
    const store = new Palistor({ config: root });

    await store.submit();

    expect(afterSubmit).toHaveBeenCalledWith(42, { reset: expect.any(Function) });
  });
});

// ─── Leaf submit — integration tests (via the proxy) ─────────────────────────

describe("Leaf submit (integration via proxy)", () => {
  it("3.7: leaf submit() calls onSubmit(value, store, parent)", async () => {
    const onSubmitSpy = vi.fn();
    const config = {
      isActive: { value: false, onSubmit: onSubmitSpy },
      name: { value: "Alice" },
    };
    const store = new Palistor({ config });
    store.proxy.isActive.value = true;
    const result = await store.proxy.isActive.submit();
    expect(result.success).toBe(true);
    expect(onSubmitSpy).toHaveBeenCalledWith(
      true,
      store,
      expect.anything(),
    );
  });

  it("3.8: the leaf submitting flag is set while the submit runs", async () => {
    let capturedSubmitting: boolean | undefined;
    const config = {
      toggle: {
        value: false,
        onSubmit: () => {
          capturedSubmitting = store.proxy.toggle.submitting;
          return Promise.resolve();
        },
      },
    };
    const store = new Palistor({ config });
    store.proxy.toggle.value = true;
    expect(store.proxy.toggle.submitting).toBe(false);
    await store.proxy.toggle.submit();
    expect(capturedSubmitting).toBe(true);
    expect(store.proxy.toggle.submitting).toBe(false);
  });

  it("3.9: leaf submit() returns errors on a validation failure", async () => {
    const config = {
      email: {
        value: "",
        validate: (v: string) => (!v ? "Required" : undefined),
        onSubmit: vi.fn(),
      },
    };
    const store = new Palistor({ config });
    const result = await store.proxy.email.submit();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].message).toBe("Required");
    }
  });

  it("3.10: the leaf onSubmit receives a parent proxy with sibling access", async () => {
    const spy = vi.fn();
    const config = {
      isActive: {
        value: true,
        onSubmit: (value: unknown, _store: unknown, parent: any) => {
          spy(value, parent.name.value);
        },
      },
      name: { value: "Alice" },
    };
    const store = new Palistor({ config });
    const result = await store.proxy.isActive.submit();
    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith(true, "Alice");
  });

  it("3.11: store.context is available inside the leaf onSubmit", async () => {
    const spy = vi.fn();
    const config = {
      toggle: {
        value: false,
        onSubmit: (_value: unknown, storeArg: any) => { spy(storeArg.context.accountId); },
      },
    };
    const store = new Palistor({ config });
    store.setContext({ accountId: "acc-42" });
    store.proxy.toggle.value = true;
    await store.proxy.toggle.submit();
    expect(spy).toHaveBeenCalledWith("acc-42");
  });

  it("3.12: leaf submit() does not interfere with the group-level submit pipeline", async () => {
    const leafSubmitSpy = vi.fn();
    const groupSubmitSpy = vi.fn().mockResolvedValue("ok");
    const config = {
      toggle: { value: true, onSubmit: leafSubmitSpy },
      onSubmit: groupSubmitSpy,
    };
    const store = new Palistor({ config });

    const leafResult = await store.proxy.toggle.submit();
    expect(leafResult.success).toBe(true);
    expect(leafSubmitSpy).toHaveBeenCalledWith(true, store, expect.anything());

    const groupResult = await store.submit();
    expect(groupSubmitSpy).toHaveBeenCalled();
    expect(groupResult.success).toBe(true);
  });

  it("3.13: the group onSubmit receives parent as the third argument (backward-compatible)", async () => {
    const spy = vi.fn();
    const config = {
      name: { value: "Alice" },
      onSubmit: spy,
    };
    const store = new Palistor({ config });
    await store.submit();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alice" }),
      store,
      undefined,
    );
  });
});
