import { FIELD_STATE_PROPS, CONFIG_NODE, CONFIG_PROPS } from "./constants";
import { type AnyConfigNode } from "./collectValues";
import { writeValue, type WriteDeps } from "./writePipeline";
import type { FieldState } from "./compute";
import type { TranslateFn } from "../core/types";
import type { ResolveState } from "./resolvePipeline";

export interface BuildProxyDeps {
  proxyCache: WeakMap<object, unknown>;
  nodeState: WeakMap<object, FieldState>;
  rootConfig: AnyConfigNode;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  /** Возвращает зарегистрированную функцию перевода (или null). */
  getTranslator: () => TranslateFn | null;
  /** Запуск submit pipeline для группового узла. */
  submitNode: (node: AnyConfigNode) => Promise<unknown>;
  /** Запуск reset для группового узла. */
  resetNode: (node: AnyConfigNode, values?: Record<string, unknown>) => void;
  /** Fire-and-forget onChange для листового узла. */
  onFieldChange?: (node: AnyConfigNode, newValue: unknown, previousValue: unknown) => void;
  /** Trigger resolve for a group node with resolve config. */
  triggerResolve?: (node: AnyConfigNode) => void;
  /** Get resolve state for a node (undefined if no resolve). */
  getResolveState?: (node: AnyConfigNode) => ResolveState | undefined;
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
  // Handler props (submit, reset, onChange lifecycle)
  "onSubmit",
  "beforeSubmit",
  "afterSubmit",
  "reset",
  "onChange",
  // Resolve props
  "resolve",
  "deps",
]);

/**
 * Свойства, которые резолвятся лениво через зарегистрированный translator.
 * Если в конфиге это функция (t) => t(«key») и translator есть —
 * вызываем прямо в GET trap, иначе fallback на FieldState (ключ).
 */
const TRANSLATABLE_PROPS = new Set<string>(["label", "placeholder", "description"]);

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
  getTranslator,
  submitNode,
  resetNode,
  onFieldChange,
  triggerResolve,
  getResolveState,
}: BuildProxyDeps): (node: AnyConfigNode) => any {
  /** Кэш onValueChange-функций — стабильная ссылка для React-мемоизации. */
  const onValueChangeCache = new WeakMap<object, (v: unknown) => void>();
  /** Кэш submit-функций — стабильная ссылка для React-мемоизации. */
  const submitCache = new WeakMap<object, () => Promise<unknown>>();
  /** Кэш reset-функций — стабильная ссылка для React-мемоизации. */
  const resetCache = new WeakMap<object, (values?: Record<string, unknown>) => void>();

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

        // ── Handler methods (для групповых узлов) ────────────────────────
        if (!("value" in node)) {
          if (key === "submitting") {
            return nodeState.get(node)?.submitting ?? false;
          }
          if (key === "dirty") {
            return nodeState.get(node)?.dirty ?? false;
          }
          if (key === "revalidate") {
            return nodeState.get(node)?.revalidate ?? false;
          }
          if (key === "loading") {
            return nodeState.get(node)?.loading ?? false;
          }
          if (key === "submit") {
            if (!submitCache.has(node)) {
              submitCache.set(node, () => submitNode(node));
            }
            return submitCache.get(node);
          }
          if (key === "reset") {
            if (!resetCache.has(node)) {
              resetCache.set(node, (values?: Record<string, unknown>) => resetNode(node, values));
            }
            return resetCache.get(node);
          }

          // ── Resolve: lazy trigger + suspense ───────────────────────────
          if (triggerResolve && getResolveState && node.resolve) {
            const resolveState = getResolveState(node);
            if (resolveState) {
              // Lazy trigger: first access to a group node with idle resolve
              if (resolveState.status === "idle") {
                triggerResolve(node);
              }
              // Suspense: throw promise if pending + suspense: true
              if (
                resolveState.status === "pending" &&
                resolveState.promise &&
                (node.resolve as any).options?.suspense === true
              ) {
                throw resolveState.promise;
              }
            }
          }
        }

        // Вычисленное состояние поля
        if (FIELD_STATE_PROPS.has(key)) {
          // Ленивый резолв строковых свойств через translator
          if (TRANSLATABLE_PROPS.has(key)) {
            const configValue = node[key];
            if (typeof configValue === "function") {
              const t = getTranslator();
              if (t) return configValue(t);
            }
          }

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

        // Захватываем предыдущее значение для onChange
        const previousValue = nodeState.get(node)?.value;

        // Весь процесс записи делегирован write pipeline:
        // format → store → setter patch → recompute → merge changed
        const result = writeValue(node, newValue, writeDeps);
        if (!result) return false;

        notifyChanged(result.changed);

        // Fire onChange на группах-предках (fire-and-forget, async)
        if (onFieldChange) {
          const actualNewValue = nodeState.get(node)?.value;
          onFieldChange(node, actualNewValue, previousValue);
        }

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
