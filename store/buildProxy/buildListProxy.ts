import { CONFIG_NODE, LIST_STATE, LIST_SPREAD_KEYS } from "../constants";
import type { AnyConfigNode, ListState } from "../store/types";
import type { EntityData, EntityLeafNode } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import { generateTmpId } from "../entityRegistry";
import {
  buildEntityProjectionProxy,
  buildEntityValuesWithLists,
} from "./buildEntityProjectionProxy";

// ─── arraysEqual helper ──────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Ключи per-entity list proxy (вариант C). Тот же набор членов, что
 * {@link LIST_SPREAD_KEYS}, но в историческом порядке per-entity-листа —
 * сохраняем его, пока root и entity не выровнены по ключам.
 */
const ENTITY_LIST_SPREAD_KEYS: string[] = [
  "items",
  "length",
  "loading",
  "dirty",
  "map",
  "getById",
  "add",
  "remove",
  "setItems",
  "getValues",
];

// ─── buildListProxy ──────────────────────────────────────────────────────────

/**
 * Build a ListProxyNode for a list — ЕДИНЫЙ builder (root + per-entity).
 *
 * Список идентифицируется объектом {@link ListState}. `listState.ownerEntity`
 * различает два случая:
 *   - `null`  → root-list (состояние в `kernel.nodes.listStates`);
 *   - entity  → per-entity nested list (вариант C; состояние в `owner.lists`).
 *
 * Скелет, мутации, proxy и кэш — общие. Точки, где root и entity ещё расходятся
 * (sync valuesCache, resolve/loading, семантика add/setItems), временно
 * диспетчеризуются по `owner`; их слияние — фазы U3 (sync) и U5 (resolve).
 *
 * The proxy exposes:
 *   items       — ReadonlyArray<EntityProjectionProxy>, one per itemId
 *   length      — number of items
 *   loading     — async resolver in progress
 *   dirty       — itemIds differ from the initial snapshot
 *   add(id)     — add existing entity by ID
 *   add(values) — upsert entity + add to list
 *   remove(id)  — remove entity from list (entity stays in registry)
 *   getById(id) — find proxy by ID
 *   setItems(ids) — bulk-replace itemIds
 *   map(fn)     — map for React rendering
 *   getValues() — plain values snapshot of all items
 *   [Symbol.iterator] — iteration
 *
 * Entity proxies are cached per list instance (stable references for React);
 * the list proxy itself is cached per `ListState` in `kernel.nodes.listProxyCache`.
 */
export function buildListProxy(listState: ListState, kernel: Palistor<any>): object {
  // Стабильный кэш proxy на каждый ListState (root и per-entity — единый кэш).
  const cached = kernel.nodes.listProxyCache.get(listState as object);
  if (cached) return cached;

  const listConfigNode = listState.listConfigNode as AnyConfigNode;
  const template = listState.template as AnyConfigNode;
  const listConfig = listState.listConfig;
  /** Владелец списка: `null` = root, EntityNode = per-entity. */
  const owner = listState.ownerEntity;

  // Per-list стабильный кэш entity-проекций (стабильные ссылки для React).
  const entityProxyCache = new WeakMap<object, object>();

  /** Build EntityProjectionProxy for a given entityId. */
  function buildItemProxy(id: string): object | undefined {
    const entityNode = kernel.entityRegistry.get(id);
    if (!entityNode) return undefined;
    return buildEntityProjectionProxy(entityNode, template, kernel, entityProxyCache);
  }

  /** Текущий id владельца (учитывает rekey через nodeState). Только для per-entity. */
  const getOwnerId = (): string => {
    const idLeaf = owner!.id as object;
    return (
      (kernel.nodes.nodeState.get(idLeaf) as { value: unknown } | undefined)?.value ??
      (owner!.id as EntityLeafNode).value
    ) as string;
  };

  /** Обновить valuesCache для этого списка (диспетчер до U3). */
  const syncValuesCache = (): void => {
    if (owner) kernel._syncEntityListValuesCache(owner, listConfigNode as object);
    else kernel._syncListValuesCache(listConfigNode as object);
  };

  /** Notify observers that the list itself changed + recompute dependents. */
  const notifyListChanged = (): void => {
    syncValuesCache();
    if (owner) {
      // Per-entity: изолированная идентичность — сам объект listState; владельца
      // тоже в changed, чтобы `entity.values`/`entity.dirty`-наблюдатели обновились.
      const changed = new Set<object>();
      changed.add(listState as unknown as object);
      changed.add(owner as unknown as object);
      const recomputed = kernel.recompute(changed);
      for (const n of changed) recomputed.add(n);
      kernel.notifyChanged(recomputed);
    } else {
      // Root: полный recompute (valuesCache.users → все computed).
      const recomputed = kernel.recompute();
      // U2: трекинг root-листа теперь по объекту ListState.
      recomputed.add(listState as unknown as object);
      // Мост обратной совместимости: старые тесты читают getNodeVersion(listNode).
      recomputed.add(listConfigNode as object);
      kernel.notifyChanged(recomputed);
    }
  };

  /** Trigger lazy list resolve on first access (диспетчер до U5). */
  const triggerLazyResolveIfNeeded = (): void => {
    if (!listConfig?.resolve) return;
    if (owner) {
      const ownerId = getOwnerId();
      const st = kernel.resolveManager.entityStates.get(ownerId, listConfigNode as object);
      if (!st || st.status === "idle") {
        // Defer: GET-трап во время React-рендера; синхронный resolve→notify
        // дал бы "Cannot update a component while rendering another".
        queueMicrotask(() =>
          kernel.resolveManager.triggerEntityListResolve(ownerId, listConfigNode, owner),
        );
      }
    } else {
      const resolveState = kernel.resolveManager.states.get(listConfigNode as object);
      if (resolveState?.status === "idle") {
        queueMicrotask(() =>
          kernel.resolveManager.triggerResolve(listConfigNode as AnyConfigNode),
        );
      }
    }
  };

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const addFn = (idOrValues: string | Record<string, unknown>): void => {
    if (owner) {
      const ownerId = getOwnerId();
      let entityId: string;
      if (typeof idOrValues === "string") {
        entityId = idOrValues;
        if (!kernel.entityRegistry.has(entityId)) {
          throw new Error(
            `[palistor] per-entity list add("${entityId}"): entity not found in registry.`,
          );
        }
      } else {
        const rawId = (idOrValues as { id?: unknown }).id;
        entityId =
          typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
        // set() регистрирует leaf-ноды + projectionObj (с собственным recompute/notify).
        kernel.set({ ...(idOrValues as Record<string, unknown>), id: entityId });
      }
      const childNode = kernel.entityRegistry.get(entityId);
      if (childNode) {
        kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
      }
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
      }
      notifyListChanged();
    } else {
      let entityId: string;
      if (typeof idOrValues === "string") {
        entityId = idOrValues;
        if (!kernel.entityRegistry.has(entityId)) return;
      } else {
        // upsert entity into store (creates entityProjectionObj + registers leaves)
        kernel.set(idOrValues as EntityData);
        const entityNode = kernel.entityRegistry.upsert(idOrValues as EntityData);
        entityId = entityNode.id.value as string;
      }
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
        notifyListChanged();
      }
    }
  };

  const removeFn = (id: string): void => {
    const idx = listState.itemIds.indexOf(id);
    if (idx === -1) return;
    listState.itemIds.splice(idx, 1);
    notifyListChanged();
  };

  const getByIdFn = (id: string): object | undefined => {
    if (!listState.itemIds.includes(id)) return undefined;
    return buildItemProxy(id);
  };

  const setItemsFn = (ids: string[]): void => {
    if (owner) {
      const ownerId = getOwnerId();
      for (const id of ids) {
        if (!kernel.entityRegistry.has(id)) {
          throw new Error(
            `[palistor] per-entity list setItems: entity "${id}" not found in registry.`,
          );
        }
      }
      listState.itemIds = [...ids];
      for (const id of ids) {
        const childNode = kernel.entityRegistry.get(id);
        if (childNode) {
          kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
        }
      }
      notifyListChanged();
    } else {
      listState.itemIds.length = 0;
      for (const id of ids) listState.itemIds.push(id);
      notifyListChanged();
    }
  };

  const mapFn = <R>(
    fn: (item: object, index: number, id: string) => R,
  ): R[] => {
    return listState.itemIds
      .map((id, index) => {
        const proxy = buildItemProxy(id);
        if (!proxy) return undefined;
        return fn(proxy, index, id);
      })
      .filter((item): item is R => item !== undefined);
  };

  const getValuesFn = (): Array<Record<string, unknown>> =>
    listState.itemIds
      .map((id) => {
        const child = kernel.entityRegistry.get(id);
        return child ? buildEntityValuesWithLists(child, template, kernel) : undefined;
      })
      .filter((v): v is Record<string, unknown> => v !== undefined);

  // ─── Proxy object ──────────────────────────────────────────────────────────

  const spreadKeys = owner ? ENTITY_LIST_SPREAD_KEYS : LIST_SPREAD_KEYS;

  const proxy = new Proxy(listConfigNode as unknown as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Прозрачный config-узел (для отладки/useForm). НЕ ключ трекинга.
      if (key === CONFIG_NODE) return listConfigNode;
      // Бренд идентичности списка — ключ трекинга (root и per-entity единообразно).
      if (key === LIST_STATE) return listState;

      if (typeof key === "symbol") {
        if (key === Symbol.iterator) {
          return function* () {
            for (const id of listState.itemIds) {
              const itemProxy = buildItemProxy(id);
              if (itemProxy) yield itemProxy;
            }
          };
        }
        return undefined;
      }

      switch (key) {
        case "items":
          triggerLazyResolveIfNeeded();
          return listState.itemIds
            .map(buildItemProxy)
            .filter((item): item is object => item !== undefined);

        case "length":
          triggerLazyResolveIfNeeded();
          return listState.itemIds.length;

        case "loading":
          if (owner) {
            return (
              kernel.resolveManager.entityStates.get(getOwnerId(), listConfigNode as object)
                ?.status === "pending"
            );
          }
          // Root: loading из nodeState (выставляется resolver-ом).
          return (
            (kernel.nodes.nodeState.get(listConfigNode as object) as
              | { loading?: boolean }
              | undefined)?.loading ?? false
          );

        case "dirty":
          // dirty by composition: current itemIds differ from initial snapshot
          return !arraysEqual(listState.itemIds, listState.initialItemIds);

        case "add":
          return addFn;

        case "remove":
          return removeFn;

        case "getById":
          return getByIdFn;

        case "setItems":
          return setItemsFn;

        case "map":
          triggerLazyResolveIfNeeded();
          return mapFn;

        case "getValues":
          return getValuesFn;

        default:
          return undefined;
      }
    },

    set(_target, _key, _value) {
      // Lists are not directly writable via proxy
      return false;
    },

    ownKeys() {
      return spreadKeys;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!spreadKeys.includes(key as string)) return undefined;
      // Array targets have a non-configurable `length` property.
      // The proxy invariant requires that we mirror this exactly.
      if (key === "length") {
        return { configurable: false, enumerable: false, writable: true, value: listState.itemIds.length };
      }
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  kernel.nodes.listProxyCache.set(listState as object, proxy);
  return proxy;
}
