/**
 * Символ для доступа к исходному config-узлу из Proxy.
 * Используется tracking proxy для определения, какой узел читается.
 */
export const CONFIG_NODE: unique symbol = Symbol("configNode");

/**
 * Символ для получения исходного source-proxy (store.proxy) из tracking proxy.
 * Позволяет useForm принять tracking proxy поддерево и извлечь source.
 */
export const SOURCE_PROXY: unique symbol = Symbol("sourceProxy");

/**
 * Символ для получения ссылки на ProxyStore из tracking proxy.
 * Позволяет useForm принять tracking proxy поддерево и подписаться на store.
 */
export const STORE_REF: unique symbol = Symbol("storeRef");

/**
 * Символ для получения entity ID из EntityProjectionProxy.
 * Позволяет useForm(entity, templateSelector) извлечь entityId и store из proxy.
 */
export const ENTITY_ID: unique symbol = Symbol("entityId");

/**
 * Символ для получения объекта id-листа (EntityLeafNode) из EntityProjectionProxy.
 * Используется tracking proxy для регистрации подписки на id — чтобы rekey()
 * корректно триггерил перерендер компонентов, читающих `entity.id`.
 */
export const ENTITY_ID_LEAF: unique symbol = Symbol("entityIdLeaf");

/**
 * Бренд-символ list proxy — возвращает объект `ListState` (единый кубик «список»).
 * Идентичность узла для tracking/resolve: сам объект `ListState` (ключ в хабе).
 * Root-list — `ownerEntity === null`; per-entity — изолированный `ListState` на
 * каждую пару (owner, listConfigNode).
 */
export const LIST_STATE: unique symbol = Symbol("listState");

/**
 * Бренд-символ flow proxy — возвращает объект `FlowState` (навигационное
 * состояние флоу). Экспонируется тремя прокси: flow-нодой, steps-прокси и
 * каждой step-нодой (для последних возвращается FlowState владеющего флоу).
 * Идентичность для tracking: сам объект `FlowState` (ключ в хабе) — навигация
 * бампает его версию.
 */
export const FLOW_STATE: unique symbol = Symbol("flowState");

/**
 * Имя маркер-ключа flow-ноды: упорядоченный массив ключей шагов.
 * Проставляется defineFlow; входит в CONFIG_PROPS, поэтому все обходы
 * дерева (traversal, registerNodes, buildValuesCache, …) его пропускают.
 */
export const FLOW_STEPS_PROP = "__flowSteps";

/**
 * Единственный источник имён полей состояния (canonical tuple).
 * Из него выводятся {@link FIELD_STATE_PROPS} (Set) и {@link MAPPABLE_KEYS}.
 */
export const FIELD_STATE_KEYS = [
  "value",
  "label",
  "placeholder",
  "description",
  "isRequired",
  "isReadOnly",
  "isDisabled",
  "isVisible",
  "isInvalid",
  "errorMessage",
  "dirty",
  "loading",
] as const;

/**
 * Свойства, относящиеся к состоянию поля. При обращении к ним прокси
 * возвращает значение из FieldState (вычисленное), а не из конфига.
 */
export const FIELD_STATE_PROPS = new Set<string>(FIELD_STATE_KEYS);

/**
 * Ключи, которые можно переименовывать через `fieldMapping`:
 * поля состояния + функциональный сеттер `onValueChange`.
 */
export const MAPPABLE_KEYS = [...FIELD_STATE_KEYS, "onValueChange"] as const;

/** Имя internal-ключа, допустимое как источник переименования в `fieldMapping`. */
export type MappableKey = (typeof MAPPABLE_KEYS)[number];

/**
 * Подмножество mappable-ключей, которые являются ВХОДНЫМИ ключами конфига —
 * т.е. их пишет автор в конфиге узла. Только эти ключи нормализуются
 * external→internal при активном `fieldMapping` (см. {@link normalizeConfig}).
 *
 * Остальные mappable-ключи (`isInvalid`, `errorMessage`, `dirty`, `loading`,
 * `onValueChange`) — вычисляемые/выходные: в конфиге не пишутся, поэтому на
 * входе их нормализовать нечего (перевод для них происходит только на выходе
 * proxy). Попытка написать такой ключ в конфиге — ошибка (strict).
 */
export const MAPPABLE_CONFIG_KEYS_TUPLE = [
  "value",
  "label",
  "placeholder",
  "description",
  "isRequired",
  "isReadOnly",
  "isDisabled",
  "isVisible",
] as const;

export const MAPPABLE_CONFIG_KEYS = new Set<string>(MAPPABLE_CONFIG_KEYS_TUPLE);

/** Тип-версия {@link MAPPABLE_CONFIG_KEYS} — internal-имена config-ключей,
 *  которые можно переименовывать через `fieldMapping` (для валидатора типов). */
export type MappableConfigKey = (typeof MAPPABLE_CONFIG_KEYS_TUPLE)[number];

/**
 * Полный набор «служебных» ключей узла конфига.
 * При обходе дерева (init, buildValuesCache) — пропускаются.
 */
export const CONFIG_PROPS = new Set<string>([
  ...FIELD_STATE_PROPS,
  "validate",
  "formatter",
  "setter",
  "componentProps",
  "types",
  "dependencies",
  // Handler props (submit, reset, onChange lifecycle)
  "onSubmit",
  "beforeSubmit",
  "afterSubmit",
  "reset",
  "onChange",
  // Flow step lifecycle props (defineStep)
  "onEnter",
  "onReady",
  // Resolve props
  "resolve",
  "deps",
  // Node kind marker — set by registerNodes/entity factories, invisible to user code
  "__kind",
  // Flow marker — ordered step keys, set by defineFlow
  FLOW_STEPS_PROP,
]);

export const SPREADABLE_FIELD_STATE_PROPS = [
  ...FIELD_STATE_PROPS,
  "onValueChange",
].filter(k => ![
  "dirty",
  "loading",
].includes(k));

/**
 * Статический набор ключей, которые включаются при spread группового узла:
 * состояние (submitting, dirty, revalidate, loading) и методы (submit, reset).
 * Дочерние узлы добавляются динамически в computeProxyKeys.
 */
export const GROUP_SPREAD_KEYS: string[] = [
  "value",
  "submitting",
  "dirty",
  "revalidate",
  "loading",
  "values",
  "submit",
  "reset",
];

/**
 * Дополнительные ключи spread для flow-ноды (defineFlow) — добавляются
 * к GROUP_SPREAD_KEYS в computeProxyKeys, когда узел помечен FLOW_STEPS_PROP.
 */
export const FLOW_SPREAD_KEYS: string[] = [
  "currentStepKey",
  "currentStepIndex",
  "canGoBack",
  "history",
  "errors",
  "steps",
  "nextStep",
  "back",
  "goTo",
  "validate",
];

/**
 * Статический набор ключей для proxy списка (ListNode).
 * Возвращается из computeProxyKeys вместо GROUP_SPREAD_KEYS, когда узел — массив.
 */
export const LIST_SPREAD_KEYS: string[] = [
  "items",
  "length",
  "loading",
  "dirty",
  "add",
  "remove",
  "getById",
  "setItems",
  "map",
  "getValues",
];