/**
 * List resolver + useStoreContext: resolver получает контекст через store.context.
 *
 * Покрывает сценарий, когда React-компонент устанавливает контекст через
 * useStoreContext (или store.setContext), а резольвер списка читает его
 * из второго аргумента `store.context`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Palistor } from "../store";
import { useForm } from "../../react/useForm";
import { useStoreContext } from "../../react/useStoreContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const userTemplate = {
  id: { value: "" },
  name: { value: "" },
  role: { value: "user" },
};

// ─── Тесты ────────────────────────────────────────────────────────────────────

describe("list resolver читает store.context, установленный через useStoreContext", () => {
  it("resolver получает accountId, засетанный через useStoreContext до resolve", async () => {
    const capturedContext: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContext.push({ ...store.context });
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // Устанавливаем контекст через хук (как делает Layout/Provider в реальном приложении)
    const { unmount } = renderHook(() =>
      useStoreContext(store as any, { accountId: "acc-123", tenant: "acme" }),
    );

    // Контекст уже установлен через useEffect → нужен act, чтобы эффект применился
    await act(async () => {});

    // Триггерим lazy resolve
    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(capturedContext[0]).toMatchObject({ accountId: "acc-123", tenant: "acme" });

    unmount();
  });

  it("после unmount useStoreContext контекст очищается и resolver не видит старые данные", async () => {
    const capturedContexts: Record<string, unknown>[] = [];
    let callCount = 0;

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      callCount++;
      capturedContexts.push({ ...store.context });
      return [{ id: `u${callCount}`, name: `User ${callCount}`, role: "user" }];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // Первый рендер — с контекстом
    const { unmount } = renderHook(() =>
      useStoreContext(store as any, { accountId: "acc-first" }),
    );
    await act(async () => {});

    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(capturedContexts[0]).toMatchObject({ accountId: "acc-first" });

    // Unmount очищает контекст
    unmount();
    await act(async () => {});

    expect(store.context).toEqual({});
  });

  it("useForm + useStoreContext в одном renderHook — resolver получает контекст", async () => {
    const capturedContext: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContext.push({ ...store.context });
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // Компонент одновременно подключает форму и устанавливает контекст
    renderHook(() => {
      useStoreContext(store as any, { accountId: "acc-xyz", locale: "ru" });
      return useForm(store as any);
    });

    await act(async () => {});

    // Триггерим lazy resolve
    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(capturedContext[0]).toMatchObject({ accountId: "acc-xyz", locale: "ru" });
  });

  it("контекст обновляется между вызовами — resolver повторного запуска получает новый контекст", async () => {
    const capturedContexts: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContexts.push({ ...store.context });
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "admin" },
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn(), deps: ["filter"] } },
        ],
      } as any,
    });

    // Устанавливаем начальный контекст
    store.setContext({ accountId: "acc-v1" });

    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(capturedContexts[0]).toMatchObject({ accountId: "acc-v1" });

    // Обновляем контекст
    store.setContext({ accountId: "acc-v2" });

    // Меняем dep → перезапуск resolver
    act(() => {
      (store.proxy as any).filter.value = "user";
    });
    await act(() => flushPromises());

    expect(capturedContexts[1]).toMatchObject({ accountId: "acc-v2" });
  });

  it("resolver использует store.context.accountId для фильтрации — результат зависит от контекста", async () => {
    const users: Record<string, { id: string; name: string; role: string }[]> = {
      "acc-alice": [{ id: "u1", name: "Alice", role: "admin" }],
      "acc-bob":   [{ id: "u2", name: "Bob",   role: "user"  }],
    };

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      return users[store.context.accountId as string] ?? [];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    store.setContext({ accountId: "acc-alice" });

    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).users.length).toBe(1);
  });
});
