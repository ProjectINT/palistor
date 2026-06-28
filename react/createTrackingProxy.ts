/**
 * createTrackingProxy — оборачивает store.proxy во второй слой Proxy,
 * который записывает, какие config-ноды были прочитаны компонентом.
 *
 * Каждый `useForm` вызов создаёт свой tracking proxy → свой tracked set.
 * Это позволяет `getSnapshot` проверять версии только прочитанных нод
 * и не вызывать re-render, если изменились поля, которые компонент не читает.
 *
 * Tracking работает на уровне ноды: чтение ЛЮБОГО свойства
 * (value, label, isVisible…) добавляет всю ноду в tracked set.
 *
 * Phase 2C: список прокси — `items`, `map`, `length`, `loading`, `dirty`
 * на ListProxy добавляют ListNode в tracked set. `version++` при add/remove
 * бампает версию ListNode → getSnapshot детектирует изменение → re-render
 * только списка. `map` → entity прокси оборачиваются в tracking proxy для
 * per-leaf отслеживания строк.
 */

import { FIELD_STATE_PROPS, CONFIG_NODE, SOURCE_PROXY, STORE_REF, ENTITY_ID_LEAF, ENTITY_LIST_STATE } from "../store/constants";
import type { ProxyStore } from "../store/store";

export interface TrackingRefs {
  /** Набор config-нод, прочитанных компонентом. Только растёт (accumulate). */
  accessed: Set<object>;
  /** Версия каждой ноды на момент первого трекинга — для предотвращения
   *  ложных re-render сразу после добавления ноды в tracked set. */
  lastVersions: Map<object, number>;
  /**
   * Компонент обращался к дочерним ключам (form.email, form.passport),
   * но не читал FIELD_STATE_PROPS. Позволяет различить:
   * - «навигация без чтения» (Parent передаёт поддерево пропсом) → стабильный snapshot
   * - «ничего не трогал» (renderHook без JSX) → fallback на глобальную версию
   */
  hasNavigated: boolean;
}

/**
 * Проверить, является ли объект tracking proxy (имеет SOURCE_PROXY символ).
 */
export function isTrackingProxy(obj: unknown): boolean {
  return !!obj && typeof obj === "object" && !!(obj as any)[SOURCE_PROXY];
}

/**
 * Извлечь source proxy и store из tracking proxy.
 * Возвращает null если объект не является tracking proxy.
 */
export function unwrapTrackingProxy<TConfig extends Record<string, any>>(
  obj: unknown,
): { sourceProxy: any; store: ProxyStore<TConfig> } | null {
  if (!isTrackingProxy(obj)) return null;
  return {
    sourceProxy: (obj as any)[SOURCE_PROXY],
    store: (obj as any)[STORE_REF],
  };
}

/**
 * Создать tracking proxy поверх source proxy.
 * Кэшируется по source proxy объектам (один tracking proxy на вложенный узел).
 *
 * @param sourceProxy — базовый Proxy из store.proxy (или его дочерний узел)
 * @param refs        — per-component tracking state (accessed, lastVersions)
 * @param store       — ProxyStore, для чтения текущих версий нод
 * @param cache       — WeakMap для кэширования tracking прокси объектов
 */
export function createTrackingProxy<TConfig extends Record<string, any>>(
  sourceProxy: any,
  refs: TrackingRefs,
  store: ProxyStore<TConfig>,
  cache: WeakMap<object, object>,
): any {
  if (cache.has(sourceProxy)) return cache.get(sourceProxy);

  const tracked = new Proxy(sourceProxy as Record<string | symbol, unknown>, {
    get(target, key: string | symbol) {
      // CONFIG_NODE — пробрасываем, tracking proxy прозрачен для этого символа
      if (key === CONFIG_NODE) return (target as any)[CONFIG_NODE];

      // SOURCE_PROXY — возвращаем исходный store proxy (target tracking proxy)
      if (key === SOURCE_PROXY) return target;

      // STORE_REF — возвращаем ссылку на ProxyStore
      if (key === STORE_REF) return store;

      // Прочие символы — пробрасываем как есть
      if (typeof key === "symbol") return (target as any)[key];

      // ── Per-entity list proxy (вариант C) ──────────────────────────────────
      // Ключ трекинга = объект EntityListState (per-owner), а НЕ общий listConfigNode,
      // иначе версии разных владельцев одного списка схлопнутся (RFC §2.6).
      // Должно идти ДО FIELD_STATE_PROPS: `loading` входит в FIELD_STATE_PROPS,
      // но на entity-list его надо трекать по EntityListState, а не по CONFIG_NODE.
      const entityListState = (target as any)[ENTITY_LIST_STATE] as object | undefined;
      if (entityListState) {
        if (key === "length" || key === "loading" || key === "dirty") {
          if (!refs.accessed.has(entityListState)) {
            refs.accessed.add(entityListState);
            refs.lastVersions.set(entityListState, store.getNodeVersion(entityListState));
          }
          return (target as any)[key];
        }
        if (key === "items") {
          if (!refs.accessed.has(entityListState)) {
            refs.accessed.add(entityListState);
            refs.lastVersions.set(entityListState, store.getNodeVersion(entityListState));
          }
          const rawItems = (target as any)["items"] as object[];
          return rawItems.map((item: object) =>
            createTrackingProxy(item, refs, store, cache),
          );
        }
        if (key === "map") {
          if (!refs.accessed.has(entityListState)) {
            refs.accessed.add(entityListState);
            refs.lastVersions.set(entityListState, store.getNodeVersion(entityListState));
          }
          const origMap = (target as any)["map"] as (
            fn: (item: object, index: number, id: string) => unknown,
          ) => unknown[];
          return (fn: (item: any, index: number, id: string) => unknown) =>
            origMap((item: object, index: number, id: string) =>
              fn(createTrackingProxy(item, refs, store, cache), index, id),
            );
        }
        // add/remove/setItems/getById — пробрасываем без трекинга.
        return (target as any)[key];
      }

      // Чтение состояния поля → трекинг ноды
      // submitting — реактивный флаг группы, тоже требует трекинга
      if (FIELD_STATE_PROPS.has(key) || key === "submitting") {
        const configNode = (target as any)[CONFIG_NODE] as object | undefined;
        if (configNode && !refs.accessed.has(configNode)) {
          refs.accessed.add(configNode);
          // Сохраняем текущую версию, чтобы getSnapshot не считал это изменением
          refs.lastVersions.set(configNode, store.getNodeVersion(configNode));
        }
        return (target as any)[key];
      }

      // List node tracking: reading items/map/length/dirty on a list proxy
      // tracks the ListNode so version++ on add/remove/resolve triggers re-render.
      const configNodeForList = (target as any)[CONFIG_NODE];
      if (configNodeForList && Array.isArray(configNodeForList)) {
        if (key === "length" || key === "loading" || key === "dirty") {
          if (!refs.accessed.has(configNodeForList)) {
            refs.accessed.add(configNodeForList);
            refs.lastVersions.set(configNodeForList, store.getNodeVersion(configNodeForList));
          }
          return (target as any)[key];
        }

        if (key === "items") {
          if (!refs.accessed.has(configNodeForList)) {
            refs.accessed.add(configNodeForList);
            refs.lastVersions.set(configNodeForList, store.getNodeVersion(configNodeForList));
          }
          // Wrap each entity proxy in a tracking proxy for per-leaf tracking
          const rawItems = (target as any)["items"] as object[];
          return rawItems.map((item: object) =>
            createTrackingProxy(item, refs, store, cache),
          );
        }

        if (key === "map") {
          if (!refs.accessed.has(configNodeForList)) {
            refs.accessed.add(configNodeForList);
            refs.lastVersions.set(configNodeForList, store.getNodeVersion(configNodeForList));
          }
          const origMap = (target as any)["map"] as (
            fn: (item: object, index: number, id: string) => unknown,
          ) => unknown[];
          // Return a wrapper that wraps each entity proxy argument in createTrackingProxy
          return (fn: (item: any, index: number, id: string) => unknown) =>
            origMap((item: object, index: number, id: string) =>
              fn(createTrackingProxy(item, refs, store, cache), index, id),
            );
        }
      }

      // Дочерний объект → рекурсивный tracking proxy
      const result = (target as any)[key];

      // Entity id access: the entity proxy returns the id string directly (not via a
      // leaf proxy), so we would normally miss tracking it. Detect by checking if the
      // entity proxy exposes ENTITY_ID_LEAF and register that leaf for subscriptions.
      // This ensures rekey() → idLeaf version bump → getSnapshot detects change → re-render.
      if (key === "id") {
        const idLeaf = (target as any)[ENTITY_ID_LEAF] as object | undefined;
        if (idLeaf && !refs.accessed.has(idLeaf)) {
          refs.accessed.add(idLeaf);
          refs.lastVersions.set(idLeaf, store.getNodeVersion(idLeaf));
        }
      }

      if (result && typeof result === "object") {
        refs.hasNavigated = true;
        return createTrackingProxy(result, refs, store, cache);
      }

      return result;
    },

    set(target, key: string | symbol, value: unknown) {
      // Запись пробрасывается в исходный proxy (SET trap в buildProxy)
      return Reflect.set(target, key, value);
    },

    /**
     * Пробрасываем ownKeys из source proxy, чтобы spread ({...trackingProxy})
     * возвращал те же ключи, что и store proxy (без validate, formatter, …).
     */
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },

    getOwnPropertyDescriptor(target, key: string | symbol) {
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  cache.set(sourceProxy, tracked);
  return tracked;
}
