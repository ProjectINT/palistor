import { describe, it, expect } from "vitest";
import { NodeRegistry } from "./NodeRegistry/nodeRegistry";
import type { AnyConfigNode } from "./types";

// ─── Тестовые конфиги ─────────────────────────────────────────────────────────

const flat = {
  email: { value: "" },
  name: { value: "Alice" },
  age: { value: 0 },
} as unknown as AnyConfigNode;

const nested = {
  email: { value: "" },
  passport: {
    number: { value: "" },
    issueDate: { value: "" },
  },
  address: {
    city: {
      name: { value: "" },
    },
  },
} as unknown as AnyConfigNode;

const withComputed = {
  paymentType: { value: "card" },
  passport: {
    isVisible: (values: any) => values.paymentType === "bank",
    number: { value: "" },
  },
} as unknown as AnyConfigNode;

const translate = (v: string) => v;

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("NodeRegistry", () => {
  describe("конструктор — инициализация узлов", () => {
    it("регистрирует все листовые узлы", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const leafPaths = reg.leafNodes.map((e) => e.path);
      expect(leafPaths).toContain("email");
      expect(leafPaths).toContain("name");
      expect(leafPaths).toContain("age");
    });

    it("устанавливает начальное состояние для листьев", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const emailState = reg.nodeState.get((flat as any).email);
      expect(emailState).toBeDefined();
      expect(emailState!.value).toBe("");
      expect(emailState!.isVisible).toBe(true);
    });

    it("применяет initialValues из конструктора", () => {
      const reg = new NodeRegistry(flat, { name: "Bob" }, translate);
      const nameState = reg.nodeState.get((flat as any).name);
      expect(nameState!.value).toBe("Bob");
    });

    it("строит nodePaths для всех узлов вложенной структуры", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.nodePaths.get((nested as any).passport.number)).toBe("passport.number");
      expect(reg.nodePaths.get((nested as any).address.city.name)).toBe("address.city.name");
    });

    it("строит nodeParents для дочерних узлов", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.nodeParents.get((nested as any).passport.number)).toBe((nested as any).passport);
      expect(reg.nodeParents.get((nested as any).passport)).toBe(nested);
    });

    it("инициализирует submitting для корня и вложенных групп", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const rootState = reg.nodeState.get(nested);
      expect(rootState).toBeDefined();
      expect(rootState!.submitting).toBe(false);
      const passportState = reg.nodeState.get((nested as any).passport);
      expect(passportState!.submitting).toBe(false);
    });

    it("регистрирует листья вложенных уровней", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const paths = reg.leafNodes.map((e) => e.path);
      expect(paths).toContain("email");
      expect(paths).toContain("passport.number");
      expect(paths).toContain("passport.issueDate");
      expect(paths).toContain("address.city.name");
    });
  });

  describe("getState / setState", () => {
    it("getState возвращает состояние листового узла", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const state = reg.getState((flat as any).email);
      expect(state).toBeDefined();
      expect(state!.value).toBe("");
    });

    it("getState возвращает undefined для незарегистрированного узла", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.getState({})).toBeUndefined();
    });

    it("setState обновляет состояние узла", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      const node = (flat as any).email;
      const current = reg.getState(node)!;
      reg.setState(node, { ...current, value: "new@test.com" });
      expect(reg.getState(node)!.value).toBe("new@test.com");
    });
  });

  describe("getPath / getParent", () => {
    it("getPath возвращает dot-путь узла", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getPath((nested as any).passport.number)).toBe("passport.number");
      expect(reg.getPath((nested as any).email)).toBe("email");
    });

    it("getPath возвращает undefined для корневого узла", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getPath(nested)).toBeUndefined();
    });

    it("getParent возвращает непосредственного родителя", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getParent((nested as any).passport.number)).toBe((nested as any).passport);
      expect(reg.getParent((nested as any).passport)).toBe(nested);
    });

    it("getParent возвращает undefined для корневого узла", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getParent(nested)).toBeUndefined();
    });
  });

  describe("getGroupPath", () => {
    it("листовой узел → path родительской группы", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getGroupPath((nested as any).passport.number)).toBe("passport");
    });

    it("корневой лист → пустая строка", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.getGroupPath((flat as any).email)).toBe("");
    });

    it("групповой узел → собственный path", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getGroupPath((nested as any).passport)).toBe("passport");
    });

    it("корневой группа → пустая строка", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.getGroupPath(nested)).toBe("");
    });
  });

  describe("findByPath", () => {
    it("находит лист по точному пути", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.findByPath("passport.number")).toBe((nested as any).passport.number);
      expect(reg.findByPath("email")).toBe((nested as any).email);
    });

    it("возвращает undefined для несуществующего пути", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.findByPath("nonexistent")).toBeUndefined();
    });

    it("возвращает undefined для пути к группе (группы не в leafNodes)", () => {
      // Группы без computed-props не попадают в leafNodes
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.findByPath("passport")).toBeUndefined();
    });
  });

  describe("isLeaf / isGroup", () => {
    it("isLeaf возвращает true для листового узла", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.isLeaf((flat as any).email)).toBe(true);
    });

    it("isLeaf возвращает false для группового узла", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.isLeaf((nested as any).passport)).toBe(false);
    });

    it("isGroup возвращает true для группового узла", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      expect(reg.isGroup((nested as any).passport)).toBe(true);
    });

    it("isGroup возвращает false для листового узла", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      expect(reg.isGroup((flat as any).email)).toBe(false);
    });
  });

  describe("forEachLeaf", () => {
    it("итерирует по всем листьям", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const collected: string[] = [];
      reg.forEachLeaf((entry) => collected.push(entry.path));
      expect(collected).toContain("email");
      expect(collected).toContain("passport.number");
      expect(collected).toContain("passport.issueDate");
      expect(collected).toContain("address.city.name");
    });
  });

  describe("groupLeafMap и proxyCache", () => {
    it("groupLeafMap заполняется при инициализации", () => {
      const reg = new NodeRegistry(nested, {}, translate);
      const passportLeaves = reg.groupLeafMap.get((nested as any).passport);
      expect(passportLeaves).toBeDefined();
      expect(passportLeaves!.length).toBeGreaterThan(0);
    });

    it("proxyCache изначально пустой (заполняется лениво через buildProxy)", () => {
      const reg = new NodeRegistry(flat, {}, translate);
      // proxyCache пустой — proxy ещё не созданы
      expect(reg.proxyCache.get((flat as any).email)).toBeUndefined();
    });
  });

  describe("узлы с computed-props на группе", () => {
    it("группа с isVisible попадает в leafNodes как виртуальный лист", () => {
      const reg = new NodeRegistry(withComputed, {}, translate);
      const paths = reg.leafNodes.map((e) => e.path);
      // passport — групповой узел с isVisible функцией → должен быть в leafNodes
      expect(paths).toContain("passport");
    });
  });
});
