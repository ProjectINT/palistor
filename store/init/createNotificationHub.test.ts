import { describe, it, expect, vi } from "vitest";
import { NotificationHub } from "./createNotificationHub";
import type { AnyConfigNode } from "../store/types";

// ─── Minimal dirty deps ───────────────────────────────────────────────────────

function makeDirtyDeps(rootConfig: AnyConfigNode = {} as AnyConfigNode) {
  return {
    rootConfig,
    nodeState: new WeakMap<AnyConfigNode, any>(),
    initialValueMap: new WeakMap<AnyConfigNode, unknown>(),
    nodeParents: new WeakMap<AnyConfigNode, AnyConfigNode>(),
    nodePaths: new WeakMap<AnyConfigNode, string>(),
  };
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("NotificationHub", () => {
  describe("конструктор", () => {
    it("создаётся без ошибок", () => {
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      expect(hub).toBeTruthy();
    });

    it("начальная версия равна 0", () => {
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      expect(hub.getVersion()).toBe(0);
    });

    it("начальная версия узла равна 0", () => {
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      expect(hub.getNodeVersion({})).toBe(0);
    });
  });

  describe("subscribe / notifyChanged", () => {
    it("вызывает per-node подписчика при notifyChanged", () => {
      const node = {};
      const nodePaths = new WeakMap<object, string>();
      const hub = new NotificationHub({ leafNodes: [], nodePaths });
      const listener = vi.fn();
      hub.subscribe(node, listener);

      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(listener).toHaveBeenCalledOnce();
    });

    it("отписка через returned unsubscribe", () => {
      const node = {};
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      const listener = vi.fn();
      const unsub = hub.subscribe(node, listener);
      unsub();

      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(listener).not.toHaveBeenCalled();
    });

    it("инкрементирует глобальную версию при notifyChanged", () => {
      const node = {};
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(hub.getVersion()).toBe(1);
    });

    it("обновляет версию конкретного узла", () => {
      const node = {};
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(hub.getNodeVersion(node)).toBe(1);
    });

    it("не уведомляет, если changed пустой", () => {
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      const global = vi.fn();
      hub.subscribeGlobal(global);

      hub.notifyChanged(new Set(), makeDirtyDeps());

      expect(global).not.toHaveBeenCalled();
      expect(hub.getVersion()).toBe(0);
    });
  });

  describe("subscribeGlobal", () => {
    it("вызывает глобального подписчика при notifyChanged", () => {
      const node = {};
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      const global = vi.fn();
      hub.subscribeGlobal(global);

      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(global).toHaveBeenCalledOnce();
    });

    it("глобальная отписка работает", () => {
      const node = {};
      const hub = new NotificationHub({ leafNodes: [], nodePaths: new WeakMap() });
      const global = vi.fn();
      const unsub = hub.subscribeGlobal(global);
      unsub();

      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(global).not.toHaveBeenCalled();
    });
  });

  describe("bumpLeafVersions", () => {
    it("инкрементирует глобальную версию и версии leaf-узлов", () => {
      const leaf = {};
      const hub = new NotificationHub({
        leafNodes: [{ node: leaf, path: "email" }],
        nodePaths: new WeakMap(),
      });
      const global = vi.fn();
      hub.subscribeGlobal(global);

      hub.bumpLeafVersions();

      expect(hub.getVersion()).toBe(1);
      expect(hub.getNodeVersion(leaf)).toBe(1);
      expect(global).toHaveBeenCalledOnce();
    });
  });

  describe("setPostNotifyHook", () => {
    it("вызывает хук с dot-путями изменённых узлов", () => {
      const node = {};
      const nodePaths = new WeakMap<object, string>();
      nodePaths.set(node, "email");
      const hub = new NotificationHub({ leafNodes: [], nodePaths });
      const hook = vi.fn();
      hub.setPostNotifyHook(hook);

      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(hook).toHaveBeenCalledWith(new Set(["email"]));
    });

    it("снимает хук при setPostNotifyHook(null)", () => {
      const node = {};
      const nodePaths = new WeakMap<object, string>();
      nodePaths.set(node, "email");
      const hub = new NotificationHub({ leafNodes: [], nodePaths });
      const hook = vi.fn();
      hub.setPostNotifyHook(hook);
      hub.setPostNotifyHook(null);

      hub.notifyChanged(new Set([node]), makeDirtyDeps());

      expect(hook).not.toHaveBeenCalled();
    });
  });
});
