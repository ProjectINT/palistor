import {
  CONFIG_PROPS,
  FLOW_SPREAD_KEYS,
  FLOW_STEPS_PROP,
  GROUP_SPREAD_KEYS,
} from "../constants";
import type { ExtractValues, ProxyStore } from "../store/types";

// ─── Типы шага ────────────────────────────────────────────────────────────────

/**
 * Статус шага флоу — вычисляемое свойство step-proxy, производное от
 * навигационного состояния (currentStepKey + visited set). Не является
 * leaf-нодой: не попадает в values, submit-payload и persisted-значения.
 *
 * - `null`        — шаг ещё не посещался
 * - `"active"`    — текущий шаг
 * - `"completed"` — был активен, затем ушли (вперёд или назад)
 */
export type StepStatus = "active" | "completed" | null;

/** Ошибка валидации флоу — та же форма, что в SubmitResult. */
export interface FlowError {
  path: string;
  message: string;
}

/**
 * Результат defineStep: группа-конфиг шага + его ключ во флоу.
 * defineFlow разворачивает шаги в обычные дочерние группы flow-ноды.
 */
export interface FlowStep<
  K extends string = string,
  C extends Record<string, any> = Record<string, any>,
> {
  readonly key: K;
  readonly config: C;
}

export type AnyFlowStep = FlowStep<string, Record<string, any>>;

/** Значения флоу — все шаги по ключам (аккумулированное состояние). */
export type FlowValues<S extends readonly AnyFlowStep[]> = {
  [Step in S[number] as Step["key"]]: ExtractValues<Step["config"]>;
};

// ─── FlowNode (бренд) ─────────────────────────────────────────────────────────

declare const __flowBrand: unique symbol;

/**
 * Узел флоу в дереве конфига: обычная группа (шаги — дочерние группы по ключам),
 * помеченная брендом с кортежем шагов для вывода типов proxy.
 */
export type FlowNode<S extends readonly AnyFlowStep[]> = {
  readonly [__flowBrand]: S;
} & {
  [Step in S[number] as Step["key"]]: Step["config"];
};

/** Извлечь кортеж шагов из FlowNode (never — если узел не флоу). */
export type InferFlowSteps<T> = T extends { readonly [__flowBrand]: infer S extends readonly AnyFlowStep[] }
  ? S
  : never;

// ─── defineStep ───────────────────────────────────────────────────────────────

/**
 * Имя `status` зарезервировано на step-proxy под вычисляемый статус шага —
 * поле с таким именем в конфиге шага запрещено (по аналогии с dirty/loading).
 */
const RESERVED_STEP_CONFIG_KEYS = new Set(["status"]);

/**
 * Обернуть конфиг группы в шаг флоу.
 *
 * Конфиг шага — обычная group-нода Palistor (поля, isVisible, validate,
 * resolve, onSubmit, …) плюс flow-lifecycle колбэки `onEnter` / `onReady`.
 *
 * @example
 * defineStep("welcome", {
 *   name: { value: "", isRequired: true },
 *   onSubmit: async (values, store, { nextStep }) => { nextStep(); },
 * })
 */
export function defineStep<const K extends string, const C extends Record<string, any>>(
  key: K,
  config: C & { status?: never },
): FlowStep<K, C> {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("[palistor] defineStep: key must be a non-empty string.");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`[palistor] defineStep("${key}"): config must be a plain object (group node).`);
  }
  if ("value" in config) {
    throw new Error(
      `[palistor] defineStep("${key}"): step config must be a group node — a "value" key makes it a leaf.`,
    );
  }
  for (const reserved of RESERVED_STEP_CONFIG_KEYS) {
    if (reserved in config) {
      throw new Error(
        `[palistor] defineStep("${key}"): "${reserved}" is reserved — the flow exposes it as a computed step property.`,
      );
    }
  }
  return { key, config: config as C };
}

// ─── defineFlow ───────────────────────────────────────────────────────────────

/**
 * Ключи шагов, конфликтующие со свойствами flow-proxy / steps-proxy /
 * служебными ключами конфига — запрещены как имена шагов.
 */
const RESERVED_STEP_KEYS = new Set<string>([
  ...CONFIG_PROPS,
  ...GROUP_SPREAD_KEYS,
  ...FLOW_SPREAD_KEYS,
  "setValues",
  "current",
  "length",
]);

export interface DefineFlowOptions<S extends readonly AnyFlowStep[]> {
  /** Упорядоченный массив шагов (defineStep). Порядок определяет nextStep(). */
  steps: S;
  /** Flow-level submit: вызывается стандартным submit-пайплайном над всеми шагами. */
  onSubmit?: (
    values: FlowValues<S>,
    store: ProxyStore<any>,
    parent?: any,
  ) => Promise<unknown> | unknown;
  /** Group-level трансформация значений перед submit. */
  beforeSubmit?: (values: FlowValues<S>) => FlowValues<S> | Promise<FlowValues<S>>;
  /** Пост-обработка после успешного onSubmit. */
  afterSubmit?: (result: unknown, actions: { reset: () => void }) => void | Promise<void>;
}

/**
 * Собрать flow-ноду из упорядоченного массива шагов.
 *
 * Возвращаемый узел — обычная группа в дереве конфига (шаги — дочерние группы
 * по своим ключам), помеченная маркером {@link FLOW_STEPS_PROP} с порядком
 * шагов. Участвует в values / persist / dirty как любая группа; NodeRegistry
 * по маркеру создаёт FlowState (навигация, статусы, история).
 *
 * @example
 * const onboarding = defineFlow({
 *   steps: [
 *     defineStep("welcome", { name: { value: "", isRequired: true } }),
 *     defineStep("summary", {}),
 *   ],
 *   onSubmit: async (allValues, store) => api.completeOnboarding(allValues),
 * });
 */
export function defineFlow<const S extends readonly AnyFlowStep[]>(
  options: DefineFlowOptions<S>,
): FlowNode<S> {
  const { steps, onSubmit, beforeSubmit, afterSubmit } = options;

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("[palistor] defineFlow: `steps` must be a non-empty array of defineStep(...) results.");
  }

  const node: Record<string, unknown> = {};
  const stepKeys: string[] = [];

  for (const step of steps as readonly AnyFlowStep[]) {
    if (!step || typeof step !== "object" || typeof step.key !== "string" || !step.config) {
      throw new Error("[palistor] defineFlow: each entry of `steps` must be created via defineStep(key, config).");
    }
    if (RESERVED_STEP_KEYS.has(step.key)) {
      throw new Error(`[palistor] defineFlow: step key "${step.key}" is reserved by the flow/group proxy API.`);
    }
    if (stepKeys.includes(step.key)) {
      throw new Error(`[palistor] defineFlow: duplicate step key "${step.key}".`);
    }
    node[step.key] = step.config;
    stepKeys.push(step.key);
  }

  if (onSubmit) node.onSubmit = onSubmit;
  if (beforeSubmit) node.beforeSubmit = beforeSubmit;
  if (afterSubmit) node.afterSubmit = afterSubmit;

  // Маркер флоу: входит в CONFIG_PROPS → все обходы дерева его пропускают.
  node[FLOW_STEPS_PROP] = stepKeys;

  return node as unknown as FlowNode<S>;
}
