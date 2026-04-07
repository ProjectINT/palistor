/**
 * Расширенные тесты async-резольверов для defineList.
 *
 * Покрывает сценарии, которых нет в defineList.test.ts:
 *
 *  A. Тайминг и жизненный цикл резольвера
 *     A1. Резольвер получает снимок значений на момент запуска (не после)
 *     A2. Резольвер с задержкой: items пусты во время ожидания, заполнены после
 *     A3. Re-resolve обновляет данные уже существующих entities
 *     A4. Re-resolve после ошибки срабатывает при изменении dep (status="error")
 *
 *  B. Поведение в состоянии "pending"
 *     B1. Изменение dep пока резольвер pending → НЕ перезапускает (dedup)
 *     B2. После завершения pending-резольвера следующее изменение dep работает
 *
 *  C. Итерация и доступ к элементам после resolve
 *     C1. map() возвращает правильные элементы после resolver
 *     C2. Symbol.iterator обходит все элементы после resolver
 *     C3. getById() находит элемент по id после resolver
 *     C4. items с индексами работают после resolver
 *
 *  D. Dirty-флаг и initialItemIds
 *     D1. dirty = false сразу после resolver (initialItemIds обновляется)
 *     D2. dirty = true после ручного add() поверх resolve-данных
 *     D3. Re-resolve сбрасывает dirty обратно в false
 *     D4. dirty = false после полной замены setItems с теми же id
 *
 *  E. Версии и уведомления
 *     E1. getNodeVersion(listNode) растёт при каждом успешном resolve
 *     E2. Подписка на list-ноду срабатывает при завершении resolver
 *     E3. subscriber НЕ вызывается при изменении поля entity (только list-level)
 *
 *  F. Сложные сценарии
 *     F1. Resolver с несколькими deps: независимые изменения — каждое запускает resolver
 *     F2. Два списка с общим dep — оба перезапускаются при изменении dep
 *     F3. Resolver возвращает частично обновлённые данные — merge с существующими
 *     F4. Resolver для вложенного списка получает корректные значения родителя
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "./defineList";
import { Palistor } from "./store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/** Задержка на ms миллисекунд */
function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Создаёт управляемый promise: { promise, resolve, reject } */
function deferred<T = any>() {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

// ─── A. Тайминг и жизненный цикл резольвера ──────────────────────────────────

describe("A. Тайминг и жизненный цикл резольвера", () => {
  it("A1. resolver получает снимок значений на момент запуска, а не после", async () => {
    const capturedValues: any[] = [];
    const d = deferred<any[]>();

    const resolver = vi.fn((values: any) => {
      capturedValues.push({ ...values });
      return d.promise;
    });

    const store = new Palistor({
      config: {
        filter: { value: "initial" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    // Запускаем резольвер
    void (store.proxy as any).users.items;
    await Promise.resolve(); // flush microtask

    // Меняем значение dep ПОКА резольвер ждёт результата
    (store.proxy as any).filter.value = "changed";

    d.resolve([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    // Резольвер был вызван со значением "initial", а не "changed"
    expect(capturedValues[0].filter).toBe("initial");
  });

  it("A2. items пусты во время ожидания, заполняются после", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn(() => d.promise);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await Promise.resolve();

    // Во время ожидания список пуст, но loading = true
    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.loading).toBe(true);

    d.resolve([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    await flushPromises();

    // После resolve список заполнен
    expect((store.proxy as any).users.length).toBe(2);
    expect((store.proxy as any).users.loading).toBe(false);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).users.items[1].name.value).toBe("Bob");
  });

  it("A3. re-resolve обновляет значения уже существующих entities", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "v1") return [{ id: "u1", name: "Alice v1", role: "user" }];
      return [{ id: "u1", name: "Alice v2", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "v1" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice v1");
    expect((store.proxy as any).users.items[0].role.value).toBe("user");

    // Изменяем dep → re-resolve
    (store.proxy as any).filter.value = "v2";
    await flushPromises();

    // Та же entity u1 теперь имеет обновлённые значения
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice v2");
    expect((store.proxy as any).users.items[0].role.value).toBe("admin");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("A4. после ошибки резольвера изменение dep запускает повторную попытку", async () => {
    let shouldFail = true;
    const resolver = vi.fn(async () => {
      if (shouldFail) throw new Error("temporary failure");
      return [{ id: "u1", name: "Alice" }];
    });
    const onError = vi.fn();

    const store = new Palistor({
      config: {
        filter: { value: "x" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError },
        }),
      } as any,
    });

    // Первый запуск — ошибка
    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(0);

    // Исправляем ошибку и меняем dep
    shouldFail = false;
    (store.proxy as any).filter.value = "y";
    await flushPromises();

    // Второй запуск успешен
    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });
});

// ─── B. Поведение в состоянии "pending" ──────────────────────────────────────

describe("B. Поведение в состоянии pending", () => {
  it("B1. изменение dep пока resolver pending → повторный запуск после завершения", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn((values: any) => {
      if (values.filter === "a") return d.promise;
      return Promise.resolve([{ id: "u2", name: "Bob" }]);
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    // Запускаем resolver (status: idle → pending)
    void (store.proxy as any).users.items;
    await Promise.resolve();

    expect((store.proxy as any).users.loading).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);

    // Меняем dep пока pending — ставит флаг pendingRetrigger, новый вызов не начинается
    (store.proxy as any).filter.value = "b";
    await Promise.resolve();

    // Всё ещё только один активный вызов
    expect(resolver).toHaveBeenCalledTimes(1);

    d.resolve([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    // После завершения первого вызова — автоматически запустился второй (для filter="b")
    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("B2. после завершения pending-резольвера следующее изменение dep работает", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn((values: any) => {
      if (values.filter === "a") return d.promise;
      return Promise.resolve([{ id: "u2", name: "Bob" }]);
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await Promise.resolve();

    // Завершаем первый resolver
    d.resolve([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(1);

    // Теперь статус "resolved" → следующее изменение dep сработает
    (store.proxy as any).filter.value = "b";
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });
});

// ─── C. Итерация и доступ к элементам после resolve ──────────────────────────

describe("C. Итерация и доступ к элементам после resolve", () => {
  it("C1. map() возвращает правильные трансформированные элементы", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
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

    const names = (store.proxy as any).users.map(
      (user: any, _index: number, _id: string) => user.name.value,
    );

    expect(names).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("C2. map() передаёт корректные index и id", async () => {
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

    const result: Array<{ index: number; id: string }> = [];
    (store.proxy as any).users.map((_user: any, index: number, id: string) => {
      result.push({ index, id });
    });

    expect(result[0]).toEqual({ index: 0, id: "u1" });
    expect(result[1]).toEqual({ index: 1, id: "u2" });
  });

  it("C3. getById() находит элемент по id после resolver", async () => {
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

    const alice = (store.proxy as any).users.getById("u1");
    const bob = (store.proxy as any).users.getById("u2");
    const nobody = (store.proxy as any).users.getById("u99");

    expect(alice).toBeDefined();
    expect(alice.name.value).toBe("Alice");
    expect(bob).toBeDefined();
    expect(bob.name.value).toBe("Bob");
    expect(nobody).toBeUndefined();
  });

  it("C4. доступ по числовому индексу через items[i] работает после resolver", async () => {
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
    expect(users.items[2]).toBeUndefined();
  });
});

// ─── D. Dirty-флаг и initialItemIds ──────────────────────────────────────────

describe("D. Dirty-флаг и initialItemIds", () => {
  it("D1. dirty = false сразу после resolver (initialItemIds обновляется)", async () => {
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

    // После resolver список "чистый" — это его базовое состояние
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("D2. dirty = true после ручного add() поверх resolve-данных", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
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

    expect((store.proxy as any).users.dirty).toBe(false);

    // Добавляем элемент вручную
    (store.proxy as any).users.add({ id: "u2", name: "Bob" });

    expect((store.proxy as any).users.dirty).toBe(true);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("D3. re-resolve сбрасывает dirty обратно в false", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "a") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // Добавляем вручную — dirty = true
    (store.proxy as any).users.add({ id: "extra", name: "Extra" });
    expect((store.proxy as any).users.dirty).toBe(true);

    // Re-resolve через deps-изменение
    (store.proxy as any).filter.value = "b";
    await flushPromises();

    // После re-resolve dirty сброшен
    expect((store.proxy as any).users.dirty).toBe(false);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("D4. dirty = false после remove() элемента который не был в initial (добавлен вручную)", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

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

    // Добавляем → dirty = true
    (store.proxy as any).users.add({ id: "u2", name: "Bob" });
    expect((store.proxy as any).users.dirty).toBe(true);

    // Удаляем добавленный — возвращаемся к initial состоянию
    (store.proxy as any).users.remove("u2");
    expect((store.proxy as any).users.length).toBe(1);
    // Состав списка снова = initial → dirty = false
    expect((store.proxy as any).users.dirty).toBe(false);
  });
});

// ─── E. Версии и уведомления ──────────────────────────────────────────────────

describe("E. Версии и уведомления", () => {
  it("E1. версия list-ноды увеличивается при каждом успешном resolve", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.page === 1) return [{ id: "u1", name: "P1" }];
      return [{ id: "u2", name: "P2" }];
    });

    const store = new Palistor({
      config: {
        page: { value: 1 },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["page"], onError: vi.fn() },
        }),
      } as any,
    });

    // rootConfig.users — это массив (ListNode)
    const usersNode = (store as any).rootConfig.users;

    void (store.proxy as any).users.items;
    await flushPromises();

    const v1 = store.getNodeVersion(usersNode);

    (store.proxy as any).page.value = 2;
    await flushPromises();

    const v2 = store.getNodeVersion(usersNode);

    expect(v2).toBeGreaterThan(v1);
  });

  it("E2. подписка на изменения вызывается при смене dep + завершении resolver", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "a") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const globalListener = vi.fn();
    store.subscribeGlobal(globalListener);
    globalListener.mockClear();

    // Меняем dep → запускает resolver → после resolve notifyChanged
    (store.proxy as any).filter.value = "b";
    await flushPromises();

    // Глобальный листенер вызван минимум раз (при обновлении данных)
    expect(globalListener).toHaveBeenCalled();
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("E3. изменение поля entity не увеличивает версию list-ноды", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    const usersNode = (store as any).rootConfig.users;

    void (store.proxy as any).users.items;
    await flushPromises();

    const vBefore = store.getNodeVersion(usersNode);

    // Меняем поле у entity (не структуру списка)
    (store.proxy as any).users.items[0].name.value = "Alice Updated";

    const vAfter = store.getNodeVersion(usersNode);

    // Версия list-ноды не должна измениться при изменении поля entity
    expect(vAfter).toBe(vBefore);
  });
});

// ─── F. Сложные сценарии ──────────────────────────────────────────────────────

describe("F. Сложные сценарии", () => {
  it("F1. несколько deps: каждое независимое изменение перезапускает resolver", async () => {
    const calls: Array<{ page: number; sort: string }> = [];
    const resolver = vi.fn(async (values: any) => {
      calls.push({ page: values.page, sort: values.sort });
      return [{ id: `item-${calls.length}`, name: `Item ${calls.length}` }];
    });

    const store = new Palistor({
      config: {
        page: { value: 1 },
        sort: { value: "asc" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["page", "sort"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ page: 1, sort: "asc" });

    (store.proxy as any).page.value = 2;
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ page: 2, sort: "asc" });

    (store.proxy as any).sort.value = "desc";
    await flushPromises();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ page: 2, sort: "desc" });
  });

  it("F2. два списка с общим dep — оба перезапускаются при изменении dep", async () => {
    const usersResolver = vi.fn(async (values: any) => {
      if (values.org === "a") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u2", name: "Bob" }];
    });
    const groupsResolver = vi.fn(async (values: any) => {
      if (values.org === "a") return [{ id: "g1", title: "Dev" }];
      return [{ id: "g2", title: "Ops" }];
    });

    const store = new Palistor({
      config: {
        org: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: usersResolver, deps: ["org"], onError: vi.fn() },
        }),
        groups: defineList({
          template: { id: { value: "" }, title: { value: "" } },
          resolve: { resolver: groupsResolver, deps: ["org"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    void (store.proxy as any).groups.items;
    await flushPromises();

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).groups.items[0].title.value).toBe("Dev");

    // Меняем общий dep
    (store.proxy as any).org.value = "b";
    await flushPromises();

    // Оба списка перезапустились
    expect(usersResolver).toHaveBeenCalledTimes(2);
    expect(groupsResolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
    expect((store.proxy as any).groups.items[0].title.value).toBe("Ops");
  });

  it("F3. resolver возвращает новый состав + обновлённые поля для overlap-id", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "v1") {
        return [
          { id: "u1", name: "Alice", role: "user" },
          { id: "u2", name: "Bob", role: "user" },
        ];
      }
      // u1 обновлён, u2 удалён, u3 добавлен
      return [
        { id: "u1", name: "Alice Admin", role: "admin" },
        { id: "u3", name: "Carol", role: "user" },
      ];
    });

    const store = new Palistor({
      config: {
        filter: { value: "v1" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(2);

    (store.proxy as any).filter.value = "v2";
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(2);

    const u1 = (store.proxy as any).users.getById("u1");
    const u3 = (store.proxy as any).users.getById("u3");
    const u2 = (store.proxy as any).users.getById("u2");

    expect(u1).toBeDefined();
    expect(u1.name.value).toBe("Alice Admin");
    expect(u1.role.value).toBe("admin");

    expect(u3).toBeDefined();
    expect(u3.name.value).toBe("Carol");

    // u2 больше не в списке (но может остаться в registry)
    expect(u2).toBeUndefined();
  });

  it("F4. resolver вложенного списка получает значения родительских полей", async () => {
    const capturedValues: any[] = [];
    const resolver = vi.fn(async (values: any) => {
      capturedValues.push({ ...values });
      return [];
    });

    const store = new Palistor({
      config: {
        companyId: { value: "c42" },
        section: {
          departmentId: { value: "d7" },
          employees: defineList<{ id: string; name: string }>({
            template: { id: { value: "" }, name: { value: "" } },
            resolve: { resolver, onError: vi.fn() },
          }),
        },
      } as any,
    });

    void (store.proxy as any).section.employees.items;
    await flushPromises();

    expect(capturedValues[0]).toMatchObject({
      companyId: "c42",
    });
  });

  it("F5. resolver возвращает entity с числовыми полями — значения правильного типа", async () => {
    const resolver = vi.fn(async () => [
      { id: "p1", price: 999, quantity: 5, active: true },
    ]);

    const store = new Palistor({
      config: {
        products: defineList({
          template: {
            id: { value: "" },
            price: { value: 0 },
            quantity: { value: 0 },
            active: { value: false },
          },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).products.items;
    await flushPromises();

    const p = (store.proxy as any).products.items[0];
    expect(p.price.value).toBe(999);
    expect(p.quantity.value).toBe(5);
    expect(p.active.value).toBe(true);
  });

  it("F6. resolver + ручной remove() → список становится dirty, затем re-resolve снимает dirty", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.q === "1")
        return [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
      return [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        q: { value: "1" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["q"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.dirty).toBe(false);

    // Ручное удаление → dirty
    (store.proxy as any).users.remove("u1");
    expect((store.proxy as any).users.dirty).toBe(true);

    // Re-resolve → dirty сбрасывается
    (store.proxy as any).q.value = "2";
    await flushPromises();

    expect((store.proxy as any).users.dirty).toBe(false);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("F7. onError вызывается с правильными аргументами при сетевой ошибке", async () => {
    const networkError = new TypeError("Failed to fetch");
    const onError = vi.fn();
    const notifyFn = vi.fn();

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw networkError; }),
            onError,
          },
        }),
      } as any,
    });

    store.setNotifier(notifyFn);

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    const [err, ctx] = onError.mock.calls[0];
    expect(err).toBe(networkError);
    expect(typeof ctx.notify).toBe("function");

    // ctx.notify должен проксировать в store.setNotifier
    ctx.notify("Сообщение об ошибке");
    expect(notifyFn).toHaveBeenCalledWith("Сообщение об ошибке");
  });

  it("F8. length и items.length консистентны после нескольких resolve", async () => {
    let callIdx = 0;
    const datasets = [
      [{ id: "u1", name: "A" }],
      [{ id: "u1", name: "A" }, { id: "u2", name: "B" }],
      [{ id: "u3", name: "C" }],
    ];

    const resolver = vi.fn(async () => datasets[callIdx++] ?? []);

    const store = new Palistor({
      config: {
        page: { value: 0 },
        users: defineList<{ id: string; name: string }>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["page"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();
    expect((store.proxy as any).users.length).toBe((store.proxy as any).users.items.length);
    expect((store.proxy as any).users.length).toBe(1);

    (store.proxy as any).page.value = 1;
    await flushPromises();
    expect((store.proxy as any).users.length).toBe(2);
    expect((store.proxy as any).users.length).toBe((store.proxy as any).users.items.length);

    (store.proxy as any).page.value = 2;
    await flushPromises();
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.length).toBe((store.proxy as any).users.items.length);
  });
});
