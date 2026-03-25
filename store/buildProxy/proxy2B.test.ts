/**
 * Фаза 2B: тесты proxy для списков и EntityProjectionProxy.
 *
 * Покрывает:
 * - ListProxy: items, length, loading, add, remove, getById, setItems, map, Symbol.iterator
 * - EntityProjectionProxy: чтение value, formatter, setter, validate, isRequired
 * - Запись через proxy обновляет entity leaf
 * - List в valuesCache: values.users = [entityObj1, entityObj2, ...]
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

// ─── Test store factory ───────────────────────────────────────────────────────

const userTemplate = {
  id: { value: "" },
  name: { value: "" },
  role: { value: "" },
};

function makeListStore() {
  return new Palistor({
    config: {
      title: { value: "Users" },
      users: [userTemplate],
    } as any,
  });
}

function makeListStoreWithRules() {
  return new Palistor({
    config: {
      users: [
        {
          id: { value: "" },
          name: {
            value: "",
            formatter: (v: string) => v.trim(),
            validate: (v: string) => (!v ? "Name is required" : undefined),
          },
          age: {
            value: 0,
            isRequired: (vals: any) => Boolean(vals.name),
          },
        },
      ],
    } as any,
  });
}

function makeSingleUserStore() {
  return new Palistor({
    config: {
      users: [
        {
          id: { value: "" },
          name: { value: "" },
          role: { value: "user" },
        },
      ],
    } as any,
  });
}

// ─── ListProxy: базовый доступ ──────────────────────────────────────────────

describe("ListProxy — базовый доступ", () => {
  it("users.length === 0 при инициализации", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    expect(form.users.length).toBe(0);
  });

  it("users.items пустой при инициализации", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    expect(form.users.items).toEqual([]);
  });

  it("users.loading === false по умолчанию", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    expect(form.users.loading).toBe(false);
  });
});

// ─── ListProxy: add ───────────────────────────────────────────────────────────

describe("ListProxy.add(id)", () => {
  it("add(id) добавляет entity в список", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.length).toBe(1);
  });

  it("add(id) — items[0] является EntityProjectionProxy", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const item = form.users.items[0];
    expect(item).toBeDefined();
    expect(item.name.value).toBe("Alice");
  });

  it("add(id) не дублирует entity которая уже в списке", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u1");
    expect(form.users.length).toBe(1);
  });

  it("add(id) для несуществующей entity — no-op", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    form.users.add("nonexistent");
    expect(form.users.length).toBe(0);
  });

  it("add(id) уведомляет глобальных подписчиков", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.add("u1");
    expect(listener).toHaveBeenCalled();
  });
});

describe("ListProxy.add(values)", () => {
  it("add(values) создаёт entity и добавляет в список", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    form.users.add({ id: "u2", name: "Bob", role: "user" });
    expect(form.users.length).toBe(1);
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("add(values) items[0] отображает добавленную entity", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    form.users.add({ id: "u2", name: "Bob", role: "user" });
    expect(form.users.items[0].name.value).toBe("Bob");
  });
});

// ─── ListProxy: remove ────────────────────────────────────────────────────────

describe("ListProxy.remove(id)", () => {
  it("remove удаляет entity из списка", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    form.users.remove("u1");
    expect(form.users.length).toBe(1);
    expect(form.users.items[0].id).toBe("u2");
  });

  it("remove — entity остаётся в entityRegistry", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.remove("u1");
    expect(store.entityRegistry.get("u1")).toBeDefined();
  });

  it("remove несуществующего id — no-op", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.remove("nonexistent");
    expect(form.users.length).toBe(1);
  });

  it("remove уведомляет подписчиков", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.remove("u1");
    expect(listener).toHaveBeenCalled();
  });
});

// ─── ListProxy: getById / setItems / map ──────────────────────────────────────

describe("ListProxy.getById(id)", () => {
  it("getById возвращает proxy для entity в списке", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const found = form.users.getById("u1");
    expect(found).toBeDefined();
    expect(found.name.value).toBe("Alice");
  });

  it("getById возвращает undefined для entity не в списке", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    expect(form.users.getById("u1")).toBeUndefined();
  });
});

describe("ListProxy.setItems(ids)", () => {
  it("setItems заменяет список", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    store.set({ id: "u3", name: "Charlie", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    form.users.setItems(["u2", "u3"]);
    expect(form.users.length).toBe(2);
    expect(form.users.items[0].id).toBe("u2");
    expect(form.users.items[1].id).toBe("u3");
  });
});

describe("ListProxy.map(fn)", () => {
  it("map возвращает результаты маппинга", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    const names = form.users.map((item: any) => item.name.value);
    expect(names).toEqual(["Alice", "Bob"]);
  });
});

describe("ListProxy[Symbol.iterator]", () => {
  it("итерируется через все элементы", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    const names: string[] = [];
    for (const item of form.users) {
      names.push(item.name.value);
    }
    expect(names).toEqual(["Alice", "Bob"]);
  });
});

// ─── EntityProjectionProxy: чтение значений ──────────────────────────────────

describe("EntityProjectionProxy — чтение", () => {
  it("items[0].name.value возвращает значение entity", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.value).toBe("Alice");
  });

  it("items[0].id возвращает entity id", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].id).toBe("u1");
  });

  it("items[0].role.value отображает значение role", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].role.value).toBe("admin");
  });
});

// ─── EntityProjectionProxy: запись ───────────────────────────────────────────

describe("EntityProjectionProxy — запись", () => {
  it("proxy.name.value = 'X' обновляет entity leaf", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.items[0].name.value = "Alice Cooper";
    // Перечитываем значение
    expect(form.users.items[0].name.value).toBe("Alice Cooper");
  });

  it("запись уведомляет глобальных подписчиков", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.items[0].name.value = "Alice Cooper";
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("запись того же значения — no-op (нет notification)", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.items[0].name.value = "Alice"; // то же значение
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── EntityProjectionProxy: formatter ────────────────────────────────────────

describe("EntityProjectionProxy — formatter", () => {
  it("formatter применяется при записи", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "  Alice  ", age: 25 });
    // After store.set, name is stored as-is; formatter applies on write via proxy
    const form = store.proxy as any;
    form.users.add("u1");
    // Write through proxy — formatter trims the value
    form.users.items[0].name.value = "  Bob  ";
    expect(form.users.items[0].name.value).toBe("Bob");
  });
});

// ─── EntityProjectionProxy: validate ─────────────────────────────────────────

describe("EntityProjectionProxy — validate", () => {
  it("isInvalid = true если validate возвращает ошибку", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.isInvalid).toBe(true);
  });

  it("isInvalid = false если validate не возвращает ошибку", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "Alice", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.isInvalid).toBe(false);
  });

  it("errorMessage возвращает текст ошибки", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.errorMessage).toBe("Name is required");
  });

  it("errorMessage = undefined если нет ошибки", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "Alice", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.errorMessage).toBeUndefined();
  });
});

// ─── EntityProjectionProxy: isRequired computed ───────────────────────────────

describe("EntityProjectionProxy — isRequired (computed)", () => {
  it("isRequired вычисляется из entity values", () => {
    const store = makeListStoreWithRules();
    // age.isRequired: (vals) => Boolean(vals.name)
    store.set({ id: "u1", name: "Alice", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].age.isRequired).toBe(true);
  });

  it("isRequired = false когда depends field пустое", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].age.isRequired).toBe(false);
  });
});

// ─── valuesCache для списков ──────────────────────────────────────────────────

describe("valuesCache — list integration", () => {
  it("values.users пустой массив изначально", () => {
    const store = makeListStore();
    expect((store.getValues() as any).users).toEqual([]);
  });

  it("values.users обновляется после add", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const vals = store.values.values as any;
    expect(vals.users).toHaveLength(1);
    expect(vals.users[0].name).toBe("Alice");
  });

  it("entity projection obj является shared reference", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    const vals = store.values.values as any;
    const entityObj = vals.users[0];

    // Update via store.set — shared reference should update
    store.set({ id: "u1", name: "Alice Cooper" });
    expect(entityObj.name).toBe("Alice Cooper");
    // valuesCache.values.users[0] is also updated (same reference)
    expect(vals.users[0].name).toBe("Alice Cooper");
  });

  it("values.users обновляется после remove", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    form.users.remove("u1");
    const vals = store.values.values as any;
    expect(vals.users).toHaveLength(1);
    expect(vals.users[0].name).toBe("Bob");
  });

  it("isVisible в computed field использует values.users.length", () => {
    const store = new Palistor({
      config: {
        title: { value: "List" },
        deleteBtn: {
          value: false,
          // Safe optional chaining: users may be undefined during initial registerNodes pass
          isVisible: (values: any) => ((values.users as unknown[]) ?? []).length > 0,
        },
        users: [{ id: { value: "" }, name: { value: "" } }],
      } as any,
    });
    const form = store.proxy as any;

    expect(form.deleteBtn.isVisible).toBe(false);

    store.set({ id: "u1", name: "Alice" });
    form.users.add("u1");

    // After re-read (recompute happens on add notification):
    // isVisible should now reflect that users.length > 0
    expect(form.deleteBtn.isVisible).toBe(true);
  });
});

// ─── Stable proxy references ──────────────────────────────────────────────────

describe("Стабильность ссылок на proxy", () => {
  it("items[0] в разных обращениях — один и тот же proxy", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const proxy1 = form.users.items[0];
    const proxy2 = form.users.items[0];
    expect(proxy1).toBe(proxy2);
  });

  it("items[0].name в разных обращениях — один и тот же proxy", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const nameProxy1 = form.users.items[0].name;
    const nameProxy2 = form.users.items[0].name;
    expect(nameProxy1).toBe(nameProxy2);
  });
});

// ─── Store.set() + list write через EntityProjectionProxy ────────────────────

describe("store.set() + EntityProjectionProxy sync", () => {
  it("store.set обновляет значение прочитанное через list proxy", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    store.set({ id: "u1", name: "Alice Updated" });
    expect(form.users.items[0].name.value).toBe("Alice Updated");
  });

  it("EntityProjectionProxy write обновляет entityRegistry leaf", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    form.users.items[0].name.value = "Alice Cooper";

    const entity = store.entityRegistry.get("u1")!;
    const nameLeaf = entity.name as { value: unknown };
    expect(nameLeaf.value).toBe("Alice Cooper");
  });
});
