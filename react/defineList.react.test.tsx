/**
 * Тесты: defineList + useForm в React
 *
 * Проверяет, что список можно объявить, зарезолвить и получить
 * доступ ко всем items через useForm в компоненте.
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── defineList + useForm: доступ к items в компоненте ───────────────────────

describe("defineList + useForm — консоль списка в React", () => {
  it("после resolve items доступны через useForm и можно вызвать console.log", async () => {
    const mockData = [
      { id: "p1", name: "Alice", age: 30 },
      { id: "p2", name: "Bob", age: 25 },
      { id: "p3", name: "Carol", age: 35 },
    ];

    const resolver = vi.fn(async () => mockData);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const store = new Palistor({
      config: {
        people: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            age: { value: 0 },
          },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    function PeopleList() {
      const form = useForm(store);
      const people = (form as any).people;

      // Доступ к items → триггерит lazy-resolve
      const items: any[] = people.items;

      // Консолим весь список как плейн-объекты
      console.log("list:", people.getValues());

      return (
        <ul>
          {items.map((p: any, i: number) => (
            <li key={i} data-testid={`person-${i}`}>
              {p.name.value} ({p.age.value})
            </li>
          ))}
        </ul>
      );
    }

    render(<PeopleList />);

    // Ждём выполнения resolver
    await act(async () => {
      await flushPromises();
    });

    // Resolver вызван
    expect(resolver).toHaveBeenCalledTimes(1);

    // Все три элемента отрендерены
    expect(screen.getByTestId("person-0").textContent).toBe("Alice (30)");
    expect(screen.getByTestId("person-1").textContent).toBe("Bob (25)");
    expect(screen.getByTestId("person-2").textContent).toBe("Carol (35)");

    // console.log вызван с правильными данными (хотя бы один раз после resolve)
    const calls = consoleSpy.mock.calls;
    const loggedWithData = calls.find(
      (args) =>
        Array.isArray(args[1]) &&
        args[1].length === 3 &&
        args[1][0].name === "Alice" &&
        args[1][1].name === "Bob" &&
        args[1][2].name === "Carol",
    );
    expect(loggedWithData).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("loading=true пока resolver выполняется, false после", async () => {
    let resolveList!: (data: any[]) => void;
    const resolver = vi.fn(
      () =>
        new Promise<any[]>((r) => {
          resolveList = r;
        }),
    );

    const store = new Palistor({
      config: {
        items: defineList({
          template: { id: { value: "" }, title: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    const loadingStates: boolean[] = [];

    function ItemList() {
      const form = useForm(store);
      const list = (form as any).items;
      loadingStates.push(list.loading);
      void list.items; // trigger lazy resolve
      return <div data-testid="count">{list.length}</div>;
    }

    render(<ItemList />);

    await act(async () => {
      await flushPromises();
    });

    // Пока Promise не resolved — loading должен был побывать в true
    expect(loadingStates.some((v) => v === true)).toBe(true);

    await act(async () => {
      resolveList([
        { id: "i1", title: "First" },
        { id: "i2", title: "Second" },
      ]);
      await flushPromises();
    });

    expect(screen.getByTestId("count").textContent).toBe("2");
    // После resolve — loading false
    expect(loadingStates[loadingStates.length - 1]).toBe(false);
  });
});

// ─── defineList + useForm entity mode: поля списка доступны через другой конфиг ──

describe("defineList + useForm entity mode — поля из резолва списка в другом конфиге", () => {
  it("после resolve списка все поля entity доступны через другой конфиг (editForm)", async () => {
    const mockData = [
      { id: "p1", name: "Alice", age: 30, status: "active" },
      { id: "p2", name: "Bob", age: 25, status: "inactive" },
    ];

    const listResolver = vi.fn(async () => mockData);

    const store = new Palistor({
      config: {
        // Список объявлен с шаблоном, содержащим все поля
        people: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            age: { value: 0 },
            status: { value: "" },
          },
          resolve: { resolver: listResolver, onError: vi.fn() },
        }),
        // Отдельный конфиг для редактирования одной entity
        editPersonForm: {
          id: { value: "" },
          name: { value: "" },
          age: { value: 0 },
          status: { value: "" },
        },
      } as any,
    });

    // Рендерим список — тригерит resolve
    function PeopleListApp() {
      const form = useForm(store);
      const people = (form as any).people;
      void people.items; // триггер lazy-resolve
      return (
        <ul>
          {people.map((p: any, _i: number, id: string) => (
            <li key={id} data-testid={`row-${id}`}>
              {p.name.value}
            </li>
          ))}
        </ul>
      );
    }

    render(<PeopleListApp />);

    // Ждём завершения resolver
    await act(async () => {
      await flushPromises();
    });

    expect(listResolver).toHaveBeenCalledTimes(1);

    // Берём первую entity из списка
    const aliceProxy = (store.proxy as any).people.items[0];

    // Открываем entity через другой конфиг (editPersonForm)
    const { result } = renderHook(() =>
      useForm(aliceProxy, (s: any) => s.editPersonForm),
    );

    const editForm = result.current as any;

    // Все поля, загруженные резолвером списка, доступны в editPersonForm.
    // id возвращается напрямую как строка (entity projection proxy особый случай).
    expect(editForm.id).toBe("p1");
    expect(editForm.name.value).toBe("Alice");
    expect(editForm.age.value).toBe(30);
    expect(editForm.status.value).toBe("active");
  });

  it("поля второй entity из списка корректно доступны через editForm", async () => {
    const mockData = [
      { id: "p1", name: "Alice", age: 30, status: "active" },
      { id: "p2", name: "Bob", age: 25, status: "inactive" },
    ];

    const listResolver = vi.fn(async () => mockData);

    const store = new Palistor({
      config: {
        people: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            age: { value: 0 },
            status: { value: "" },
          },
          resolve: { resolver: listResolver, onError: vi.fn() },
        }),
        editPersonForm: {
          id: { value: "" },
          name: { value: "" },
          age: { value: 0 },
          status: { value: "" },
        },
      } as any,
    });

    function PeopleListApp() {
      const form = useForm(store);
      const people = (form as any).people;
      void people.items;
      return <div />;
    }

    render(<PeopleListApp />);

    await act(async () => {
      await flushPromises();
    });

    // Вторая entity
    const bobProxy = (store.proxy as any).people.items[1];

    const { result } = renderHook(() =>
      useForm(bobProxy, (s: any) => s.editPersonForm),
    );

    const editForm = result.current as any;

    expect(editForm.id).toBe("p2");
    expect(editForm.name.value).toBe("Bob");
    expect(editForm.age.value).toBe(25);
    expect(editForm.status.value).toBe("inactive");
  });
});

// ─── store.set() upsert — React видит обновление ─────────────────────────────

describe("store.set() upsert — React получает сигнал и видит обновлённые данные", () => {
  it("store.set обновляет entity в списке — компонент ре-рендерится с новым значением", () => {
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" }, role: { value: "" } },
        ],
      } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "viewer" });
    store.set({ id: "u2", name: "Bob", role: "viewer" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const renderCount = vi.fn();

    function UserList() {
      renderCount();
      const form = useForm(store);
      const users = (form as any).users;
      return (
        <ul>
          {users.map((u: any, _i: number, id: string) => (
            <li key={id} data-testid={`user-${id}`}>
              {u.name.value} / {u.role.value}
            </li>
          ))}
        </ul>
      );
    }

    render(<UserList />);
    expect(screen.getByTestId("user-u1").textContent).toBe("Alice / viewer");
    expect(screen.getByTestId("user-u2").textContent).toBe("Bob / viewer");

    const rendersBefore = renderCount.mock.calls.length;

    // Обновляем только u1 — только её поля меняются
    act(() => {
      store.set({ id: "u1", name: "Alice Updated", role: "admin" });
    });

    // Компонент ре-рендерился
    expect(renderCount.mock.calls.length).toBeGreaterThan(rendersBefore);

    // DOM обновлён для u1
    expect(screen.getByTestId("user-u1").textContent).toBe("Alice Updated / admin");
    // u2 не изменился
    expect(screen.getByTestId("user-u2").textContent).toBe("Bob / viewer");
  });

  it("store.set обновляет только одно поле entity — компонент, читающий другое поле, не ре-рендерится", () => {
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" }, role: { value: "" } },
        ],
      } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "viewer" });
    (store.proxy as any).users.add("u1");

    const roleRenderCount = vi.fn();

    // Компонент читает ТОЛЬКО role — должен реагировать только на изменение role
    function RoleDisplay() {
      roleRenderCount();
      const form = useForm(store);
      const users = (form as any).users;
      return <span data-testid="role">{users.items[0].role.value}</span>;
    }

    render(<RoleDisplay />);
    const rendersBefore = roleRenderCount.mock.calls.length;

    // Меняем только name — role не трогаем
    act(() => {
      store.set({ id: "u1", name: "Alice Updated" });
    });

    // role не изменился — компонент не должен ре-рендериться
    // (tracking proxy записал только чтение role.value)
    expect(roleRenderCount.mock.calls.length).toBe(rendersBefore);
    expect(screen.getByTestId("role").textContent).toBe("viewer");
  });

  it("store.set обновляет несколько entities — компонент видит все обновления за один render", () => {
    const store = new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" } },
        ],
      } as any,
    });

    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
    ]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");
    (store.proxy as any).users.add("u3");

    const renderCount = vi.fn();

    function UserList() {
      renderCount();
      const form = useForm(store);
      const users = (form as any).users;
      return (
        <ul>
          {users.map((u: any, _i: number, id: string) => (
            <li key={id} data-testid={`user-${id}`}>{u.name.value}</li>
          ))}
        </ul>
      );
    }

    render(<UserList />);
    const rendersBefore = renderCount.mock.calls.length;

    // Batch update — все три entity за один store.set
    act(() => {
      store.set([
        { id: "u1", name: "Alice v2" },
        { id: "u2", name: "Bob v2" },
        { id: "u3", name: "Carol v2" },
      ]);
    });

    // Один batch → один ре-рендер
    expect(renderCount.mock.calls.length).toBe(rendersBefore + 1);

    // Все обновления видны в DOM
    expect(screen.getByTestId("user-u1").textContent).toBe("Alice v2");
    expect(screen.getByTestId("user-u2").textContent).toBe("Bob v2");
    expect(screen.getByTestId("user-u3").textContent).toBe("Carol v2");
  });
});
