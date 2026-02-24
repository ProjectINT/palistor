import { FIELD_STATE_PROPS, CONFIG_NODE } from "./constants";
import { collectValues, type AnyConfigNode } from "./collectValues";
import type { FieldState } from "./compute";

export interface BuildProxyDeps {
  proxyCache: WeakMap<object, unknown>;
  nodeState: WeakMap<object, FieldState>;
  rootConfig: AnyConfigNode;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
}

/**
 * Создаёт функцию buildProxy, которая оборачивает узел конфига в Proxy.
 *
 * Proxy перехватывает:
 *
 * GET:
 *   - FIELD_STATE_PROPS → из вычисленного FieldState (value, isVisible, error…)
 *   - другой ключ → рекурсивный прокси дочернего узла
 *
 * SET:
 *   - "value" → formatter → update value → recomputeAll → notify
 *   - остальное → запрещено
 */
export function createBuildProxy({
  proxyCache,
  nodeState,
  rootConfig,
  recomputeAll,
  notifyChanged,
}: BuildProxyDeps): (node: AnyConfigNode) => any {
  /** Кэш onValueChange-функций — стабильная ссылка для React-мемоизации. */
  const onValueChangeCache = new WeakMap<object, (v: unknown) => void>();

  function buildProxy(node: AnyConfigNode): any {
    if (proxyCache.has(node)) return proxyCache.get(node);

    const p = new Proxy(node as Record<string, any>, {
      get(_target, key: string | symbol) {
        // Символ для доступа к исходному config-узлу (используется tracking proxy)
        if (key === CONFIG_NODE) return node;

        // Игнорируем символы (Symbol.toPrimitive, Symbol.iterator …)
        if (typeof key === "symbol") return undefined;

        // onValueChange — функциональный setter для value (стабильная ссылка)
        if (key === "onValueChange") {
          if (!onValueChangeCache.has(node)) {
            onValueChangeCache.set(node, (v: unknown) => { p.value = v; });
          }
          return onValueChangeCache.get(node);
        }

        // Вычисленное состояние поля
        if (FIELD_STATE_PROPS.has(key)) {
          const state = nodeState.get(node);
          if (state) return state[key as keyof FieldState];
          // Для узлов без состояния (промежуточные без computed) — из конфига
          return node[key];
        }

        // Дочерний узел → рекурсивный прокси
        const child = node[key];
        if (child && typeof child === "object") return buildProxy(child as AnyConfigNode);

        // Примитив (функция-валидатор, строка и т.д.)
        return child;
      },

      set(_target, key: string | symbol, newValue: unknown) {
        if (key === "value") {
          const state = nodeState.get(node);
          if (!state) return false;

          // Применяем formatter, если есть
          let processedValue: unknown = newValue;
          if (typeof node.formatter === "function") {
            const allValues = collectValues(rootConfig, nodeState);
            processedValue = (node.formatter as (v: unknown, vals: Record<string, unknown>) => unknown)(
              newValue,
              allValues,
            );
          }

          // Обновляем value в state иммутабельно
          nodeState.set(node, { ...state, value: processedValue });

          // Пересчитываем состояние всех полей (validate, isVisible, …)
          const changed = recomputeAll();

          // Уведомляем подписчиков изменённых полей
          // (текущий узел всегда считается изменённым)
          changed.add(node);
          notifyChanged(changed);

          return true;
        }
        // Запись в другие свойства запрещена — конфиг иммутабелен
        return false;
      },
    });

    proxyCache.set(node, p);
    return p;
  }

  return buildProxy;
}
