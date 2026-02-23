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

// ─── Вычисленное состояние поля ──────────────────────────────────────────────

/**
 * Полное вычисленное состояние одного поля.
 *
 * Хранится в WeakMap<configNode, FieldState>. Все функции из конфига
 * (isVisible, isRequired, validate…) уже вызваны, результат — чистые значения.
 */
export interface FieldState {
  value: any;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  error?: string;
  errorMessage?: string;
}

// ─── Наборы ключей ───────────────────────────────────────────────────────────

/**
 * Свойства, относящиеся к состоянию поля. При обращении к ним прокси
 * возвращает значение из FieldState (вычисленное), а не из конфига.
 */
const FIELD_STATE_PROPS = new Set<string>([
  "value",
  "label",
  "placeholder",
  "description",
  "isRequired",
  "isReadOnly",
  "isDisabled",
  "isVisible",
  "error",
  "errorMessage",
]);

/**
 * Полный набор «служебных» ключей узла конфига.
 * При обходе дерева (init, collectValues) — пропускаются.
 */
const CONFIG_PROPS = new Set<string>([
  ...FIELD_STATE_PROPS,
  "validate",
  "formatter",
  "setter",
  "componentProps",
  "types",
  "dependencies",
  "nested",
]);

// ─── Proxy-типы ──────────────────────────────────────────────────────────────

/**
 * Ключи конфига, которые не являются дочерними полями (скрываются при маппинге
 * группового узла).
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
  | "nested";

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
export interface FieldProxyNode<TValue = any> {
  value: ProxyValueType<TValue>;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  error?: string;
  errorMessage?: string;
}

/** Извлекает тип значения из узла конфига. */
type ExtractNodeValue<T> = T extends { value: (...args: any[]) => infer R }
  ? R
  : T extends { value: infer V }
    ? V
    : never;

/**
 * Рекурсивно конвертирует узел конфига в его прокси-тип:
 * - Листовой узел (есть `value`) → `FieldProxyNode<TValue>`
 * - Групповой узел              → `{ isVisible: boolean } & { дочерние поля… }`
 */
type ConfigNodeToProxy<T> = T extends { value: any }
  ? FieldProxyNode<ExtractNodeValue<T>>
  : T extends Record<string, any>
    ? { isVisible: boolean } & {
        [K in keyof T as K extends ConfigSkipKeys ? never : K]: ConfigNodeToProxy<T[K]>;
      }
    : never;

/**
 * Полный прокси для конфига формы: каждый ключ маппируется в прокси-узел.
 */
export type ConfigProxy<TConfig extends Record<string, any>> = {
  [K in keyof TConfig]: ConfigNodeToProxy<TConfig[K]>;
};

// ─── Интерфейсы ──────────────────────────────────────────────────────────────

export interface ProxyStoreOptions<TConfig extends Record<string, any>> {
  /** Декларативное описание структуры и полей формы. Остаётся неизменяемым. */
  config: TConfig;
  /**
   * Стартовые значения, которые перекрывают значения по умолчанию из конфига.
   * Структура совпадает со структурой конфига, но все поля опциональны.
   */
  initialValues?: Record<string, any>;
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
  subscribe: (node: object, listener: () => void) => () => void;

  /**
   * Подписаться на ЛЮБОЕ изменение в хранилище.
   * Используется useForm для useSyncExternalStore.
   * Возвращает функцию-отписку.
   */
  subscribeGlobal: (listener: () => void) => () => void;

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
  getValues: () => Record<string, any>;
}

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Вычисляет одно свойство-флаг из конфига: если это функция — вызывает с values,
 * иначе возвращает как есть. Если undefined — возвращает defaultValue.
 */
function resolveFlag(
  configValue: boolean | ((values: any) => boolean) | undefined,
  values: Record<string, any>,
  defaultValue: boolean,
): boolean {
  if (configValue === undefined) return defaultValue;
  if (typeof configValue === "function") return configValue(values);
  return configValue;
}

/**
 * Вычисляет строковое свойство (label, placeholder, description) из конфига.
 * Может быть строкой или функцией (translate, settings).
 * Пока без translate — если функция, вызываем с identity-функцией.
 */
function resolveString(
  configValue: string | ((translate: any, settings?: any) => string) | undefined,
): string | undefined {
  if (configValue === undefined) return undefined;
  if (typeof configValue === "function") {
    // translate-функцию пока заменяем identity — вернёт ключ как есть
    return configValue((key: string) => key);
  }
  return configValue;
}

/**
 * Вычисляет полное состояние одного поля на основе конфига и текущих values.
 */
function computeFieldState(
  configNode: Record<string, any>,
  currentValue: any,
  allValues: Record<string, any>,
): FieldState {
  // Вычисляем флаги
  const isVisible = resolveFlag(configNode.isVisible, allValues, true);
  const isRequired = resolveFlag(configNode.isRequired, allValues, false);
  const isDisabled = resolveFlag(configNode.isDisabled, allValues, false);
  const isReadOnly = resolveFlag(configNode.isReadOnly, allValues, false);

  // Строки
  const label = resolveString(configNode.label);
  const placeholder = resolveString(configNode.placeholder);
  const description = resolveString(configNode.description);

  // Валидация
  let error: string | undefined;
  let errorMessage: string | undefined;
  if (typeof configNode.validate === "function") {
    const result = configNode.validate(currentValue, allValues);
    if (result) {
      error = result;
      errorMessage = result;
    }
  }

  return {
    value: currentValue,
    isVisible,
    isRequired,
    isDisabled,
    isReadOnly,
    label,
    placeholder,
    description,
    error,
    errorMessage,
  };
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
  const root = config as Record<string, any>;

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
  const leafNodes: Array<{ node: Record<string, any>; path: string[] }> = [];

  /** Подписчики на изменение каждого поля. */
  const nodeListeners = new WeakMap<object, Set<() => void>>();

  /** Глобальные подписчики — уведомляются при ЛЮБОМ изменении. */
  const globalListeners = new Set<() => void>();

  /** Глобальная версия — инкрементируется при каждом изменении. */
  let version = 0;

  /** Версии отдельных узлов — для точечной подписки. */
  const nodeVersions = new WeakMap<object, number>();

  /** Кэш Proxy-объектов — один прокси на узел конфига. */
  const proxyCache = new WeakMap<object, any>();

  // ─── Сбор значений ─────────────────────────────────────────────────────────

  /**
   * Рекурсивно собирает текущие значения всех полей в вложенный объект.
   * Используется для: передачи в compute-функции, getValues(), submit.
   */
  function collectValues(node: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;

      const child = node[key] as Record<string, any>;
      if (!child || typeof child !== "object") continue;

      if ("value" in child) {
        // Листовой узел — берём value из вычисленного состояния
        result[key] = nodeState.get(child)?.value ?? "";
      } else {
        // Группа — рекурсия
        result[key] = collectValues(child);
      }
    }
    return result;
  }

  // ─── Инициализация ─────────────────────────────────────────────────────────

  /**
   * Фаза 1: Собираем все листовые узлы и устанавливаем начальные value.
   * Ещё не вычисляем computed — для этого нужны все values.
   */
  function registerNodes(
    node: Record<string, any>,
    initialSlice: any,
    path: string[],
  ) {
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;

      const child = node[key] as Record<string, any>;
      if (!child || typeof child !== "object") continue;

      const childPath = [...path, key];

      if ("value" in child) {
        // Листовой узел: запоминаем, ставим начальный value (computed позже)
        leafNodes.push({ node: child, path: childPath });

        const rawValue = child.value;
        const initialValue = initialSlice?.[key] ?? rawValue ?? "";
        // Временный FieldState — только value, остальное заполнится в computeAll
        nodeState.set(child, {
          value: initialValue,
          isVisible: true,
          isRequired: false,
          isDisabled: false,
          isReadOnly: false,
        });
      }

      // Если промежуточный узел имеет computed-свойства (isVisible на группе),
      // регистрируем его тоже как "виртуальный" лист
      if (!("value" in child) && hasComputedProps(child)) {
        leafNodes.push({ node: child, path: childPath });
        nodeState.set(child, {
          value: undefined,
          isVisible: true,
          isRequired: false,
          isDisabled: false,
          isReadOnly: false,
        });
      }

      // Рекурсия в дочерние
      registerNodes(child, initialSlice?.[key], childPath);
    }
  }

  /**
   * Проверяет, есть ли у узла вычисляемые свойства (функции isVisible, isRequired…).
   * Нужно для промежуточных узлов-групп (passport.isVisible).
   */
  function hasComputedProps(node: Record<string, any>): boolean {
    for (const key of FIELD_STATE_PROPS) {
      if (key === "value") continue;
      if (node[key] !== undefined) return true;
    }
    return false;
  }

  /**
   * Фаза 2: Пересчитать вычисленное состояние всех листовых полей.
   * Вызывается при init и после каждого SET .value.
   *
   * Возвращает Set узлов, чьё состояние изменилось (для notify).
   */
  function recomputeAll(): Set<object> {
    const allValues = collectValues(root);
    const changed = new Set<object>();

    for (const { node } of leafNodes) {
      const prev = nodeState.get(node);
      const currentValue = prev?.value ?? "";
      const next = computeFieldState(node, currentValue, allValues);

      // Проверяем, изменилось ли что-то
      if (prev && !fieldStateChanged(prev, next)) continue;

      nodeState.set(node, next);
      changed.add(node);
    }

    return changed;
  }

  /**
   * Поверхностное сравнение двух FieldState.
   */
  function fieldStateChanged(a: FieldState, b: FieldState): boolean {
    return (
      a.value !== b.value ||
      a.isVisible !== b.isVisible ||
      a.isRequired !== b.isRequired ||
      a.isDisabled !== b.isDisabled ||
      a.isReadOnly !== b.isReadOnly ||
      a.label !== b.label ||
      a.placeholder !== b.placeholder ||
      a.description !== b.description ||
      a.error !== b.error ||
      a.errorMessage !== b.errorMessage
    );
  }

  // Выполняем инициализацию
  registerNodes(root, initialValues, []);
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

  /**
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
  function buildProxy(node: Record<string, any>): any {
    if (proxyCache.has(node)) return proxyCache.get(node);

    const p = new Proxy(node, {
      get(_target, key: string | symbol) {
        // Игнорируем символы (Symbol.toPrimitive, Symbol.iterator …)
        if (typeof key === "symbol") return undefined;

        // Вычисленное состояние поля
        if (FIELD_STATE_PROPS.has(key)) {
          const state = nodeState.get(node);
          if (state) return state[key as keyof FieldState];
          // Для узлов без состояния (промежуточные без computed) — из конфига
          return node[key];
        }

        // Дочерний узел → рекурсивный прокси
        const child = node[key];
        if (child && typeof child === "object") return buildProxy(child);

        // Примитив (функция-валидатор, строка и т.д.)
        return child;
      },

      set(_target, key: string | symbol, newValue: any) {
        if (key === "value") {
          const state = nodeState.get(node);
          if (!state) return false;

          // Применяем formatter, если есть
          let processedValue = newValue;
          if (typeof node.formatter === "function") {
            const allValues = collectValues(root);
            processedValue = node.formatter(newValue, allValues);
          }

          // Обновляем value в state
          state.value = processedValue;
          nodeState.set(node, state);

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

  // ─── Подписка ──────────────────────────────────────────────────────────────

  const subscribe = (node: object, listener: () => void) => {
    if (!nodeListeners.has(node)) nodeListeners.set(node, new Set());
    nodeListeners.get(node)!.add(listener);
    return () => nodeListeners.get(node)!.delete(listener);
  };

  const subscribeGlobal = (listener: () => void) => {
    globalListeners.add(listener);
    return () => globalListeners.delete(listener);
  };

  // ─── Публичный API ─────────────────────────────────────────────────────────

  return {
    proxy: buildProxy(root) as ConfigProxy<TConfig>,
    subscribe,
    subscribeGlobal,
    getVersion: () => version,
    getNodeVersion: (node: object) => nodeVersions.get(node) ?? 0,
    getValues: () => collectValues(root),
  };
}

