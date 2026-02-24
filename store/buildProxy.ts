import { FIELD_STATE_PROPS, CONFIG_NODE, CONFIG_PROPS } from "./constants";
import { type AnyConfigNode } from "./collectValues";
import { writeValue, type WriteDeps } from "./writePipeline";
import type { FieldState } from "./compute";

export interface BuildProxyDeps {
  proxyCache: WeakMap<object, unknown>;
  nodeState: WeakMap<object, FieldState>;
  rootConfig: AnyConfigNode;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
}

/**
 * Ключи конфига, которые НЕ должны утекать при spread-операции ({...proxy}).
 * Это внутренние свойства конфига (validate, formatter, setter, …), которые
 * могут конфликтовать с пропсами UI-компонентов (например, HeroUI Input
 * имеет свой `validate` и вызовет конфиг-функцию с неправильными аргументами).
 */
const INTERNAL_CONFIG_KEYS = new Set<string>([
  "validate",
  "formatter",
  "setter",
  "types",
  "dependencies",
  "nested",
]);

/**
 * Вычислить «публичные» ключи узла прокси для ownKeys/spread.
 *
 * Для листового узла (есть state): FIELD_STATE_PROPS + onValueChange + componentProps children.
 * Для группового узла: FIELD_STATE_PROPS (из state, если есть) + дочерние ключи-объекты.
 */
function computeProxyKeys(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>): string[] {
  const isLeaf = "value" in node;
  const keys: string[] = [];

  if (isLeaf) {
    // Листовой узел — отдаём вычисленное состояние + onValueChange
    for (const k of FIELD_STATE_PROPS) keys.push(k);
    keys.push("onValueChange");

    // componentProps — дополнительные пропсы для UI-компонента
    if (node.componentProps && typeof node.componentProps === "object") {
      for (const k of Object.keys(node.componentProps as Record<string, unknown>)) {
        keys.push(k);
      }
    }
  } else {
    // Групповой узел — состояние группы (если есть) + дочерние ключи
    const state = nodeState.get(node);
    if (state) {
      // У группы могут быть isVisible, isRequired, etc.
      for (const k of FIELD_STATE_PROPS) {
        if ((state as any)[k] !== undefined) keys.push(k);
      }
    }

    // Дочерние ключи-объекты (вложенные поля/группы)
    for (const k of Object.keys(node)) {
      if (INTERNAL_CONFIG_KEYS.has(k) || CONFIG_PROPS.has(k)) continue;
      const child = node[k];
      if (child && typeof child === "object") keys.push(k);
    }
  }

  return keys;
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
 *
 * OWNKEYS / GETOWNPROPERTYDESCRIPTOR:
 *   - Контролируют, какие ключи видны при spread ({...proxy}),
 *     Object.keys() и for...in. Скрывают внутренние ключи конфига
 *     (validate, formatter, setter, …), которые не должны утекать как пропсы.
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

  /** Зависимости write pipeline — собранные один раз для всех узлов. */
  const writeDeps: WriteDeps = { rootConfig, nodeState, recomputeAll };

  function buildProxy(node: AnyConfigNode): any {
    if (proxyCache.has(node)) return proxyCache.get(node);

    const p: Record<string, any> = new Proxy(node as Record<string, any>, {
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
        if (key !== "value") return false;

        // Весь процесс записи делегирован write pipeline:
        // format → store → setter patch → recompute → merge changed
        const result = writeValue(node, newValue, writeDeps);
        if (!result) return false;

        notifyChanged(result.changed);
        return true;
      },

      /**
       * Контролирует Object.keys(), Object.getOwnPropertyNames(), for...in, spread.
       * Скрывает внутренние ключи конфига (validate, formatter, …),
       * которые не должны утекать как пропсы в UI-компоненты.
       */
      ownKeys() {
        return computeProxyKeys(node, nodeState);
      },

      /**
       * Должен соответствовать ownKeys: для каждого ключа возвращаем
       * дескриптор enumerable + configurable, иначе Proxy выбросит invariant.
       */
      getOwnPropertyDescriptor(_target, key: string | symbol) {
        if (typeof key === "symbol") return undefined;
        const keys = computeProxyKeys(node, nodeState);
        if (!keys.includes(key)) return undefined;
        return { configurable: true, enumerable: true, writable: true, value: p[key] };
      },
    });

    proxyCache.set(node, p);
    return p;
  }

  return buildProxy;
}
