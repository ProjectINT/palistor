/**
 * Тесты: defineList + useForm в React
 *
 * Проверяет, что список можно объявить, зарезолвить и получить
 * доступ ко всем items через useForm в компоненте.
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
