import { CONFIG_PROPS, FLOW_STEPS_PROP } from "../constants";
import { isGroupNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FlowError } from "./defineFlow";

/**
 * Навигационное состояние одного флоу — ЕДИНЫЙ кубик «флоу».
 *
 * Идентичность узла для tracking — сам объект `FlowState` (ключ в хабе, как
 * `ListState` у списков): навигация бампает его версию через notifyChanged.
 * Статусы шагов НЕ хранятся — выводятся из (currentIndex + visitedKeys).
 */
export interface FlowState {
  /** Сам конфиг-узел флоу — ключ в flowStates. */
  flowNode: AnyConfigNode;
  /** Абсолютный dot-путь flow-ноды (для persist-снимка и reset-скоупа). */
  path: string;
  /** Упорядоченные ключи шагов (копия FLOW_STEPS_PROP). */
  stepKeys: string[];
  /** Конфиг-ноды шагов в том же порядке. */
  stepNodes: AnyConfigNode[];
  /** Индекс активного шага. */
  currentIndex: number;
  /** Стек посещений — pop в back(). */
  visitStack: string[];
  /** Все когда-либо посещённые шаги (стек lossy — back() убирает записи). */
  visitedKeys: Set<string>;
  /** Ошибки последнего validate()/finalize — реактивные (flow.errors). */
  errors: FlowError[];
}

/** Минимальный интерфейс реестра для регистрации флоу (NodeRegistry). */
export interface FlowRegistrySlice {
  readonly flowStates: WeakMap<object, FlowState>;
  readonly allFlowStates: FlowState[];
  readonly stepToFlow: WeakMap<object, FlowState>;
  readonly nodePaths: WeakMap<object, string>;
}

/**
 * Обойти дерево конфига и создать FlowState для каждого узла с маркером
 * {@link FLOW_STEPS_PROP} (проставляется defineFlow). Вызывается из
 * конструктора NodeRegistry ПОСЛЕ buildNodeMaps — пути уже известны.
 */
export function collectFlowStates(root: AnyConfigNode, registry: FlowRegistrySlice): void {
  walk(root);

  function walk(node: AnyConfigNode): void {
    const marker = (node as Record<string, unknown>)[FLOW_STEPS_PROP];
    if (Array.isArray(marker)) {
      const stepKeys = marker as string[];
      const stepNodes: AnyConfigNode[] = [];
      for (const key of stepKeys) {
        const child = (node as Record<string, unknown>)[key];
        if (!child || typeof child !== "object" || Array.isArray(child) || "value" in child) {
          throw new Error(`[palistor] defineFlow: step "${key}" is not a group node in the flow config.`);
        }
        // Пустой шаг ({} — read-only summary) эвристика hasChildren в
        // registerNodes пометила бы как "leaf"; шаг по определению — группа.
        (child as Record<string, unknown>).__kind = "group";
        stepNodes.push(child as AnyConfigNode);
      }
      const flowState: FlowState = {
        flowNode: node,
        path: registry.nodePaths.get(node as object) ?? "",
        stepKeys: [...stepKeys],
        stepNodes,
        currentIndex: 0,
        visitStack: [],
        visitedKeys: new Set([stepKeys[0]]),
        errors: [],
      };
      registry.flowStates.set(node as object, flowState);
      registry.allFlowStates.push(flowState);
      for (const stepNode of stepNodes) registry.stepToFlow.set(stepNode as object, flowState);
    }

    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = (node as Record<string, unknown>)[key];
      if (!child || typeof child !== "object" || Array.isArray(child)) continue;
      if (isGroupNode(child as object)) walk(child as AnyConfigNode);
    }
  }
}
