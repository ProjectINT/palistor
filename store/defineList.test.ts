/**
 * Тесты для defineList.
 *
 * Покрывает:
 *  1. Структура результата (unit — без Palistor store)
 *  2. Интеграция со store: async resolver загружает список
 *  3. Деdup — повторный доступ не вызывает лишний resolver
 *  4. loading flag во время выполнения resolver
 *  5. deps — повторный запуск при изменении зависимостей
 *  6. onError — вызов при сбое resolver
 *  7. defineList без resolver — список управляется вручную
 *  8. Вложенный defineList внутри группы
 *  9. Несколько defineList в одном конфиге
 * 10. Типизация — компилируется без ошибок
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "./defineList";
import { Palistor } from "./store";
import type { TypedListNode, TemplateConfig, ListResolver } from "./store/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── 1. Структура результата ──────────────────────────────────────────────────

describe("defineList — структура результата", () => {
  it("без resolver → массив длиной 1, element[0] = template", () => {
    const template = { id: { value: "" }, name: { value: "" } };
    const node = defineList({ template });

    expect(Array.isArray(node)).toBe(true);
    expect((node as unknown as any[]).length).toBe(1);
    expect((node as unknown as any[])[0]).toBe(template);
  });

  it("с resolver → массив длиной 2, element[1].resolve содержит resolver", () => {
    const template = { id: { value: "" }, name: { value: "" } };
    const resolver = vi.fn(async () => []);
    const node = defineList<{ id: string; name: string }>({ template, resolve: { resolver } });

    const arr = node as unknown as any[];
    expect(arr.length).toBe(2);
    expect(arr[0]).toBe(template);
    expect(arr[1]).toBeDefined();
    expect(arr[1].resolve).toBeDefined();
    expect(arr[1].resolve.resolver).toBe(resolver);
  });

  it("deps передаётся в resolve config", () => {
    const template = { id: { value: "" } };
    const resolver = vi.fn(async () => []);
    const node = defineList<{ id: string }>({
      template,
      resolve: { resolver, deps: ["filter", "page"] },
    });

    const resolveConfig = (node as unknown as any[])[1].resolve;
    expect(resolveConfig.deps).toEqual(["filter", "page"]);
  });

  it("onError передаётся в resolve config", () => {
    const template = { id: { value: "" } };
    const resolver = vi.fn(async () => []);
    const onError = vi.fn();
    const node = defineList<{ id: string }>({ template, resolve: { resolver, onError } });

    const resolveConfig = (node as unknown as any[])[1].resolve;
    expect(resolveConfig.onError).toBe(onError);
  });

  it("без resolve — element[1] отсутствует", () => {
    const template = { id: { value: "" } };
    const node = defineList({ template });

    expect((node as unknown as any[]).length).toBe(1);
    expect((node as unknown as any[])[1]).toBeUndefined();
  });
});

// ─── 2. Интеграция: resolver загружает список ─────────────────────────────────

describe("defineList + Palistor — async resolver загружает список", () => {
  it("resolver вызывается после первого доступа к items (lazy)", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    // До доступа resolver не вызван (lazy по умолчанию)
    expect(resolver).not.toHaveBeenCalled();

    void (store.proxy as any).users.items;

    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("resolver загружает данные → items содержат правильные значения", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const users = (store.proxy as any).users;
    expect(users.items[0].name.value).toBe("Alice");
    expect(users.items[1].name.value).toBe("Bob");
  });

  it("resolver загружает данные → entities зарегистрированы в registry", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("resolver с пустым массивом → список пуст", async () => {
    const resolver = vi.fn(async (): Promise<{ id: string; name: string }[]> => []);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("resolver вызывается с текущими значениями формы", async () => {
    const resolver = vi.fn(async (_values: any): Promise<{ id: string; name: string }[]> => []);

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const calledWith = resolver.mock.calls[0][0];
    expect(calledWith).toMatchObject({ filter: "active" });
  });
});

// ─── 3. Деdup — повторный доступ не запускает лишний resolver ─────────────────

describe("defineList — deduplication resolver", () => {
  it("повторные доступы пока pending → resolver вызывается ровно 1 раз", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(() => new Promise<any[]>((r) => { resolvePromise = r; }));

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;

    // flush microtask so resolver is actually called and resolvePromise is assigned
    await Promise.resolve();

    resolvePromise([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(1);
  });
});

// ─── 4. loading flag ──────────────────────────────────────────────────────────

describe("defineList — loading flag", () => {
  it("loading = false до первого доступа", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: vi.fn(async (): Promise<{ id: string; name: string }[]> => []), onError: vi.fn() },
        }),
      } as any,
    });

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading = true пока resolver выполняется", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(() => new Promise<any[]>((r) => { resolvePromise = r; }));

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await Promise.resolve(); // flush microtask

    expect((store.proxy as any).users.loading).toBe(true);

    resolvePromise([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading = false для defineList без resolver", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading = false после ошибки resolver", async () => {
    const resolver = vi.fn(async () => { throw new Error("fail"); });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("уведомляет глобальных подписчиков когда loading меняется", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(() => new Promise<any[]>((r) => { resolvePromise = r; }));

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    const listener = vi.fn();
    store.subscribeGlobal(listener);
    listener.mockClear();

    void (store.proxy as any).users.items;
    await Promise.resolve();

    // loading = true → notify
    expect(listener).toHaveBeenCalled();
    listener.mockClear();

    resolvePromise([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    // loading = false + data → notify
    expect(listener).toHaveBeenCalled();
  });
});

// ─── 5. deps — повторный запуск при изменении зависимостей ───────────────────

describe("defineList — deps retrigger", () => {
  it("resolver перезапускается при изменении поля из deps", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "active") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["filter"] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");

    // Меняем зависимость
    (store.proxy as any).filter.value = "inactive";
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("resolver не перезапускается при изменении поля НЕ из deps", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        unrelated: { value: "x" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["filter"] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);

    (store.proxy as any).unrelated.value = "y";
    await flushPromises();

    // NOT re-triggered — unrelated not in deps
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("при deps=[] resolver не перезапускается при изменениях", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: [] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    (store.proxy as any).filter.value = "inactive";
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("resolver перезапускается по нескольким deps независимо", async () => {
    let callCount = 0;
    const resolver = vi.fn(async () => {
      callCount++;
      return [{ id: `u${callCount}`, name: `User${callCount}` }];
    });

    const store = new Palistor({
      config: {
        page: { value: 1 },
        sort: { value: "asc" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["page", "sort"] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();
    expect(callCount).toBe(1);

    (store.proxy as any).page.value = 2;
    await flushPromises();
    expect(callCount).toBe(2);

    (store.proxy as any).sort.value = "desc";
    await flushPromises();
    expect(callCount).toBe(3);
  });
});

// ─── 6. onError — обработка ошибок resolver ───────────────────────────────────

describe("defineList — onError", () => {
  it("onError вызывается при ошибке resolver", async () => {
    const error = new Error("network failure");
    const onError = vi.fn();
    const resolver = vi.fn(async () => { throw error; });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ notify: expect.any(Function) }),
    );
  });

  it("onError получает notify из store.setNotifier", async () => {
    const notifyFn = vi.fn();
    const onError = vi.fn((_err: unknown, ctx: { notify: (msg: string) => void }) => {
      ctx.notify("Ошибка загрузки");
    });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError,
          },
        }),
      } as any,
    });

    store.setNotifier(notifyFn);

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(notifyFn).toHaveBeenCalledWith("Ошибка загрузки");
  });

  it("список остаётся пустым после ошибки resolver", async () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError: vi.fn(),
          },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("после ошибки можно вручную добавить items", async () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError: vi.fn(),
          },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });
});

// ─── 7. defineList без resolver — ручное управление ──────────────────────────

describe("defineList без resolver", () => {
  it("список пуст при инициализации", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.loading).toBe(false);
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("add + значения из store.set", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).users.dirty).toBe(true);
  });

  it("add с объектом создаёт entity и добавляет в список", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    (store.proxy as any).users.add({ id: "u1", name: "Alice" });

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });

  it("remove удаляет item из списка", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");
    expect((store.proxy as any).users.length).toBe(2);

    (store.proxy as any).users.remove("u1");
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("getById возвращает нужный item", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const item = (store.proxy as any).users.getById("u2");
    expect(item).toBeDefined();
    expect(item.name.value).toBe("Bob");
  });

  it("getById возвращает undefined для несуществующего id", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    const item = (store.proxy as any).users.getById("nonexistent");
    expect(item).toBeUndefined();
  });

  it("setItems заменяет весь список", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    store.set({ id: "u3", name: "Carol" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    (store.proxy as any).users.setItems(["u3"]);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Carol");
  });
});

// ─── 8. Вложенный defineList внутри группы ───────────────────────────────────

describe("defineList — вложенный в группу", () => {
  it("defineList внутри group node работает корректно", async () => {
    const resolver = vi.fn(async () => [
      { id: "p1", title: "Item A" },
    ]);

    const store = new Palistor({
      config: {
        section: {
          label: { value: "Section" },
          products: defineList({
            template: { id: { value: "" }, title: { value: "" } },
            resolve: { resolver, onError: vi.fn() },
          }),
        },
      } as any,
    });

    void (store.proxy as any).section.products.items;
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).section.products.length).toBe(1);
    expect((store.proxy as any).section.products.items[0].title.value).toBe("Item A");
  });
});

// ─── 9. Несколько defineList в одном конфиге ─────────────────────────────────

describe("defineList — несколько списков в конфиге", () => {
  it("два defineList с resolver работают независимо", async () => {
    const usersResolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);
    const rolesResolver = vi.fn(async () => [{ id: "r1", code: "admin" }]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: usersResolver, onError: vi.fn() },
        }),
        roles: defineList({
          template: { id: { value: "" }, code: { value: "" } },
          resolve: { resolver: rolesResolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    void (store.proxy as any).roles.items;
    await flushPromises();

    expect(usersResolver).toHaveBeenCalledTimes(1);
    expect(rolesResolver).toHaveBeenCalledTimes(1);

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).roles.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).roles.items[0].code.value).toBe("admin");
  });

  it("resolvers двух списков не влияют друг на друга", async () => {
    const errResolver = vi.fn(async () => { throw new Error("fail"); });
    const okResolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        broken: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: errResolver, onError: vi.fn() },
        }),
        working: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: okResolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).broken.items;
    void (store.proxy as any).working.items;
    await flushPromises();

    expect((store.proxy as any).broken.length).toBe(0);
    expect((store.proxy as any).working.length).toBe(1);
    expect((store.proxy as any).working.items[0].name.value).toBe("Alice");
  });
});

// ─── 10. Типизация (compile-time) ─────────────────────────────────────────────

describe("defineList — типизация компилируется", () => {
  it("TypedListNode принимается в конфиге Palistor", () => {
    interface User {
      id: string;
      name: string;
      email: string;
    }

    // Полностью типизированный defineList
    const usersNode = defineList<User>({
      template: {
        id: { value: "" },
        name: { value: "" },
        email: { value: "" },
      },
      resolve: {
        resolver: async (): Promise<User[]> => [],
        deps: ["filter"],
        onError: (_err, { notify }) => { notify("error"); },
      },
    });

    // Тип TypedListNode<User>
    const check: TypedListNode<User> = usersNode;
    expect(check).toBeDefined();
  });

  it("defineList без resolve принимается в качестве TypedListNode", () => {
    interface Product {
      id: string;
      title: string;
    }

    const node = defineList<Product>({
      template: { id: { value: "" }, title: { value: "" } },
    });

    const typed: TypedListNode<Product> = node;
    const arr = typed as unknown as any[];
    expect(arr[0]).toBeDefined();
    expect(arr[1]).toBeUndefined();
  });

  it("ListResolver<TEntity> имеет правильную сигнатуру", () => {
    type Resolver = ListResolver<{ id: string; name: string }>;

    const resolver: Resolver = async () => [{ id: "u1", name: "Alice" }];
    expect(typeof resolver).toBe("function");
  });

  it("TemplateConfig<TEntity> типизирует template корректно", () => {
    interface Item {
      id: string;
      count: number;
    }

    const template: TemplateConfig<Item> = {
      id: { value: "" },
      count: { value: 0 },
    };

    const node = defineList<Item>({ template });
    expect((node as unknown as any[])[0]).toBe(template);
  });
});
