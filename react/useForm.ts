/**
 * useForm — React хук для подключения к ProxyStore
 *
 * Возвращает реактивный прокси. Доступ к полям через точку — это и есть
 * подписка: компонент перерендерится только при изменении прочитанных полей.
 *
 * @example
 * ```tsx
 * const store = new Palistor({ config });
 *
 * function App() {
 *   const form = useForm(store);
 *
 *   return (
 *     <div>
 *       <PassportSection passport={form.passport} />
 *       <input
 *         value={form.email.value}
 *         onChange={(e) => { form.email.value = e.target.value }}
 *       />
 *     </div>
 *   );
 * }
 *
 * // Дочерний компонент с useForm для независимой подписки:
 * function PassportSection({ passport }) {
 *   const p = useForm(passport); // ← принимает поддерево!
 *   if (!p.isVisible) return null;
 *   return <NumberField field={p.number} />;
 * }
 * ```
 *
 * Как работает:
 *   1. useSyncExternalStore подписывается на глобальные изменения store.
 *   2. getSnapshot сравнивает версии только прочитанных узлов →
 *      re-render происходит только если изменилось то, что читалось.
 *   3. store.proxy оборачивается в tracking proxy. Каждый GET записывает
 *      config-ноду в tracked set. getSnapshot проверяет только эти ноды.
 *   4. Запись `form.email.value = "X"` → store.proxy.email.value = "X" →
 *      SET trap → formatter → validate → recompute → notify → re-render
 *      (только компонентов, которые читали изменившиеся ноды).
 *
 * Перегрузки:
 *   - useForm(store)        — основной вариант, передаём ProxyStore
 *   - useForm(proxySubtree) — принимает tracking proxy поддерево (из пропса),
 *     создаёт **независимый** tracking для этого компонента
 */

import { useSyncExternalStore, useCallback, useRef, useMemo } from "react";
import type { ProxyStore, ConfigProxy } from "../store/store";
import {
  createTrackingProxy,
  unwrapTrackingProxy,
  type TrackingRefs,
} from "./createTrackingProxy";

/**
 * Извлечь store и sourceProxy из аргумента useForm.
 * Поддерживает ProxyStore напрямую и tracking proxy поддеревья.
 */
function resolveInput<TConfig extends Record<string, any>>(
  input: ProxyStore<TConfig> | any,
): { store: ProxyStore<TConfig>; sourceProxy: any } {
  // Если это tracking proxy (поддерево переданное пропсом)
  const unwrapped = unwrapTrackingProxy<TConfig>(input);
  if (unwrapped) return unwrapped;

  // Иначе это ProxyStore — берём store.proxy как sourceProxy
  return { store: input, sourceProxy: input.proxy };
}

/**
 * Подключает React-компонент к ProxyStore.
 *
 * Компонент перерендерится только при изменении полей, которые он читал
 * во время предыдущего рендера. Tracking proxy автоматически записывает
 * обращения к FIELD_STATE_PROPS (value, label, isVisible, error…) и
 * getSnapshot проверяет версии только этих нод.
 *
 * На первом рендере tracked set пуст → используется глобальная версия
 * (fallback). После первого рендера tracking работает точечно.
 *
 * @param input — ProxyStore, созданный через new Palistor(), ИЛИ
 *                tracking proxy поддерево (из пропса другого useForm)
 * @returns tracking proxy — типизированный по конфигу (или поддереву)
 */
export function useForm<TConfig extends Record<string, any>>(
  input: ProxyStore<TConfig> | ConfigProxy<TConfig>,
): ConfigProxy<TConfig> {
  // ─── Resolve input (store vs tracking proxy subtree) ─────────────────────

  const { store, sourceProxy } = useMemo(
    () => resolveInput<TConfig>(input),
    [input],
  );

  // ─── Tracking state (per-component, стабильные ref-ы) ────────────────────

  /** Tracked nodes + их версии на момент первого чтения */
  const refsRef = useRef<TrackingRefs | null>(null);
  if (!refsRef.current) {
    refsRef.current = {
      accessed: new Set<object>(),
      lastVersions: new Map<object, number>(),
      hasNavigated: false,
    };
  }
  const refs = refsRef.current;

  /** Кэш tracking proxy объектов (по source proxy → tracking proxy) */
  const cacheRef = useRef<WeakMap<object, object> | null>(null);
  if (!cacheRef.current) cacheRef.current = new WeakMap();

  /**
   * Последний принятый snapshot. Меняется только когда хотя бы одна
   * из tracked нод изменила версию.
   */
  const snapshotRef = useRef(0);

  // ─── Tracking proxy (мемоизирован по store + sourceProxy) ────────────────

  const trackingProxy = useMemo(
    () =>
      createTrackingProxy(
        sourceProxy,
        refs,
        store,
        cacheRef.current!,
      ) as ConfigProxy<TConfig>,
    [store, sourceProxy, refs],
  );

  // ─── useSyncExternalStore ────────────────────────────────────────────────

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeGlobal(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(() => {
    const { accessed, lastVersions } = refs;

    // Компонент не читал ни одного FIELD_STATE_PROP.
    // Два сценария:
    //   1. hasNavigated = true  → компонент только навигировал (form.email,
    //      form.passport), но сам не читал value/isVisible/… → стабильный
    //      snapshot → НЕ перерендериваемся (Parent-паттерн с пропсами).
    //   2. hasNavigated = false → компонент вообще ничего не трогал
    //      (renderHook без JSX) → fallback на глобальную версию →
    //      перерендериваемся при любом изменении.
    if (accessed.size === 0) {
      return refs.hasNavigated ? snapshotRef.current : store.getVersion();
    }

    // Проверяем, изменилась ли хотя бы одна tracked нода
    let changed = false;
    for (const node of accessed) {
      const currentVersion = store.getNodeVersion(node);
      if (currentVersion !== lastVersions.get(node)) {
        changed = true;
        break;
      }
    }

    if (changed) {
      // Принимаем новый snapshot и обновляем сохранённые версии
      snapshotRef.current = store.getVersion();
      for (const node of accessed) {
        lastVersions.set(node, store.getNodeVersion(node));
      }
    }

    return snapshotRef.current;
  }, [store, refs]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return trackingProxy;
}

