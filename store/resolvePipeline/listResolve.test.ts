/**
 * Фаза 2C: тесты для List resolver + React tracking + Dirty для списков.
 *
 * Покрывает:
 * 2C.1 - List resolver: resolver загружает список → entities созданы → proxy работает.
 * 2C.2 - rekey обновляет itemIds во всех списках.
 * 2C.3 - List tracking: version++ при add/remove → re-render (через getNodeVersion).
 *         Entity leaf change → только leaf нода меняет версию (не весь список).
 * 2C.4 - Dirty: добавление/удаление → dirty. После resolve → clean.
 * 2C.5 - Интеграция полного сценария.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";
import { LIST_STATE } from "../constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const userTemplate = {
  id: { value: "" },
  name: { value: "" },
  role: { value: "user" },
};

// ─── 2C.1: List resolver ─────────────────────────────────────────────────────

describe("2C.1: List resolver", () => {
  it("resolver загружает список → entities созданы в registry", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // Trigger lazy resolve by accessing items
    const form = store.proxy as any;
    void form.users.items; // triggers lazy resolve

    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("resolver загружает список → listState.itemIds обновлён", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(2);
  });

  it("root list loading берётся из resolve-state (единый источник, U5)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const resolver = vi.fn(async () => {
      await gate;
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }],
      } as any,
    });

    const listProxy = (store.proxy as any).users;
    const listState = listProxy[LIST_STATE] as object;
    const rm = store.resolveManager as any;

    // До доступа: resolve idle → loading false. loading === (status === "pending").
    expect(rm.getListResolveState(listState).status).toBe("idle");
    expect(listProxy.loading).toBe(false);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");

    // Доступ к items → lazy resolve (deferred queueMicrotask) → resolver висит на gate.
    void listProxy.items;
    await flushPromises();

    // Pending: loading === true, и это РОВНО статус resolve-state (не nodeState).
    expect(rm.getListResolveState(listState).status).toBe("pending");
    expect(listProxy.loading).toBe(true);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");

    release();
    await flushPromises();

    // Resolved: loading false, источник тот же.
    expect(rm.getListResolveState(listState).status).toBe("resolved");
    expect(listProxy.loading).toBe(false);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");
  });

  it("resolver загружает список → proxy items отображает entities", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const users = (store.proxy as any).users;
    expect(users.items[0].name.value).toBe("Alice");
    expect(users.items[0].role.value).toBe("admin");
  });

  it("loading: true пока resolver выполняется", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(
      () => new Promise<any[]>((r) => { resolvePromise = r; }),
    );

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;

    // Flush microtask — triggerResolve is deferred to avoid setState-in-render
    await Promise.resolve();

    expect((store.proxy as any).users.loading).toBe(true);

    resolvePromise([{ id: "u1", name: "Alice", role: "admin" }]);
    await flushPromises();

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading: false если resolver не задан", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("resolver уведомляет глобальных подписчиков после успешного resolve", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice", role: "admin" }]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    const listener = vi.fn();
    store.subscribeGlobal(listener);
    listener.mockClear();

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(listener).toHaveBeenCalled();
  });

  it("resolver — eager (lazy: false) запускается сразу при init", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice", role: "admin" }]);

    new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn(), options: { lazy: false } } },
        ],
      } as any,
    });

    // Resolver вызывается немедленно (eager)
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("onError вызывается при ошибке resolver", async () => {
    const onError = vi.fn();
    const resolver = vi.fn(async () => { throw new Error("network error"); });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ notify: expect.any(Function) }));
    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("resolver обновляет initialItemIds → dirty = false после resolve", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // После resolve → clean (initialItemIds == itemIds)
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("resolver не создаёт дублей при повторном доступе", async () => {
    let callCount = 0;
    const resolver = vi.fn(async () => {
      callCount++;
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

    // Multiple accesses while pending → deduplication
    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;

    await flushPromises();
    expect(callCount).toBe(1);
  });

  it("resolver получает store вторым аргументом", async () => {
    let capturedStore: unknown;
    const resolver = vi.fn(async (_values: unknown, store: unknown) => {
      capturedStore = store;
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

    void (store.proxy as any).users.items;
    await flushPromises();

    // storeProxy оборачивает store для отслеживания context-зависимостей,
    // поэтому capturedStore !== store по ссылке, но делегирует все остальные свойства
    expect((capturedStore as any).entityRegistry).toBe(store.entityRegistry);
  });
});

// ─── 2C.2: rekey — обновление itemIds ─────────────────────────────────────────

describe("2C.2: rekey() — обновление itemIds", () => {
  it("rekey обновляет id entity", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "_tmp_abc", name: "Alice", role: "user" });
    (store.proxy as any).users.add("_tmp_abc");

    store.rekey("_tmp_abc", "u1");

    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("_tmp_abc")).toBeUndefined();
  });

  it("rekey обновляет itemIds в ListState", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "_tmp_abc", name: "Alice", role: "user" });
    (store.proxy as any).users.add("_tmp_abc");
    expect((store.proxy as any).users.length).toBe(1);

    store.rekey("_tmp_abc", "u1");

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });

  it("rekey обновляет itemIds в нескольких списках", () => {
    const store = new Palistor({
      config: {
        users: [userTemplate],
        admins: [userTemplate],
      } as any,
    });

    store.set({ id: "_tmp1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("_tmp1");
    (store.proxy as any).admins.add("_tmp1");

    store.rekey("_tmp1", "realId1");

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).admins.items[0].name.value).toBe("Alice");
  });

  it("rekey уведомляет подписчиков", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "_tmp_x", name: "Bob", role: "user" });

    const listener = vi.fn();
    store.subscribeGlobal(listener);
    listener.mockClear();

    store.rekey("_tmp_x", "u_real");
    expect(listener).toHaveBeenCalled();
  });

  it("rekey no-op для несуществующего id", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    // Should not throw
    expect(() => store.rekey("nonexistent", "new_id")).not.toThrow();
  });
});

// ─── 2C.3: List tracking для React ─────────────────────────────────────────────

describe("2C.3: List tracking — versions", () => {
  it("version списка инкрементируется при add", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });

    // Access list proxy to trigger proxy creation
    const listNode = (store.proxy as any).users[Symbol.for("CONFIG_NODE") as any];
    // Get the list config node via buildListProxy internal mechanism
    // We track via getNodeVersion on the list node
    const config = store.rootConfig as any;
    const listConfigNode = config.users; // the array

    const vBefore = store.getNodeVersion(listConfigNode);
    (store.proxy as any).users.add("u1");
    const vAfter = store.getNodeVersion(listConfigNode);

    expect(vAfter).toBeGreaterThan(vBefore);
  });

  it("root-list трекается по объекту LIST_STATE (версия растёт на нём при add/remove)", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });

    // Root-list proxy теперь экспонирует бренд LIST_STATE → объект ListState.
    const listProxy = (store.proxy as any).users;
    const listState = listProxy[LIST_STATE] as object;
    expect(listState).toBeDefined();
    expect((listState as any).ownerEntity).toBeNull();

    // Трекинг ведётся по этому объекту: его версия растёт при мутациях.
    const vBefore = store.getNodeVersion(listState);
    listProxy.add("u1");
    const vAfterAdd = store.getNodeVersion(listState);
    expect(vAfterAdd).toBeGreaterThan(vBefore);

    listProxy.remove("u1");
    const vAfterRemove = store.getNodeVersion(listState);
    expect(vAfterRemove).toBeGreaterThan(vAfterAdd);
  });

  it("version списка инкрементируется при remove", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");

    const config = store.rootConfig as any;
    const listConfigNode = config.users;

    const vBefore = store.getNodeVersion(listConfigNode);
    (store.proxy as any).users.remove("u1");
    const vAfter = store.getNodeVersion(listConfigNode);

    expect(vAfter).toBeGreaterThan(vBefore);
  });

  it("entity leaf версия инкрементируется при изменении через store.set()", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");

    // Get entity leaf node
    const entityNode = store.entityRegistry.get("u1")!;
    const nameLeaf = (entityNode as any).name as object;

    const leafBefore = store.getNodeVersion(nameLeaf);
    store.set({ id: "u1", name: "Alice Updated" });
    const leafAfter = store.getNodeVersion(nameLeaf);

    expect(leafAfter).toBeGreaterThan(leafBefore);
  });

  it("add не меняет версию entity leaf", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });

    const entityNode = store.entityRegistry.get("u1")!;
    const nameLeaf = (entityNode as any).name as object;

    // Ensure leaf is registered in nodeVersions
    void store.getNodeVersion(nameLeaf);
    const leafBefore = store.getNodeVersion(nameLeaf);

    (store.proxy as any).users.add("u1");
    const leafAfter = store.getNodeVersion(nameLeaf);

    // Leaf version should NOT change — only the list changed
    expect(leafAfter).toBe(leafBefore);
  });

  it("resolve бампает версию listNode", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    const config = store.rootConfig as any;
    const listNode = config.users;

    const vBefore = store.getNodeVersion(listNode);
    void (store.proxy as any).users.items;
    await flushPromises();
    const vAfter = store.getNodeVersion(listNode);

    expect(vAfter).toBeGreaterThan(vBefore);
  });
});

// ─── 2C.4: Dirty для списков ───────────────────────────────────────────────────

describe("2C.4: Dirty для списков", () => {
  it("dirty = false при инициализации", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("dirty = true после add", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");
    expect((store.proxy as any).users.dirty).toBe(true);
  });

  it("dirty = true после remove", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    store.set({ id: "u1", name: "Alice", role: "admin" });
    // Manually set initialItemIds to simulate a prior resolve
    const listNode = (store.rootConfig as any).users;
    const listState = store.nodes.listStates.get(listNode)!;
    listState.itemIds = ["u1"];
    listState.initialItemIds = ["u1"];

    (store.proxy as any).users.remove("u1");
    expect((store.proxy as any).users.dirty).toBe(true);
  });

  it("dirty вносит вклад в root form.dirty", () => {
    const store = new Palistor({
      config: {
        title: { value: "Users" },
        users: [userTemplate],
      } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });
    // Prime the initial state
    const listNode = (store.rootConfig as any).users;
    const listState = store.nodes.listStates.get(listNode)!;
    listState.itemIds = ["u1"];
    listState.initialItemIds = ["u1"];

    // Remove — makes list dirty
    (store.proxy as any).users.remove("u1");

    // Root form should now be dirty
    expect((store.proxy as any).dirty).toBe(true);
  });

  it("dirty = false после resolver загружает список (initialItemIds синхронизируется)", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // After resolve, initialItemIds = itemIds → not dirty
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("dirty = true после add на resolved список", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // Add new entity → dirty
    store.set({ id: "u2", name: "Bob", role: "user" });
    (store.proxy as any).users.add("u2");
    expect((store.proxy as any).users.dirty).toBe(true);
  });
});

// ─── 2C.5: Интеграционный сценарий ───────────────────────────────────────────

describe("2C.5: Интеграционный сценарий", () => {
  it("полный цикл: resolver → proxy → edit → notify", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    const listener = vi.fn();
    store.subscribeGlobal(listener);

    // Trigger lazy resolve
    void (store.proxy as any).users.items;
    await flushPromises();

    // Список загружен
    expect((store.proxy as any).users.length).toBe(2);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");

    // Редактируем имя через proxy
    listener.mockClear();
    (store.proxy as any).users.items[0].name.value = "Alice Cooper";
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice Cooper");
    expect(listener).toHaveBeenCalled();

    // Список по составу — clean (не добавляли/удаляли)
    expect((store.proxy as any).users.dirty).toBe(false);

    // Добавляем новую entity → dirty
    store.set({ id: "u3", name: "Carol", role: "user" });
    (store.proxy as any).users.add("u3");
    expect((store.proxy as any).users.length).toBe(3);
    expect((store.proxy as any).users.dirty).toBe(true);

    // Удаляем entity → всё ещё dirty
    (store.proxy as any).users.remove("u3");
    expect((store.proxy as any).users.length).toBe(2);
    // Still dirty (we removed u3 which wasn't in initialItemIds, but now itemIds=[u1,u2]
    // which equals initialItemIds=[u1,u2]) - actually at this point we're back to clean!
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("rekey workflow: tmp → real id", async () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    // Add entity with tmp id
    (store.proxy as any).users.add({ id: "_tmp_abc", name: "New User", role: "user" });
    expect((store.proxy as any).users.length).toBe(1);

    // Simulate server response: rekey to real id
    store.rekey("_tmp_abc", "server_id_123");

    expect((store.proxy as any).users.length).toBe(1);
    expect(store.entityRegistry.get("server_id_123")).toBeDefined();
    expect(store.entityRegistry.get("_tmp_abc")).toBeUndefined();
    expect((store.proxy as any).users.items[0].name.value).toBe("New User");
  });
});

// ─── Dep retrigger for list resolvers ────────────────────────────────────────

describe("list resolver dep retrigger", () => {
  it("reruns list resolver when explicit dep changes after resolution", async () => {
    const calls: string[] = [];
    const resolver = vi.fn(async (values: any) => {
      calls.push(values.filter);
      return [{ id: "u1", name: `User-for-${values.filter}`, role: "user" }];
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

    // Trigger lazy resolve
    void (store.proxy as any).users.items;
    await flushPromises();

    expect(calls).toEqual(["admin"]);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("User-for-admin");

    // Change the dep field — resolver should retrigger
    (store.proxy as any).filter.value = "moderator";
    await flushPromises();

    expect(calls).toEqual(["admin", "moderator"]);
    expect((store.proxy as any).users.items[0].name.value).toBe("User-for-moderator");
  });

  it("reruns list resolver after completion when dep changes while pending", async () => {
    const calls: string[] = [];
    let resolveSecond!: (v: any) => void;
    let callIndex = 0;

    const resolver = vi.fn(async (values: any) => {
      callIndex++;
      const thisCall = callIndex;
      if (thisCall === 2) {
        return new Promise<any>((r) => { resolveSecond = r; });
      }
      calls.push(values.filter);
      return [{ id: "u1", name: `User-for-${values.filter}`, role: "user" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn(), deps: ["filter"] } },
        ],
      } as any,
    });

    // Initial resolve
    void (store.proxy as any).users.items;
    await flushPromises();
    expect(calls).toEqual(["a"]);

    // Change dep → triggers call 2 (paused)
    (store.proxy as any).filter.value = "b";
    await Promise.resolve();

    // Change dep again while call 2 is still pending
    (store.proxy as any).filter.value = "c";
    await Promise.resolve();

    // Resolve call 2 with stale result
    resolveSecond([{ id: "u1", name: "User-for-b", role: "user" }]);
    await flushPromises();

    // System should detect dep changed during pending and rerun with "c"
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(calls).toEqual(["a", "c"]);
    expect((store.proxy as any).users.items[0].name.value).toBe("User-for-c");
  });
});
