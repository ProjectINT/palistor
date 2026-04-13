import type { PersistManager } from "../persist/persistManager";

/**
 * Внутренний тип для рекурсивного обхода дерева конфига.
 * Используется в registerNodes, buildProxy, applyPatch, recomputeAll и др.
 */
export interface AnyConfigNode {
  [key: string]: AnyConfigNode | unknown;
}

/**
 * Функция перевода (next-intl, i18next, …).
 * label/placeholder/description в конфиге могут быть функцией от TranslateFn.
 * Принимает любое количество аргументов — совместима с next-intl `t`, i18next `t` и др.
 */
export type TranslateFn = (...args: any[]) => string;

/**
 * Тип конфигурации формы: объект, где каждый ключ — узел конфига с типами TValues.
 */
export type FormConfig<TValues = Record<string, unknown>> = Record<string, ConfigNode<any, TValues>>;
import type { NotifyFn, Resolve } from "../resolvePipeline";
import type { SubmitResult } from "../submitPipeline/submitPipeline";

// ─── Утилитарные типы ────────────────────────────────────────────────────────

/** Функция отписки от подписки. */
export type Unsubscribe = () => void;

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
 * Используется для label / placeholder / description, которые могут быть:
 *   - статической строкой
 *   - `(t: TranslateFn, values: TValues) => string` — перевод + вычисление
 */
export type MaybeTranslatable<TResult, TValues = Record<string, unknown>> =
  | TResult
  | ((t: TranslateFn, values: TValues) => TResult);

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

// ─── Типы конфига ────────────────────────────────────────────────────────────

/**
 * Метаданные типа поля (для будущей валидации по типам / кодогенерации).
 */
export interface FieldTypeMeta {
  readonly dataType: "String" | "Number" | "Boolean" | "Date" | "Array" | "Object";
  readonly type: string;
}

export type { Setter } from "../writePipeline/writePipeline";

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
  label?: MaybeTranslatable<string, TValues>;
  placeholder?: MaybeTranslatable<string, TValues>;
  description?: MaybeTranslatable<string, TValues>;
  /**
   * Возвращает строку с ошибкой или falsy-значение если поле валидно.
   * `false` допускается для удобства паттерна `!v && "required"`.
   */
  validate?: (value: TValue, values: TValues, t: TranslateFn) => string | undefined | false;
  /** Преобразует входное значение перед сохранением (например, обрезает пробелы) */
  formatter?: (value: string | boolean, values: TValues) => string | number | boolean;
  /** Сайд-эффект записи: возвращает патч других полей */
  setter?: (value: TValue, values: TValues, previousValue: TValue | undefined) => DeepPartialValues<TValues>;
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
  onSubmit?: (thisForm: TValues, store: ProxyStore<any>) => Promise<unknown> | unknown;
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
  /**
   * Per-entity field resolver (only valid inside a list template).
   * resolver receives the entity's current values and returns the new field value.
   * Triggered automatically after the list resolver completes, or lazily on first
   * access to field.value / field.loading.
   */
  resolve?: Resolve<TValue>;
}

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
  | "isInvalid"
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
  readonly isInvalid: boolean | undefined;
  readonly errorMessage: string | undefined;
  /** true если текущее значение отличается от initial */
  readonly dirty: boolean;
  /* 
    Можно использовать функцию, а можно явно писать (s = v), функция
    предполагается как дефолтный способ, прямая запись как способ для
    особенных случаев.
  */
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
  readonly isInvalid: boolean | undefined;
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
  /** Текущие значения всех листовых полей поддерева в виде вложенного объекта. Живая ссылка (не клон). */
  readonly values: Record<string, unknown>;
  /** Submit pipeline: submitting → beforeSubmit → validate → onSubmit → afterSubmit. */
  submit(): Promise<SubmitResult>;
  /** Reset поддерево к defaults из конфига (или к переданным значениям). */
  reset(values?: Record<string, unknown>): void;
  /**
   * Bulk-обновление значений: применяет патч к поддереву за один recompute + notify.
   * Без setters (чтобы избежать рекурсии) и без форматтеров.
   * Используется для подлива серверных данных или bulk-изменений из React.
   */
  setValues(patch: Record<string, unknown>): void;
}

// ─── Типы списков ────────────────────────────────────────────────────────────

/**
 * Конфигурация resolver-а для ListNode (аналог Resolve для группы, но возвращает
 * массив entity-данных). Минимальный интерфейс без импорта Resolve из resolvePipeline
 * (избегает циклических зависимостей).
 */
export interface ListResolveConfig {
  /** Async data loader — returns array of entity records. */
  resolver: (values: any, store: ProxyStore<any>) => Promise<Array<Record<string, unknown>>>;
  /**
   * Error handler called when resolver throws.
   * ctx.notify — notification function from useNotifier.
   */
  onError?: (error: unknown, ctx: { notify: (...args: any[]) => void }) => void;
  /** Explicit dependency paths — re-trigger resolver when these paths change. */
  deps?: string[];
  options?: {
    /** Wait for first access to the list. Default: true */
    lazy?: boolean;
    /** Throw Promise for React Suspense. Default: false */
    suspense?: boolean;
  };
}

/**
 * Конфигурация уровня списка (второй элемент ListNode-массива).
 * Resolver и прочие опции уровня списка добавляются здесь.
 */
export interface ListConfig {
  resolve?: ListResolveConfig;
}

/**
 * Внутреннее состояние списка. Хранится в NodeRegistry.listStates,
 * ключ — объект-массив конфига (сам ListNode).
 */
export interface ListState {
  /** Шаблон элемента — describes поля для отображения. array[0]. */
  template: object;
  /** Конфигурация списка (resolve и т.д.). array[1] — опционально. */
  listConfig?: ListConfig;
  /** ID сущностей, входящих в список (в порядке отображения). */
  itemIds: string[];
  /** Инкрементируется при add/remove/setItems/resolve — для tracking. */
  version: number;
  /** Сохраняется при init/resolve — для dirty-tracking по составу. */
  initialItemIds: string[];
}

/**
 * Прокси-интерфейс для списка (ListNode в конфиге).
 * TItem — тип одного элемента (EntityProjectionProxy в Phase 2B).
 */
export interface ListProxyNode<TItem> {
  readonly items: ReadonlyArray<TItem>;
  readonly length: number;
  readonly loading: boolean;
  /** true если состав списка изменился с момента init/последнего resolve. */
  readonly dirty: boolean;
  add(id: string): void;
  add(values: Record<string, unknown>): TItem;
  remove(id: string): void;
  getById(id: string): TItem | undefined;
  setItems(ids: string[]): void;
  map<R>(fn: (item: TItem, index: number, id: string) => R): R[];
  [Symbol.iterator](): Iterator<TItem>;
}

// ─── Typed References ────────────────────────────────────────────────────────

declare const __palistorRefBrand: unique symbol;
declare const __typedListBrand: unique symbol;

/** Opaque-ссылка на entity proxy. Передаётся как prop, разворачивается через useForm(). */
export type PalistorRef<T extends Record<string, any>> = {
  readonly [__palistorRefBrand]: T;
} & object;

/** Типизированный список entity. */
export type PalistorList<T extends Record<string, any>> = ListProxyNode<PalistorRef<T>>;

/** Маркерный тип для typed list node в конфиге. */
export type TypedListNode<TEntity extends Record<string, any>> =
  readonly [any, any?] & { readonly [__typedListBrand]: TEntity };

/** Typed resolver для списка. */
export type ListResolver<TEntity extends Record<string, any>> =
  (values: any, store: ProxyStore<any>) => Promise<TEntity[]>;

/** Typed template: каждый ключ Entity → ConfigNode с нужным типом value. */
export type TemplateConfig<TEntity extends Record<string, any>> = {
  [K in keyof TEntity]: ConfigNode<TEntity[K], TEntity>;
};

/** Извлечь entity type из PalistorRef. */
export type InferEntity<T> = T extends PalistorRef<infer E> ? E : never;

/**
 * Рекурсивно конвертирует узел конфига в его прокси-тип:
 * - TypedListNode (defineList<TEntity>)         → `ListProxyNode<PalistorRef<TEntity>>`
 * - ListNode (массив `[template, listConfig?]`) → `ListProxyNode<...>`
 * - Листовой узел (есть `value`)               → `FieldProxyNode<TValue>`
 * - Групповой узел                             → `GroupProxyNode & { дочерние поля… }`
 */
type ConfigNodeToProxy<T> =
  T extends { readonly [__typedListBrand]: infer TEntity extends Record<string, any> }
    ? ListProxyNode<PalistorRef<TEntity>>
    : T extends readonly [infer Item, ...any[]]
      ? ListProxyNode<ConfigNodeToProxy<Item>>
      : T extends { value: any }
        ? FieldProxyNode<ExtractNodeValue<T>>
        : T extends Record<string, any>
          ? GroupProxyNode & {
              [K in keyof T as K extends ConfigSkipKeys ? never : K]: ConfigNodeToProxy<T[K]>;
            }
          : never;

/**
 * Полный прокси для конфига формы: каждый ключ маппируется в прокси-узел.
 * Корневой прокси также включает GroupProxyNode (submit, reset, setValues, dirty, …).
 */
export type ConfigProxy<TConfig extends Record<string, any>> = GroupProxyNode & {
  [K in keyof TConfig]: ConfigNodeToProxy<TConfig[K]>;
};

/**
 * Маппит интерфейс значений формы на прокси-типы.
 * В отличие от ConfigProxy (работает с конфиг-нодами), Palistor
 * принимает простой интерфейс значений — удобно для типизации пропсов
 * дочерних компонентов, получающих поддерево из useForm.
 *
 * **Важно:** из пакета этот тип экспортируется под именем `PalistorProxy`,
 * так как имя `Palistor` занято одноимённым классом.
 * Используйте `import type { PalistorProxy } from "@projectint/palistor"`.
 *
 * @example
 * ```ts
 * import type { PalistorProxy } from "@projectint/palistor";
 *
 * interface CompanyFormData {
 *   name: string;
 *   email: string;
 *   bank: { name: string; number: string };
 * }
 * type Props = { company: PalistorProxy<CompanyFormData> };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Palistor<T extends Record<string, any> = {}> = GroupProxyNode & {
  [K in keyof T]: T[K] extends Array<infer Item>
    ? Item extends Record<string, any>
      ? ListProxyNode<Palistor<Item>>
      : ListProxyNode<FieldProxyNode<Item>>
    : T[K] extends Record<string, any>
      ? Palistor<T[K]>
      : FieldProxyNode<T[K]>;
};

/**
 * Рекурсивно извлекает типы значений из конфига формы.
 * Листовые узлы (содержащие `value`) → тип значения.
 * Групповые узлы → вложенный объект с теми же правилами.
 * Служебные ключи (validate, formatter, …) — пропускаются.
 */
export type ExtractValues<T> = {
  [K in keyof T as K extends ConfigSkipKeys ? never : K]: T[K] extends readonly [infer Item, ...any[]]
    ? Array<ExtractValues<Item>>
    : T[K] extends { value: any }
      ? ExtractNodeValue<T[K]>
      : T[K] extends Record<string, any>
        ? ExtractValues<T[K]>
        : never;
};

// ─── Интерфейсы Store ────────────────────────────────────────────────────────

export interface ProxyStoreOptions<TConfig extends Record<string, any>> {
  /** Декларативное описание структуры и полей формы. Остаётся неизменяемым. */
  config: TConfig;
  /**
   * Стартовые значения, которые перекрывают значения по умолчанию из конфига.
   * Структура совпадает со структурой конфига, но все поля опциональны.
   */
  initialValues?: DeepPartialValues<ExtractValues<TConfig>>;
  /**
   * Начальный контекст. Если передан, eager resolvers увидят его при первом запуске.
   * Аналогично вызову `setContext()` до `launchEager()`.
   */
  context?: Record<string, unknown>;
}

export interface ProxyStore<TConfig extends Record<string, any>> {
  /**
   * Реактивный прокси. Повторяет структуру конфига.
   * GET .value / .isVisible / … → из вычисленного FieldState
   * SET .value = X → formatter → validate → recompute → notify
   */
  proxy: ConfigProxy<TConfig>;

  /**
   * Нереактивный контекст — произвольные данные, доступные во всех callback-ах
   * (resolve.resolver, onSubmit, onChange, …) через `store.context`.
   *
   * Устанавливается через `setContext()` или хук `useStoreContext()`.
   * Не является частью формы — не попадает в getValues(), submit, persist.
   *
   * @example
   * store.context.accountId; // read
   */
  readonly context: Record<string, unknown>;

  /**
   * Установить нереактивный контекст. Заменяет текущий context целиком.
   * Вызывается из React (useStoreContext) или императивно.
   *
   * @example
   * store.setContext({ accountId: "abc", tenant: "acme" });
   */
  setContext(ctx: Record<string, unknown>): void;

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
   * Менеджер персистенции — гидратация и автосохранение состояния формы.
   */
  persist: PersistManager;

  /**
   * Регистрирует функцию уведомления (toast, alert, …) для resolver onError.
   *
   * @param fn — функция уведомления или null для сброса
   */
  setNotifier: (fn: NotifyFn | null) => void;

  /**
   * Submit root form.
   * Lifecycle: submitting → beforeSubmit → validate → onSubmit → afterSubmit.
   */
  submit(): Promise<SubmitResult>;

  /**
   * Reset root form к defaults из конфига (или к переданным значениям).
   */
  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void;
  /**
   * Bulk-обновление значений: применяет патч ко всему store за один recompute + notify.
   * Без setters (чтобы избежать рекурсии) и без форматтеров.
   * Используется для подлива серверных данных или bulk-изменений из React.
   */
  setValues(patch: DeepPartialValues<ExtractValues<TConfig>>): void;

  /**
   * Создать или обновить entity (или массив entities) в реестре.
   * - Если entity с таким id не существует — создаётся, leaf-ноды регистрируются.
   * - Если существует — рекурсивный merge; изменённые leaf-ноды уведомляются.
   * - Batch-режим: массив обрабатывается одним recompute + notifyChanged.
   */
  set(data: import("../entityRegistry").EntityData | import("../entityRegistry").EntityData[]): void;

  /**
   * Удалить entity из реестра по ID.
   * Очищает leaf-ноды, bindings и resolvedCache. Уведомляет подписчиков.
   * No-op если entity не существует.
   */
  delete(id: string): void;
}
