import { CONFIG_NODE, ENTITY_LIST_STATE } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { EntityNode, EntityLeafNode, EntityListState } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import { generateTmpId } from "../entityRegistry";
import { buildEntityProjectionProxy, buildEntityValuesWithLists } from "./buildEntityProjectionProxy";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Ключи, публикуемые per-entity list proxy (C2: +mutations, C3: +dirty/getValues). */
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

/** Поэлементное сравнение двух массивов строк (для dirty по составу списка). */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── buildEntityListProxy ──────────────────────────────────────────────────────

/**
 * Построить per-entity list proxy для вложенного списка (вариант C, фаза C1).
 *
 * Структурно повторяет {@link buildListProxy}, но всё состояние списка —
 * per-(owner, listConfigNode), а не общий `ListState` из `kernel.nodes.listStates`.
 * Источник правды:
 *   - состав/итоговые id  — `EntityListState` (на `ownerEntity.lists`);
 *   - loading/resolve     — `resolveManager.entityStates.get(ownerId, listConfigNode)`.
 *
 * Read-only: `add`/`remove`/`setItems` бросают ошибку до фазы C2.
 *
 * @param ownerEntity    EntityNode-владелец (тот, в чьём template объявлен список)
 * @param listConfigNode ListNode из template (массив `[template, listConfig?]`)
 * @param kernel         Palistor instance
 */
export function buildEntityListProxy(
  ownerEntity: EntityNode,
  listConfigNode: AnyConfigNode,
  kernel: Palistor<any>,
): object {
  // ── Стабильный кэш proxy per (ownerEntity, listConfigNode) ──────────────────
  let byList = kernel.nodes.entityListProxyCache.get(ownerEntity);
  if (!byList) {
    byList = new Map<object, object>();
    kernel.nodes.entityListProxyCache.set(ownerEntity, byList);
  }
  const cached = byList.get(listConfigNode as object);
  if (cached) return cached;

  const listArr = listConfigNode as unknown as unknown[];
  const template = listArr[0] as AnyConfigNode;
  const listConfig = listArr.length > 1
    ? (listArr[1] as { resolve?: unknown } | undefined)
    : undefined;

  // Per-list стабильный кэш entity-проекций (стабильные ссылки для React).
  const entityProxyCache = new WeakMap<object, object>();

  /** Текущий id владельца (учитывает rekey через nodeState). */
  const getOwnerId = (): string => {
    const idLeaf = ownerEntity.id as object;
    return (
      (kernel.nodes.nodeState.get(idLeaf) as { value: unknown } | undefined)?.value ??
      (ownerEntity.id as EntityLeafNode).value
    ) as string;
  };

  const getState = (): EntityListState =>
    kernel.entityRegistry.getOrCreateEntityListState(ownerEntity, listConfigNode as object);

  /** Построить EntityProjectionProxy для child-entity по id. */
  function buildItemProxy(id: string): object | undefined {
    const childNode = kernel.entityRegistry.get(id);
    if (!childNode) return undefined;
    return buildEntityProjectionProxy(childNode, template, kernel, entityProxyCache);
  }

  /**
   * Лениво триггерит resolve при первом доступе (если есть resolver и статус idle).
   * Через queueMicrotask — синхронный resolve→notify внутри GET-трапа во время
   * React-рендера дал бы «Cannot update a component while rendering another».
   */
  function triggerLazyResolveIfNeeded(): void {
    if (!listConfig?.resolve) return;
    const ownerId = getOwnerId();
    const st = kernel.resolveManager.entityStates.get(ownerId, listConfigNode as object);
    if (!st || st.status === "idle") {
      queueMicrotask(() =>
        kernel.resolveManager.triggerEntityListResolve(ownerId, listConfigNode, ownerEntity),
      );
    }
  }

  const getByIdFn = (id: string): object | undefined => {
    if (!getState().itemIds.includes(id)) return undefined;
    return buildItemProxy(id);
  };

  /**
   * Бампнуть версию ИМЕННО этого `EntityListState` (изоляция per-owner) +
   * полный recompute, чтобы computed-выражения, читающие список, обновились.
   *
   * C3: материализуем новый состав в projectionObj владельца (для getValues)
   * и добавляем сам EntityNode владельца в changed — чтобы компоненты,
   * читающие `entity.values`/`entity.dirty`, перерисовались.
   */
  const notifyListChanged = (extra?: Set<object>): void => {
    const changed = extra ?? new Set<object>();
    changed.add(getState() as unknown as object);
    changed.add(ownerEntity as unknown as object);
    kernel._syncEntityListValuesCache(ownerEntity, listConfigNode as object);
    const recomputed = kernel.recompute(changed);
    for (const n of changed) recomputed.add(n);
    kernel.notifyChanged(recomputed);
  };

  // ─── Mutations (C2) ──────────────────────────────────────────────────────────

  /**
   * Добавить элемент в список.
   * - `add(id)` — добавить существующую entity по id (ошибка, если не найдена).
   * - `add(values)` — upsert entity (генерация id, если отсутствует) + добавить.
   * В обоих случаях child получает `owner = { ownerId, ownerListNode }`.
   */
  const addFn = (idOrValues: string | Record<string, unknown>): void => {
    const state = getState();
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
    if (!state.itemIds.includes(entityId)) {
      state.itemIds.push(entityId);
    }
    notifyListChanged();
  };

  /**
   * Убрать элемент из списка по id.
   * Entity НЕ удаляется из registry — может переиспользоваться в другом списке.
   * Каскадное удаление происходит ТОЛЬКО на `store.delete(ownerId)`.
   */
  const removeFn = (id: string): void => {
    const state = getState();
    const idx = state.itemIds.indexOf(id);
    if (idx === -1) return;
    state.itemIds.splice(idx, 1);
    notifyListChanged();
  };

  /**
   * Заменить весь состав списка набором id (все entity обязаны существовать).
   * Каждой entity проставляется owner-ссылка на этого владельца.
   */
  const setItemsFn = (ids: string[]): void => {
    const state = getState();
    const ownerId = getOwnerId();
    for (const id of ids) {
      if (!kernel.entityRegistry.has(id)) {
        throw new Error(
          `[palistor] per-entity list setItems: entity "${id}" not found in registry.`,
        );
      }
    }
    state.itemIds = [...ids];
    for (const id of ids) {
      const childNode = kernel.entityRegistry.get(id);
      if (childNode) {
        kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
      }
    }
    notifyListChanged();
  };

  const mapFn = <R>(fn: (item: object, index: number, id: string) => R): R[] => {
    return getState()
      .itemIds.map((id, index) => {
        const proxy = buildItemProxy(id);
        if (!proxy) return undefined;
        return fn(proxy, index, id);
      })
      .filter((item): item is R => item !== undefined);
  };

  // ─── Proxy object ──────────────────────────────────────────────────────────

  const proxy = new Proxy(listConfigNode as unknown as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Прозрачный config-узел (для отладки/useForm). НЕ ключ трекинга.
      if (key === CONFIG_NODE) return listConfigNode;
      // Бренд per-(owner,list) идентичности — ключ изолированного трекинга.
      if (key === ENTITY_LIST_STATE) return getState();

      if (typeof key === "symbol") {
        if (key === Symbol.iterator) {
          return function* () {
            for (const id of getState().itemIds) {
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
          return getState()
            .itemIds.map(buildItemProxy)
            .filter((item): item is object => item !== undefined);

        case "length":
          triggerLazyResolveIfNeeded();
          return getState().itemIds.length;

        case "loading":
          return (
            kernel.resolveManager.entityStates.get(getOwnerId(), listConfigNode as object)
              ?.status === "pending"
          );

        case "dirty": {
          // dirty по составу: текущие itemIds отличаются от initial-снимка.
          const st = getState();
          return !arraysEqual(st.itemIds, st.initialItemIds);
        }

        case "map":
          triggerLazyResolveIfNeeded();
          return mapFn;

        case "getById":
          return getByIdFn;

        case "getValues":
          return () =>
            getState()
              .itemIds.map((id) => {
                const child = kernel.entityRegistry.get(id);
                return child
                  ? buildEntityValuesWithLists(child, template, kernel)
                  : undefined;
              })
              .filter((v): v is Record<string, unknown> => v !== undefined);

        case "add":
          return addFn;
        case "remove":
          return removeFn;
        case "setItems":
          return setItemsFn;

        default:
          return undefined;
      }
    },

    set() {
      return false;
    },

    ownKeys() {
      return ENTITY_LIST_SPREAD_KEYS;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!ENTITY_LIST_SPREAD_KEYS.includes(key as string)) return undefined;
      if (key === "length") {
        // Array-target has a non-configurable `length`; mirror writable:true.
        return {
          configurable: false,
          enumerable: false,
          writable: true,
          value: getState().itemIds.length,
        };
      }
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  byList.set(listConfigNode as object, proxy);
  return proxy;
}
