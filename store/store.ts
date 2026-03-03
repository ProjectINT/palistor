import { type FieldState } from "./compute";
import { collectValues, type AnyConfigNode } from "./collectValues";
import { createBuildProxy } from "./buildProxy";
import { registerNodes } from "./registerNodes";
import { recomputeAll as _recomputeAll } from "./recomputeAll";
import type { TranslateFn } from "../core/types";
import { createPersistManager, type PersistManager } from "./persist/persistManager";
import { buildNodeMaps } from "./nodeMap";
import { executeReset, type ResetDeps } from "./resetPipeline";
import { executeSubmit, SubmitResult, type SubmitDeps } from "./submitPipeline";
import { fireOnChange, type OnChangeDeps } from "./onChangePipeline";
import { CONFIG_PROPS } from "./constants";
import { captureInitialValues, recomputeDirty } from "./dirtyTracking";
import {
  type Resolve,
  type NotifyFn,
  type ResolveState,
  type ResolveDeps,
  initResolveStates,
  executeResolve,
  findResolvesToRetrigger,
  resetResolveState,
} from "./resolvePipeline";

export type { FieldState };

export type { Resolve, NotifyFn } from "./resolvePipeline";

export type { SubmitResult } from "./submitPipeline";

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
 * Метаданные типа поля (для будущей валидации по типам / кодогенерации).
 */
export interface FieldTypeMeta {
  readonly dataType: "String" | "Number" | "Boolean" | "Date" | "Array" | "Object";
  readonly type: string;
}

/**
 * Универсальный узел конфига — описывает и поле, и группу.
 *
 * Поведение узла определяется наличием свойств:
 *   - Есть `value` → листовой узел (поле формы)
 *   - Нет `value`  → групповой узел (контейнер для дочерних)
 *
 * Все свойства кроме `value` — опциональны.
 * Любое computed-свойство может быть константой или функцией от `TValues`.
 *
 * @template TValue  — тип значения поля (актуально для листовых узлов)
 * @template TValues — форма дерева всех значений (по умолчанию Record<string,any>)
 */
export interface ConfigNode<TValue = unknown, TValues = Record<string, unknown>> {
  // ─── Поле (если есть value — узел считается листовым) ──────────────────
  value?: MaybeComputed<TValue, TValues>;
  label?: MaybeComputed<string, TValues>;
  placeholder?: MaybeComputed<string, TValues>;
  description?: MaybeComputed<string, TValues>;
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

  // ─── Общие флаги (и поле, и группа) ───────────────────────────────────
  isRequired?: MaybeComputed<boolean, TValues>;
  isReadOnly?: MaybeComputed<boolean, TValues>;
  isDisabled?: MaybeComputed<boolean, TValues>;
  isVisible?: MaybeComputed<boolean, TValues>;

  // ─── Lifecycle (любой узел) ────────────────────────────────────────────
  /**
   * Трансформирует значение перед submit (не мутирует store).
   * На листовом узле: `(value, values) → value`
   * На групповом узле: `(values) → values`
   */
  beforeSubmit?: ((value: TValue, values: TValues) => TValue) | ((values: TValues) => TValues);
  /** Callback отправки формы. Вызывается после валидации в submit pipeline. */
  onSubmit?: (values: TValues) => Promise<unknown> | unknown;
  /** Пост-обработка после успешного onSubmit. */
  afterSubmit?: (
    result: unknown,
    actions: { reset: () => void },
  ) => void | Promise<void>;
  /** Трансформер для reset: принимает defaults, возвращает окончательные значения. */
  reset?: (defaults: TValues) => TValues;
  /**
   * Вызывается после изменения любого поля в группе (fire-and-forget).
   * Может вернуть патч для мержа обратно в store.
   */
  onChange?: (info: {
    fieldKey: string;
    newValue: unknown;
    previousValue: unknown;
    allValues: TValues;
  }) => DeepPartialValues<TValues> | void | Promise<DeepPartialValues<TValues> | void>;
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
  | "onSubmit"
  | "beforeSubmit"
  | "afterSubmit"
  | "reset"
  | "onChange"
  | "resolve"
  | "deps"

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
  /** true если текущее значение отличается от initial */
  readonly dirty: boolean;
  readonly onValueChange: (v: ProxyValueType<TValue>) => void;
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
  /** true пока выполняется submit pipeline. */
  readonly submitting: boolean;
  /** true while async resolver is loading (only for nodes with resolve). */
  readonly loading: boolean;
  /** true если хотя бы одно поле в группе отличается от initial. */
  readonly dirty: boolean;
  /**
   * true после первого неудачного submit — ошибки показываются в реальном времени.
   * false до первого submit — ошибки скрыты.
   */
  readonly revalidate: boolean;
  /** Submit pipeline: submitting → beforeSubmit → validate → onSubmit → afterSubmit. */
  submit(): Promise<SubmitResult>;
  /** Reset поддерево к defaults из конфига (или к переданным значениям). */
  reset(values?: Record<string, unknown>): void;
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

  /**
   * Регистрирует функцию перевода (next-intl, i18next, …) для резолва
   * label / placeholder / description.
   *
   * При смене транслятора — все подписанные компоненты перерендерятся
   * с актуальными переводами.
   *
   * @param t — функция перевода или null для сброса
   */
  setTranslator: (t: TranslateFn | null) => void;

  /**
   * Возвращает текущую зарегистрированную функцию перевода (или null).
   */
  getTranslator: () => TranslateFn | null;

  /**
   * Менеджер персистенции — гидратация и автосохранение состояния формы.
   *
   * @example
   * ```ts
   * // Активировать персистенцию (гидратация + auto-save)
   * await store.persist.enable({
   *   key: "payment-form-123",
   *   driver: localStorageDriver,
   *   debounce: 300,
   * });
   *
   * // Принудительно сохранить
   * await store.persist.flush();
   *
   * // Очистить storage
   * await store.persist.clear();
   *
   * // Отключить
   * store.persist.disable();
   * ```
   */
  persist: PersistManager;

  /**
   * Регистрирует функцию уведомления (toast, alert, …) для resolver onError.
   * Аналог setTranslator.
   *
   * @param fn — функция уведомления или null для сброса
   */
  setNotifier: (fn: NotifyFn | null) => void;

  /**
   * Возвращает текущую зарегистрированную функцию уведомления (или null).
   */
  getNotifier: () => NotifyFn | null;

  /**
   * Submit root form.
   * Lifecycle: submitting → beforeSubmit → validate → onSubmit → afterSubmit.
   */
  submit(): Promise<import("./submitPipeline").SubmitResult>;

  /**
   * Reset root form к defaults из конфига (или к переданным значениям).
   */
  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void;
}

// ─── Фабрика ─────────────────────────────────────────────────────────────────

/**
 * Инициализирует submitting: false, dirty: false, revalidate: false
 * в nodeState для корневого и всех вложенных групповых узлов.
 */
function initGroupSubmitting(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
) {
  // Для текущего узла (группового) — инициализируем management flags
  const existing = nodeState.get(node);
  if (existing) {
    const updated = { ...existing };
    if (updated.submitting === undefined) updated.submitting = false;
    if (updated.dirty === undefined) updated.dirty = false;
    if (updated.revalidate === undefined) updated.revalidate = false;
    nodeState.set(node, updated);
  } else {
    nodeState.set(node, {
      value: undefined,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      submitting: false,
      dirty: false,
      revalidate: false,
    });
  }

  // Рекурсия в дочерние группы
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    // Только группы (без value)
    if (!("value" in child)) {
      initGroupSubmitting(child, nodeState);
    }
  }
}

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
  const leafNodes: Array<{ node: AnyConfigNode; path: string }> = [];

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

  /** Зарегистрированная функция перевода (label, placeholder, description). */
  let translator: TranslateFn | null = null;

  /** Зарегистрированная функция уведомления (toast, alert — для resolver onError). */
  let notifier: NotifyFn | null = null;

  /**
   * Initial values for dirty tracking.
   * Captured after init and reset/hydrate.
   */
  const initialValueMap = new WeakMap<object, unknown>();

  // ─── Инициализация ─────────────────────────────────────────────────────────

  function recomputeAll(): Set<object> {
    return _recomputeAll(rootConfig, leafNodes, nodeState);
  }

  // Выполняем инициализацию
  registerNodes(rootConfig, initialValues, leafNodes, nodeState);

  // Инициализируем submitting/dirty/revalidate для корневого и вложенных групп
  initGroupSubmitting(rootConfig, nodeState);

  recomputeAll(); // вычисляем isVisible, isRequired, error и т.д.

  // Capture initial values for dirty tracking (after recompute to get computed values)
  captureInitialValues(rootConfig, nodeState, initialValueMap);

  // ─── Resolve system ────────────────────────────────────────────────────────

  /** Resolve states for all nodes with resolve config. */
  const resolveStates = new Map<object, ResolveState>();

  /** All resolve entries (node + resolve config). */
  const resolveEntries = initResolveStates(rootConfig, resolveStates);

  // ─── Уведомление подписчиков ───────────────────────────────────────────────

  function notify(node: object) {
    nodeListeners.get(node)?.forEach((fn) => fn());
  }

  function notifyChanged(changed: Set<object>) {
    if (changed.size === 0) return;

    // Recompute dirty flags for all nodes (leaf + group)
    const dirtyResult = recomputeDirty(rootConfig, nodeState, initialValueMap);
    for (const n of dirtyResult.changed) changed.add(n);

    // Update root node dirty flag
    const rootState = nodeState.get(rootConfig);
    if (rootState && rootState.dirty !== dirtyResult.anyDirty) {
      nodeState.set(rootConfig, { ...rootState, dirty: dirtyResult.anyDirty });
      changed.add(rootConfig);
    }

    // Инкрементируем глобальную версию
    version++;

    // Обновляем версии изменённых узлов + уведомляем per-node подписчиков
    for (const node of changed) {
      nodeVersions.set(node, version);
      notify(node);
    }

    // Уведомляем глобальных подписчиков
    globalListeners.forEach((fn) => fn());

    // ── Auto-deps: retrigger resolves whose dependencies changed ──────────
    if (resolveEntries.length > 0) {
      // Collect paths of changed nodes
      const changedPaths = new Set<string>();
      for (const n of changed) {
        const p = nodePaths.get(n);
        if (p) changedPaths.add(p);
      }

      if (changedPaths.size > 0) {
        const toRetrigger = findResolvesToRetrigger(changedPaths, resolveStates, resolveEntries);
        for (const entry of toRetrigger) {
          resetResolveState(entry.node, resolveStates);
          // Re-trigger: if the node was already accessed (resolved/error),
          // re-run immediately (fire-and-forget)
          triggerResolve(entry.node);
        }
      }
    }
  }

  // ─── Translator ─────────────────────────────────────────────────────────────

  function setTranslator(t: TranslateFn | null) {
    if (translator === t) return;
    translator = t;

    // Bump global + all leaf node versions → subscribed components re-render
    version++;
    for (const { node } of leafNodes) {
      nodeVersions.set(node, version);
    }
    globalListeners.forEach((fn) => fn());
  }

  // ─── Notifier ───────────────────────────────────────────────────────────────

  function setNotifier(fn: NotifyFn | null) {
    notifier = fn;
  }

  function getNotifier(): NotifyFn | null {
    return notifier;
  }

  // ─── Resolve helpers ────────────────────────────────────────────────────────

  const resolveDeps: ResolveDeps = {
    rootConfig,
    nodeState,
    resolveStates,
    recomputeAll,
    notifyChanged,
    getNotifier,
    getValues: () => collectValues(rootConfig, nodeState) as Record<string, unknown>,
  };

  function triggerResolve(node: AnyConfigNode) {
    const entry = resolveEntries.find((e: { node: AnyConfigNode; resolve: Resolve }) => e.node === node);
    if (!entry) return;
    executeResolve(node, entry.resolve, resolveDeps);
  }

  function getResolveState(node: AnyConfigNode): ResolveState | undefined {
    return resolveStates.get(node);
  }

  // ─── Handlers (submit, reset, onChange) ──────────────────────────────────

  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(rootConfig, nodePaths, nodeParents);

  const resetDeps: ResetDeps = { nodeState, recomputeAll, notifyChanged, initialValueMap };
  const resetNode = (node: AnyConfigNode, values?: Record<string, unknown>) => {
    executeReset(node, resetDeps, values);
  };

  const submitDeps: SubmitDeps = {
    nodeState,
    recomputeAll,
    notifyChanged,
    resetNode,
  };
  const submitNode = (node: AnyConfigNode) => executeSubmit(node, submitDeps);

  const onChangeDeps: OnChangeDeps = {
    rootConfig,
    nodeState,
    nodePaths,
    nodeParents,
    recomputeAll,
    notifyChanged,
  };
  const onFieldChange = (
    node: AnyConfigNode,
    newValue: unknown,
    previousValue: unknown,
  ) => {
    fireOnChange(node, newValue, previousValue, onChangeDeps);
  };

  // ─── Построение Proxy ──────────────────────────────────────────────────────
  const buildProxy = createBuildProxy({
    proxyCache,
    nodeState,
    rootConfig,
    recomputeAll,
    notifyChanged,
    getTranslator: () => translator,
    submitNode,
    resetNode,
    onFieldChange,
    triggerResolve,
    getResolveState,
  });

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

  // ─── Persist ────────────────────────────────────────────────────────────────

  const getValues = () => collectValues(rootConfig, nodeState, true) as ExtractValues<TConfig>;

  const persistManager = createPersistManager({
    rootConfig,
    nodeState,
    recomputeAll,
    notifyChanged,
    getValues: getValues as () => Record<string, unknown>,
    subscribeGlobal,
  });

  // ─── Публичный API ─────────────────────────────────────────────────────────

  // ─── Launch eager resolvers (lazy: false) ──────────────────────────────────
  for (const entry of resolveEntries) {
    const lazy = entry.resolve.options?.lazy ?? true;
    if (!lazy) {
      triggerResolve(entry.node);
    }
  }

  return {
    proxy: buildProxy(rootConfig) as ConfigProxy<TConfig>,
    subscribe,
    subscribeGlobal,
    getVersion: () => version,
    getNodeVersion: (node: object) => nodeVersions.get(node) ?? 0,
    getValues,
    setTranslator,
    getTranslator: () => translator,
    setNotifier,
    getNotifier,
    persist: persistManager,
    submit: () => submitNode(rootConfig),
    reset: (values?: DeepPartialValues<ExtractValues<TConfig>>) =>
      resetNode(rootConfig, values as Record<string, unknown> | undefined),
  };
}

