import { describe, it, expect } from "vitest";
import {
  createGroupDeps,
  getRecipientGroups,
  getNodeGroupPath,
  resolveGroupByPath,
  createTrackingValues,
  pairKey,
} from "./groupDeps";
import { buildNodeMaps } from "./nodeMap";
import type { AnyConfigNode } from "./collectValues";

// ─── Хелперы ─────────────────────────────────────────────────────────────────

/** Построить nodePaths + nodeParents для конфига. */
function buildMaps(root: AnyConfigNode) {
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(root, nodePaths, nodeParents);
  return { nodePaths, nodeParents };
}

// ─── Тестовые конфиги ────────────────────────────────────────────────────────

/** Плоский конфиг: одна корневая группа, 3 листа. */
function flatConfig() {
  return {
    email: { value: "" },
    name: { value: "" },
    age: { value: 0 },
  } as unknown as AnyConfigNode;
}

/** Конфиг с одной вложенной группой. */
function nestedConfig() {
  return {
    paymentType: { value: "card" },
    amount: { value: 0 },
    passport: {
      // группа (нет value)
      number: { value: "" },
      issueDate: { value: "" },
      expiryDate: {
        value: "",
        dependencies: ["passport.issueDate"],
      },
    },
  } as unknown as AnyConfigNode;
}

/** Конфиг с двумя вложенными группами. */
function twoGroupsConfig() {
  return {
    paymentType: { value: "card" },
    passport: {
      number: { value: "" },
    },
    address: {
      country: { value: "" },
      city: { value: "" },
    },
  } as unknown as AnyConfigNode;
}

// ─── createGroupDeps ─────────────────────────────────────────────────────────

describe("createGroupDeps", () => {
  it("создаёт self-зависимость для корня (плоский конфиг)", () => {
    const root = flatConfig();
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    expect(deps.has(pairKey("", ""))).toBe(true);
    expect(deps.size).toBe(1); // только root → root
  });

  it("создаёт self-зависимости для корня и вложенной группы", () => {
    const root = nestedConfig();
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    expect(deps.has(pairKey("", ""))).toBe(true);
    expect(deps.has(pairKey("passport", "passport"))).toBe(true);
    expect(deps.size).toBe(2);
  });

  it("создаёт self-зависимости для нескольких вложенных групп", () => {
    const root = twoGroupsConfig();
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    expect(deps.has(pairKey("", ""))).toBe(true);
    expect(deps.has(pairKey("passport", "passport"))).toBe(true);
    expect(deps.has(pairKey("address", "address"))).toBe(true);
    expect(deps.size).toBe(3);
  });
});

// ─── getRecipientGroups ──────────────────────────────────────────────────────

describe("getRecipientGroups", () => {
  it("возвращает пустой массив при только self-зависимостях", () => {
    const deps = new Set([pairKey("", ""), pairKey("passport", "passport")]);
    expect(getRecipientGroups(deps, "")).toEqual([]);
    expect(getRecipientGroups(deps, "passport")).toEqual([]);
  });

  it("находит реципиентов по донору", () => {
    const deps = new Set([
      pairKey("", ""),
      pairKey("passport", "passport"),
      pairKey("", "passport"),  // root → passport
    ]);

    expect(getRecipientGroups(deps, "")).toEqual(["passport"]);
    expect(getRecipientGroups(deps, "passport")).toEqual([]);
  });

  it("находит несколько реципиентов", () => {
    const deps = new Set([
      pairKey("", ""),
      pairKey("passport", "passport"),
      pairKey("address", "address"),
      pairKey("", "passport"),   // root → passport
      pairKey("", "address"),    // root → address
    ]);

    const recipients = getRecipientGroups(deps, "");
    expect(recipients).toContain("passport");
    expect(recipients).toContain("address");
    expect(recipients.length).toBe(2);
  });
});

// ─── getNodeGroupPath ────────────────────────────────────────────────────────

describe("getNodeGroupPath", () => {
  it("возвращает '' для листа в корневой группе", () => {
    const root = nestedConfig();
    const { nodePaths, nodeParents } = buildMaps(root);

    // paymentType — лист в корне
    const path = getNodeGroupPath(root.paymentType as object, nodeParents, nodePaths);
    expect(path).toBe("");
  });

  it("возвращает путь группы для листа во вложенной группе", () => {
    const root = nestedConfig();
    const { nodePaths, nodeParents } = buildMaps(root);

    const passport = root.passport as AnyConfigNode;
    const path = getNodeGroupPath(passport.number as object, nodeParents, nodePaths);
    expect(path).toBe("passport");
  });

  it("возвращает '' для самого rootConfig (группового узла без пути)", () => {
    const root = nestedConfig();
    const { nodePaths, nodeParents } = buildMaps(root);

    const path = getNodeGroupPath(root, nodeParents, nodePaths);
    expect(path).toBe("");
  });

  it("возвращает собственный путь для группового узла", () => {
    const root = nestedConfig();
    const { nodePaths, nodeParents } = buildMaps(root);

    const passport = root.passport as AnyConfigNode;
    const path = getNodeGroupPath(passport, nodeParents, nodePaths);
    expect(path).toBe("passport");
  });
});

// ─── resolveGroupByPath ──────────────────────────────────────────────────────

describe("resolveGroupByPath", () => {
  it("'' → rootConfig", () => {
    const root = nestedConfig();
    expect(resolveGroupByPath(root, "")).toBe(root);
  });

  it("'passport' → вложенная группа", () => {
    const root = nestedConfig();
    expect(resolveGroupByPath(root, "passport")).toBe(root.passport);
  });
});

// ─── createTrackingValues ────────────────────────────────────────────────────

describe("createTrackingValues", () => {
  it("записывает кросс-групповую зависимость при чтении leaf из другой группы", () => {
    const values = {
      paymentType: "card",
      amount: 100,
      passport: {
        number: "123",
        issueDate: "2024-01-01",
      },
    };
    const deps = new Set<string>();

    // Реципиент — passport, читаем paymentType (root)
    const tracked = createTrackingValues(values, "passport", deps);
    const _ = tracked.paymentType; // чтение из root

    expect(deps.has(pairKey("", "passport"))).toBe(true);
  });

  it("НЕ записывает self-зависимость при чтении внутри своей группы", () => {
    const values = {
      paymentType: "card",
      passport: {
        number: "123",
        issueDate: "2024-01-01",
      },
    };
    const deps = new Set<string>();

    // Реципиент — passport, читаем из passport.number (тоже passport)
    const tracked = createTrackingValues(values, "passport", deps);
    const passportProxy = tracked.passport as Record<string, unknown>;
    const _ = passportProxy.number; // чтение из passport → passport (self)

    // Не должно быть кросс-групповой зависимости
    expect(deps.size).toBe(0);
  });

  it("записывает зависимость при чтении вложенной группы из root-реципиента", () => {
    const values = {
      paymentType: "card",
      passport: {
        number: "123",
      },
    };
    const deps = new Set<string>();

    // Реципиент — root (""), читаем from passport
    const tracked = createTrackingValues(values, "", deps);
    const passportProxy = tracked.passport as Record<string, unknown>;
    const _ = passportProxy.number; // чтение из passport

    expect(deps.has(pairKey("passport", ""))).toBe(true);
  });

  it("возвращает правильные значения (прозрачность)", () => {
    const values = {
      paymentType: "card",
      passport: { number: "ABC" },
    };
    const deps = new Set<string>();
    const tracked = createTrackingValues(values, "", deps);

    expect(tracked.paymentType).toBe("card");
    const p = tracked.passport as Record<string, unknown>;
    expect(p.number).toBe("ABC");
  });

  it("обрабатывает глубоко вложенные группы", () => {
    const values = {
      topField: "x",
      level1: {
        l1Field: "a",
        level2: {
          l2Field: "b",
        },
      },
    };
    const deps = new Set<string>();

    // Реципиент — level1.level2, читаем из root
    const tracked = createTrackingValues(values, "level1.level2", deps);
    const _ = tracked.topField; // root → level1.level2

    expect(deps.has(pairKey("", "level1.level2"))).toBe(true);
  });
});

// ─── Интеграция: tracking при recompute ──────────────────────────────────────

describe("tracking integration", () => {
  it("обнаруживает кросс-групповую зависимость через isVisible", () => {
    // Симуляция: passport.number isVisible читает paymentType (root)
    // и записывает root→passport зависимость
    const deps = new Set([pairKey("", ""), pairKey("passport", "passport")]);
    const values = { paymentType: "bank" };

    // Эмулируем вычисление isVisible для passport.number
    const tracked = createTrackingValues(
      values as Record<string, unknown>,
      "passport",
      deps,
    );
    // isVisible: (values) => values.paymentType === "bank"
    const isVisible = tracked.paymentType === "bank";

    expect(isVisible).toBe(true);
    // root → passport зависимость должна быть записана
    expect(deps.has(pairKey("", "passport"))).toBe(true);

    // Теперь getRecipientGroups должен найти passport как реципиента root
    expect(getRecipientGroups(deps, "")).toEqual(["passport"]);
  });
});
