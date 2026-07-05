/**
 * Symbol for accessing the original config node through a Proxy.
 * Used by tracking proxies to identify which node is being read.
 */
export const CONFIG_NODE: unique symbol = Symbol("configNode");

/**
 * Symbol for extracting the source proxy (store.proxy) from a tracking proxy.
 * Lets useForm accept a tracking-proxy subtree and unwrap the source.
 */
export const SOURCE_PROXY: unique symbol = Symbol("sourceProxy");

/**
 * Symbol for extracting the owning ProxyStore from a tracking proxy.
 * Lets useForm accept a tracking-proxy subtree and subscribe to the store.
 */
export const STORE_REF: unique symbol = Symbol("storeRef");

/**
 * Symbol for extracting the entity ID from an EntityProjectionProxy.
 * Lets useForm(entity, templateSelector) recover entityId and store from the proxy.
 */
export const ENTITY_ID: unique symbol = Symbol("entityId");

/**
 * Symbol for extracting the id leaf object (EntityLeafNode) from an
 * EntityProjectionProxy. Tracking proxies register a subscription on it so
 * rekey() correctly re-renders components that read `entity.id`.
 */
export const ENTITY_ID_LEAF: unique symbol = Symbol("entityIdLeaf");

/**
 * Brand symbol of a list proxy — returns the `ListState` object (the single
 * "list" building block). Node identity for tracking/resolve is the `ListState`
 * object itself (hub key). Root lists have `ownerEntity === null`; per-entity
 * lists get an isolated `ListState` per (owner, listConfigNode) pair.
 */
export const LIST_STATE: unique symbol = Symbol("listState");

/**
 * Brand symbol of a flow proxy — returns the `FlowState` object (flow
 * navigation state). Exposed by three proxies: the flow node, the steps proxy,
 * and each step node (the latter return the owning flow's FlowState).
 * Tracking identity: the `FlowState` object itself (hub key) — navigation
 * bumps its version.
 */
export const FLOW_STATE: unique symbol = Symbol("flowState");

/**
 * Marker key on a flow node: the ordered array of step keys.
 * Set by defineFlow; included in CONFIG_PROPS so all tree walks
 * (traversal, registerNodes, buildValuesCache, …) skip it.
 */
export const FLOW_STEPS_PROP = "__flowSteps";

/**
 * Single source of truth for field-state property names (canonical tuple).
 * {@link FIELD_STATE_PROPS} (Set) and {@link MAPPABLE_KEYS} derive from it.
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
 * Field-state properties. When one of these is read, the proxy returns the
 * computed value from FieldState rather than the raw config.
 */
export const FIELD_STATE_PROPS = new Set<string>(FIELD_STATE_KEYS);

/**
 * Keys renamable via `fieldMapping`: field-state keys plus the
 * functional setter `onValueChange`.
 */
export const MAPPABLE_KEYS = [...FIELD_STATE_KEYS, "onValueChange"] as const;

/** Internal key name allowed as a rename source in `fieldMapping`. */
export type MappableKey = (typeof MAPPABLE_KEYS)[number];

/**
 * Subset of mappable keys that are INPUT config keys — i.e. keys an author
 * writes in a node config. Only these are normalized external→internal when
 * `fieldMapping` is active (see {@link normalizeConfig}).
 *
 * The remaining mappable keys (`isInvalid`, `errorMessage`, `dirty`,
 * `loading`, `onValueChange`) are computed/output-only: they never appear in
 * a config, so there is nothing to normalize on input (they are translated
 * only on proxy output). Writing such a key in a config is an error (strict).
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

/** Type-level version of {@link MAPPABLE_CONFIG_KEYS} — internal config key
 *  names renamable via `fieldMapping` (used by the type validator). */
export type MappableConfigKey = (typeof MAPPABLE_CONFIG_KEYS_TUPLE)[number];

/**
 * Full set of "service" keys of a config node.
 * Tree walks (init, buildValuesCache) skip them.
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
 * Static keys included when spreading a group node: state (submitting, dirty,
 * revalidate, loading) and methods (submit, reset).
 * Child node keys are added dynamically in computeProxyKeys.
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
 * Extra spread keys for a flow node (defineFlow) — appended to
 * GROUP_SPREAD_KEYS in computeProxyKeys when the node carries FLOW_STEPS_PROP.
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
 * Static key set for a list proxy (ListNode).
 * Returned from computeProxyKeys instead of GROUP_SPREAD_KEYS when the node is an array.
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
