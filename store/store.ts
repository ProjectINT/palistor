import { type FieldState } from "./compute";
import { collectValues, type AnyConfigNode } from "./collectValues";
import { createBuildProxy } from "./buildProxy";
import { registerNodes } from "./registerNodes";
import { recomputeAll as _recomputeAll } from "./recomputeAll";

export type { FieldState };

/** Функция отписки от подписки. */
export type Unsubscribe = () => void;

/**
 * ProxyStore — реактивное хранилище на основе Proxy с вычисляемым состоянием
 *
 * Архитектурная идея:
 *   Конфиг формы — статическое дерево. Листья содержат `value`, `label`,
 *   `isVisible` (могут быть функциями), `validate`, `formatter`, `setter`.
 *   Промежуточные узлы группируют поля (passport.number).
 *
 *   ProxyStore:
 *   1. Хранит вычисленное состояние каждого поля в WeakMap<configNode, FieldState>.
 *      FieldState = { value, isVisible, isRequired, isDisabled, isReadOnly,
 *                     label, placeholder, description, error, errorMessage }
 *   2. При инициализации — вычисляет все функции из конфига (isVisible(values),
 *      validate(value, values) и т.д.) и сохраняет результат.
 *   3. При записи .value — прогоняет formatter, обновляет value, вызывает
 *      validate, пересчитывает computed-свойства всех полей, уведомляет.
 *   4. Proxy оборачивает конфиг, но GET возвращает данные из FieldState,
 *      а не из конфига напрямую.
 *
 * Использование:
 *   const store = createProxyStore({ config, initialValues });
 *   const { proxy } = store;
 *   proxy.passport.number.value        // → "" (из FieldState)
 *   proxy.passport.number.value = "X"  // → formatter → validate → notify
 *   proxy.passport.number.label        // → "Passport Number" (вычислено)
 *   proxy.passport.number.isVisible    // → true (вычислено из функции)
 *   proxy.passport.number.error        // → "required" | undefined (вычислено)
 */

// ─── Типы конфига ────────────────────────────────────────────────────────────

/**
 * Значение либо функция, вычисляемая из текущих значений формы.
 * Большинство свойств конфига (isVisible, isRequired, label, …) могут быть
 * либо статическим значением, либо функцией от всего дерева значений.
 *
 * @example
 * // статическое
 * isVisible: true
 * // вычисляемое
 * isVisible: (values) => values.paymentType === "bank"
 */
export type MaybeComputed<TResult, TValues = Record<string, unknown>> =
  | TResult
  | ((values: TValues) => TResult);

/**
 * Листовой узел конфига — описывает одно поле формы.
 * Все свойства кроме `value` — опциональны.
 * Любое свойство может быть константой или функцией от `TValues`.
 *
 * @template TValue  — тип значения поля
 * @template TValues — форма дерева всех значений (по умолчанию Record<string,any>)
 */
/**
 * Метаданные типа поля (для будущей валидации по типам / кодогенерации).
 */
export interface FieldTypeMeta {
  readonly dataType: "String" | "Number" | "Boolean" | "Date" | "Array" | "Object";
  readonly type: string;
}

export interface FieldConfigNode<TValue = unknown, TValues = Record<string, unknown>> {
  value: MaybeComputed<TValue, TValues>;
  label?: MaybeComputed<string, TValues>;
  placeholder?: MaybeComputed<string, TValues>;
  description?: MaybeComputed<string, TValues>;
  isRequired?: MaybeComputed<boolean, TValues>;
  isReadOnly?: MaybeComputed<boolean, TValues>;
  isDisabled?: MaybeComputed<boolean, TValues>;
  isVisible?: MaybeComputed<boolean, TValues>;
  /**
   * Возвращает строку с ошибкой или falsy-значение если поле валидно.
   * `false` допускается для удобства паттерна `!v && "required"`.
   */
  validate?: (value: TValue, values: TValues) => string | undefined | false;
  /** Преобразует входное значение перед сохранением (например, обрезает пробелы) */
  formatter?: (value: unknown, values: TValues) => TValue;
  /** Сайд-эффект записи: возвращает патч других полей */
  setter?: (value: TValue, values: TValues) => DeepPartialValues<TValues>;
  /** Дополнительные пропсы для UI-компонента */
  componentProps?: Readonly<Record<string, unknown>>;
  /** Список имён полей, при изменении которых пересчитывается состояние этого поля */
  dependencies?: readonly string[];
  /** Метаданные типа поля */
  types?: FieldTypeMeta;
}

/**
 * Групповой (промежуточный) узел конфига.
 * Группирует дочерние поля и сам может иметь computed-флаги видимости/состояния.
 *
 * @template TValues — форма дерева всех значений
 */
export interface GroupConfigNode<TValues = Record<string, unknown>> {
  isVisible?: MaybeComputed<boolean, TValues>;
  isRequired?: MaybeComputed<boolean, TValues>;
  isReadOnly?: MaybeComputed<boolean, TValues>;
  isDisabled?: MaybeComputed<boolean, TValues>;
}

// ─── Proxy-типы ──────────────────────────────────────────────────────────────

/**
 * Ключи конфига, которые не являются дочерними полями (скрываются при маппинге
 * gruppового узла).
 */
type ConfigSkipKeys =
  | "value"
  | "label"
  | "placeholder"
  | "description"
  | "validate"
  | "formatter"
  | "setter"
  | "isRequired"
  | "isReadOnly"
  | "isDisabled"
  | "isVisible"
  | "error"
  | "errorMessage"
  | "componentProps"
  | "types"
  | "dependencies"

/**
 * Расширяет тип значения, чтобы допустить типичные «входные» типы форматтеров.
 * Числовые поля принимают string (Input возвращает строку), булевы — string/number.
 * Остальные типы остаются как есть.
 */
type ProxyValueType<T> = T extends number
  ? T | string
  : T extends boolean
    ? T | string | number
    : T;

/**
 * Форма доступного через прокси листового поля.
 * Все функции (isVisible, validate, …) уже вычислены.
 */
export interface FieldProxyNode<TValue = unknown> {
  /** Чтение возвращает типизированное значение, запись принимает расширенный тип (string для number-полей и т.д.) */
  get value(): TValue;
  set value(v: ProxyValueType<TValue>);
  readonly label: string | undefined;
  readonly placeholder: string | undefined;
  readonly description: string | undefined;
  readonly isRequired: boolean;
  readonly isReadOnly: boolean;
  readonly isDisabled: boolean;
  readonly isVisible: boolean;
  /** true если поле имеет ошибку валидации */
  readonly error: boolean | undefined;
  readonly errorMessage: string | undefined;
}

/** Извлекает тип значения из узла конфига. */
type ExtractNodeValue<T> = T extends { value: (...args: any[]) => infer R }
  ? R
  : T extends { value: infer V }
    ? V
    : never;

/**
 * Вычисленные флаги группового узла (присутствуют, если заданы в конфиге;
 * могут быть boolean-константой или функцией — в прокси уже разрешены).
 */
export interface GroupProxyNode {
  readonly isVisible: boolean;
  readonly isRequired: boolean | undefined;
  readonly isReadOnly: boolean | undefined;
  readonly isDisabled: boolean | undefined;
  readonly error: boolean | undefined;
  readonly errorMessage: string | undefined;
}

/**
 * Рекурсивно конвертирует узел конфига в его прокси-тип:
 * - Листовой узел (есть `value`) → `FieldProxyNode<TValue>`
 * - Групповой узел              → `GroupProxyNode & { дочерние поля… }`
 */
type ConfigNodeToProxy<T> = T extends { value: any }
  ? FieldProxyNode<ExtractNodeValue<T>>
  : T extends Record<string, any>
    ? GroupProxyNode & {
        [K in keyof T as K extends ConfigSkipKeys ? never : K]: ConfigNodeToProxy<T[K]>;
      }
    : never;

/**
 * Полный прокси для конфига формы: каждый ключ маппируется в прокси-узел.
 */
export type ConfigProxy<TConfig extends Record<string, any>> = {
  [K in keyof TConfig]: ConfigNodeToProxy<TConfig[K]>;
};

/**
 * Рекурсивно извлекает типы значений из конфига формы.
 * Листовые узлы (содержащие `value`) → тип значения.
 * Групповые узлы → вложенный объект с теми же правилами.
 * Служебные ключи (validate, formatter, …) — пропускаются.
 */
export type ExtractValues<T> = {
  [K in keyof T as K extends ConfigSkipKeys ? never : K]: T[K] extends { value: any }
    ? ExtractNodeValue<T[K]>
    : T[K] extends Record<string, any>
      ? ExtractValues<T[K]>
      : never;
};

/**
 * Глубокая опциональная версия `ExtractValues`.
 * Используется как тип `initialValues` — все поля необязательны.
 */
/**
 * Глубокая опциональная версия значений.
 * Рекурсирует только в «плоские» объекты; массивы, Date, Map, Set и т.д.
 * остаются как есть.
 */
export type DeepPartialValues<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends Date
      ? T[K]
      : T[K] extends Map<unknown, unknown>
        ? T[K]
        : T[K] extends Set<unknown>
          ? T[K]
          : T[K] extends Record<string, unknown>
            ? DeepPartialValues<T[K]>
            : T[K];
};

// ─── Интерфейсы ──────────────────────────────────────────────────────────────

export interface ProxyStoreOptions<TConfig extends Record<string, any>> {
  /** Декларативное описание структуры и полей формы. Остаётся неизменяемым. */
  config: TConfig;
  /**
   * Стартовые значения, которые перекрывают значения по умолчанию из конфига.
   * Структура совпадает со структурой конфига, но все поля опциональны.
   */
  initialValues?: DeepPartialValues<ExtractValues<TConfig>>;
}

export interface ProxyStore<TConfig extends Record<string, any>> {
  /**
   * Реактивный прокси. Повторяет структуру конфига.
   * GET .value / .isVisible / … → из вычисленного FieldState
   * SET .value = X → formatter → validate → recompute → notify
   */
  proxy: ConfigProxy<TConfig>;

  /**
   * Подписаться на изменение состояния конкретного узла конфига.
   * Возвращает функцию-отписку.
   */
  subscribe: (node: object, listener: () => void) => Unsubscribe;

  /**
   * Подписаться на ЛЮБОЕ изменение в хранилище.
   * Используется useForm для useSyncExternalStore.
   * Возвращает функцию-отписку.
   */
  subscribeGlobal: (listener: () => void) => Unsubscribe;

  /**
   * Глобальная версия хранилища. Инкрементируется при каждом изменении.
   * Используется как snapshot для useSyncExternalStore.
   */
  getVersion: () => number;

  /**
   * Версия конкретного узла. Обновляется при изменении состояния узла.
   * Используется для точечной подписки (re-render только по прочитанным полям).
   */
  getNodeVersion: (node: object) => number;

  /**
   * Все текущие значения полей в виде вложенного объекта.
   */
  getValues: () => ExtractValues<TConfig>;
}

// ─── Фабрика ─────────────────────────────────────────────────────────────────

/**
 * Создать ProxyStore с вычисляемым состоянием.
 *
 * @example
 * const store = createProxyStore({
 *   config: {
 *     email: { value: "", label: "Email", isRequired: true, validate: v => !v ? "required" : undefined },
 *     passport: {
 *       isVisible: (v) => v.paymentType === "bank",
 *       number: { value: "", label: "Passport Number" },
 *     },
 *   },
 *   initialValues: { email: "user@example.com" },
 * });
 *
 * store.proxy.email.value            // → "user@example.com"
 * store.proxy.email.isRequired       // → true
 * store.proxy.email.error            // → undefined (потому что value не пустой)
 * store.proxy.email.value = ""       // → пересчёт → error = "required"
 * store.proxy.passport.isVisible     // → false (paymentType != "bank")
 */
export function createProxyStore<TConfig extends Record<string, any>>(
  options: ProxyStoreOptions<TConfig>,
): ProxyStore<TConfig> {
  const { config, initialValues = {} } = options;
  const rootConfig = config as AnyConfigNode;

  // ─── Хранилища ────────────────────────────────────────────────────────────

  /**
   * Вычисленное состояние каждого листового поля.
   * Ключ — объект-узел конфига, значение — FieldState.
   */
  const nodeState = new WeakMap<object, FieldState>();

  /**
   * Список всех листовых узлов конфига (для полного пересчёта).
   * Заполняется при init, используется при recompute.
   */
  const leafNodes: Array<{ node: AnyConfigNode }> = [];

  /** Подписчики на изменение каждого поля. */
  const nodeListeners = new WeakMap<object, Set<() => void>>();

  /** Глобальные подписчики — уведомляются при ЛЮБОМ изменении. */
  const globalListeners = new Set<() => void>();

  /** Глобальная версия — инкрементируется при каждом изменении. */
  let version = 0;

  /** Версии отдельных узлов — для точечной подписки. */
  const nodeVersions = new WeakMap<object, number>();

  /** Кэш Proxy-объектов — один прокси на узел конфига. */
  const proxyCache = new WeakMap<object, unknown>();

  // ─── Инициализация ─────────────────────────────────────────────────────────

  function recomputeAll(): Set<object> {
    return _recomputeAll(rootConfig, leafNodes, nodeState);
  }

  // Выполняем инициализацию
  registerNodes(rootConfig, initialValues, leafNodes, nodeState);
  recomputeAll(); // вычисляем isVisible, isRequired, error и т.д.

  // ─── Уведомление подписчиков ───────────────────────────────────────────────

  function notify(node: object) {
    nodeListeners.get(node)?.forEach((fn) => fn());
  }

  function notifyChanged(changed: Set<object>) {
    if (changed.size === 0) return;

    // Инкрементируем глобальную версию
    version++;

    // Обновляем версии изменённых узлов + уведомляем per-node подписчиков
    for (const node of changed) {
      nodeVersions.set(node, version);
      notify(node);
    }

    // Уведомляем глобальных подписчиков
    globalListeners.forEach((fn) => fn());
  }

  // ─── Построение Proxy ──────────────────────────────────────────────────────
  const buildProxy = createBuildProxy({ proxyCache, nodeState, rootConfig, recomputeAll, notifyChanged });

  // ─── Подписка ──────────────────────────────────────────────────────────────
  const subscribe = (node: object, listener: () => void): Unsubscribe => {
    if (!nodeListeners.has(node)) nodeListeners.set(node, new Set());
    nodeListeners.get(node)!.add(listener);
    return () => nodeListeners.get(node)!.delete(listener);
  };

  const subscribeGlobal = (listener: () => void): Unsubscribe => {
    globalListeners.add(listener);
    return () => globalListeners.delete(listener);
  };

  // ─── Публичный API ─────────────────────────────────────────────────────────
  return {
    proxy: buildProxy(rootConfig) as ConfigProxy<TConfig>,
    subscribe,
    subscribeGlobal,
    getVersion: () => version,
    getNodeVersion: (node: object) => nodeVersions.get(node) ?? 0,
    getValues: () => collectValues(rootConfig, nodeState) as ExtractValues<TConfig>,
  };
}

