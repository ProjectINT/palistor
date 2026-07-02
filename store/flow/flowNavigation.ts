import { computeFieldState } from "../compute";
import { walkFull } from "../traversal";
import { resetResolveState } from "../resolvePipeline";
import type { AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import type { SubmitResult } from "../submitPipeline/types";
import type { FlowError, StepStatus } from "./defineFlow";
import type { FlowState } from "./flowState";

type Kernel = Palistor<any, any>;

// ─── Derived state ────────────────────────────────────────────────────────────

/** Статус шага — производная от навигационного состояния (не хранится). */
export function getStepStatus(flowState: FlowState, stepNode: object): StepStatus {
  const idx = flowState.stepNodes.indexOf(stepNode as AnyConfigNode);
  if (idx === -1) return null;
  if (idx === flowState.currentIndex) return "active";
  return flowState.visitedKeys.has(flowState.stepKeys[idx]) ? "completed" : null;
}

/** Видимость шага — из вычисленного FieldState группы (isVisible реактивен). */
export function isStepVisible(kernel: Kernel, stepNode: object): boolean {
  return kernel.nodes.nodeState.get(stepNode)?.isVisible !== false;
}

/** Композитный loading флоу: true, если резолвится хотя бы один шаг. */
export function flowLoading(kernel: Kernel, flowState: FlowState): boolean {
  for (const stepNode of flowState.stepNodes) {
    if (kernel.nodes.nodeState.get(stepNode as object)?.loading === true) return true;
  }
  return false;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Собрать ошибки листьев поддерева шага. Валидация считается «вживую» через
 * computeFieldState(revalidate=true) — не зависит от флага revalidate группы
 * (тот выставляется только submit-пайплайном). Скрытые листья пропускаются.
 * Списки внутри шага пропускаются (паритет с collectLeafStates).
 *
 * `basePath` — префикс путей ошибок. Флоу передаёт КЛЮЧ шага: пути получаются
 * относительными flow-ноды ("welcome.name") — та же база, что у ошибок
 * submit-пайплайна при flow.submit() (collectLeafStates строит пути от
 * submitted-ноды).
 */
export function collectStepErrors(
  kernel: Kernel,
  stepNode: AnyConfigNode,
  basePath = "",
): FlowError[] {
  const errors: FlowError[] = [];
  const { nodeState } = kernel.nodes;
  const translate = kernel.services.translate;

  walkFull(stepNode, {
    onLeaf(leaf, _key, path) {
      const state = nodeState.get(leaf);
      if (!state || state.isVisible === false) return;
      const groupValues =
        kernel.values.nodeSlot.get(leaf)?.parent ?? kernel.values.values;
      const computed = computeFieldState(
        leaf as Record<string, any>,
        state.value,
        groupValues,
        true,
        translate,
      );
      if (computed.isInvalid && computed.errorMessage) {
        errors.push({ path, message: computed.errorMessage });
      }
    },
  }, basePath);

  return errors;
}

/** Live-агрегат валидности шага (flow.steps.x.isInvalid). */
export function stepIsInvalid(kernel: Kernel, stepNode: AnyConfigNode): boolean {
  return collectStepErrors(kernel, stepNode).length > 0;
}

/**
 * Ошибки флоу по посещённым видимым шагам (скоуп flow.validate()).
 * Скрытые шаги исключаются всегда — невзятая ветка не должна блокировать.
 * Пути ошибок относительны flow-ноды ("stepKey.field") — как у SubmitResult
 * при flow.submit().
 */
export function collectFlowErrors(kernel: Kernel, flowState: FlowState): FlowError[] {
  const errors: FlowError[] = [];
  for (let i = 0; i < flowState.stepNodes.length; i++) {
    const stepNode = flowState.stepNodes[i];
    if (!flowState.visitedKeys.has(flowState.stepKeys[i])) continue;
    if (!isStepVisible(kernel, stepNode as object)) continue;
    errors.push(...collectStepErrors(kernel, stepNode, flowState.stepKeys[i]));
  }
  return errors;
}

/** Агрегат flow.isInvalid: есть ли ошибки в посещённых видимых шагах. */
export function flowIsInvalid(kernel: Kernel, flowState: FlowState): boolean {
  return collectFlowErrors(kernel, flowState).length > 0;
}

/**
 * flow.validate(): собрать ошибки посещённых шагов, записать в реактивный
 * flow.errors и вернуть. Пустой массив = всё валидно.
 */
export function flowValidate(kernel: Kernel, flowState: FlowState): FlowError[] {
  const errors = collectFlowErrors(kernel, flowState);
  flowState.errors = errors;
  kernel.notifyChanged(new Set<object>([flowState as unknown as object, flowState.flowNode as object]));
  return errors;
}

/**
 * Отфильтровать из ошибок submit-пайплайна листья, лежащие под СКРЫТЫМИ
 * шагами любого флоу (Resolved Decision 14): базовый пайплайн валидирует все
 * листья независимо от видимости, и без фильтра невзятая ветка с isRequired
 * навсегда блокировала бы финализацию.
 *
 * `submittedNode` — узел, для которого выполнялся submit: пути ошибок пайплайна
 * ОТНОСИТЕЛЬНЫ ему (collectLeafStates строит пути от submitted-ноды), поэтому
 * абсолютные пути скрытых шагов приводятся к той же базе.
 */
export function filterHiddenFlowStepErrors(
  kernel: Kernel,
  errors: Array<{ path: string; message: string }>,
  submittedNode: AnyConfigNode,
): Array<{ path: string; message: string }> {
  const flows = kernel.nodes.allFlowStates;
  if (flows.length === 0 || errors.length === 0) return errors;

  const basePath = submittedNode === kernel.rootConfig
    ? ""
    : kernel.nodes.nodePaths.get(submittedNode as object) ?? "";

  const hiddenPrefixes: string[] = [];
  for (const flowState of flows) {
    for (const stepNode of flowState.stepNodes) {
      if (isStepVisible(kernel, stepNode as object)) continue;
      const stepPath = kernel.nodes.nodePaths.get(stepNode as object);
      if (!stepPath) continue;
      if (basePath === "") {
        hiddenPrefixes.push(stepPath + ".");
      } else if (stepPath.startsWith(basePath + ".")) {
        hiddenPrefixes.push(stepPath.slice(basePath.length + 1) + ".");
      }
      // stepPath вне поддерева submitted-ноды — его листья в errors не попадают.
    }
  }
  if (hiddenPrefixes.length === 0) return errors;

  return errors.filter((e) => !hiddenPrefixes.some((prefix) => e.path.startsWith(prefix)));
}

// ─── Submit (финализация) ─────────────────────────────────────────────────────

/**
 * flow.submit(): стандартный group-submit пайплайн над flow-нодой
 * (submitting → beforeSubmit → validate → onSubmit → afterSubmit; листья
 * скрытых шагов отфильтровываются пайплайном). Ошибки валидации ложатся в
 * реактивный flow.errors; при успехе errors очищаются.
 */
export async function flowSubmit(kernel: Kernel, flowState: FlowState): Promise<SubmitResult> {
  const result = await kernel.submitPipeline.execute(flowState.flowNode);
  flowState.errors = result.success ? [] : result.errors;
  kernel.notifyChanged(new Set<object>([flowState as unknown as object, flowState.flowNode as object]));
  return result;
}

// ─── Entry lifecycle ─────────────────────────────────────────────────────────

function fireCallback(cb: unknown, values: Record<string, unknown>, kernel: Kernel): void {
  if (typeof cb !== "function") return;
  try {
    void Promise.resolve((cb as (v: Record<string, unknown>, s: unknown) => unknown)(values, kernel))
      .catch(() => { /* fire-and-forget: ошибки lifecycle подавляются */ });
  } catch {
    /* синхронный throw тоже подавляется */
  }
}

/**
 * Lifecycle входа в шаг: onEnter → resolve (eager) → onReady.
 *
 * - `onEnter` / `onReady` получают FLOW-scoped values (все шаги по ключам) —
 *   живую ссылку groupSlot флоу; fire-and-forget.
 * - resolve шага — стандартный group resolve; флоу триггерит его НА ВХОДЕ
 *   (эквивалент первого доступа). Уже resolved/error (кэш) — не перезапускается,
 *   и onReady НЕ вызывается повторно (Resolved Decision 10).
 * - Без resolve — onReady сразу после onEnter.
 */
export function runEntryLifecycle(kernel: Kernel, flowState: FlowState, stepNode: AnyConfigNode): void {
  const flowValues =
    kernel.values.groupSlot.get(flowState.flowNode as object) ?? kernel.values.values;

  fireCallback((stepNode as Record<string, unknown>).onEnter, flowValues, kernel);

  const onReady = (stepNode as Record<string, unknown>).onReady;
  const fireReady = () => fireCallback(onReady, flowValues, kernel);

  const resolve = (stepNode as Record<string, unknown>).resolve as
    | { resolver?: unknown }
    | undefined;
  const hasResolve = !!resolve && typeof resolve.resolver === "function";

  if (!hasResolve) {
    fireReady();
    return;
  }

  const state = kernel.resolveManager.getResolveState(stepNode);
  if (state && state.status === "idle") {
    kernel.resolveManager.triggerResolve(stepNode);
    const after = kernel.resolveManager.getResolveState(stepNode);
    if (after?.promise) {
      void after.promise.then(fireReady).catch(() => {});
    } else {
      fireReady();
    }
  }
  // pending — resolve уже запущен другим входом (onReady прикреплён там);
  // resolved / error — кэш: onReady не перезапускается.
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function notifyNavigation(kernel: Kernel, flowState: FlowState, prevNode: object, nextNode: object): void {
  const changed = new Set<object>([
    flowState as unknown as object,
    flowState.flowNode as object,
    prevNode,
    nextNode,
  ]);
  kernel.notifyChanged(changed);
}

/**
 * Общий переход на шаг targetIndex.
 * `push: true` — nextStep()/goTo() (текущий ключ кладётся в стек);
 * `push: false` — back() (стек уже уменьшен вызывающим).
 */
function enterStep(kernel: Kernel, flowState: FlowState, targetIndex: number, push: boolean): void {
  const prevIndex = flowState.currentIndex;
  const prevKey = flowState.stepKeys[prevIndex];
  const prevNode = flowState.stepNodes[prevIndex] as object;

  if (push) flowState.visitStack.push(prevKey);

  flowState.currentIndex = targetIndex;
  const nextKey = flowState.stepKeys[targetIndex];
  const nextNode = flowState.stepNodes[targetIndex];

  // Предыдущий шаг был посещён (status → "completed"), новый — активен.
  flowState.visitedKeys.add(prevKey);
  flowState.visitedKeys.add(nextKey);

  notifyNavigation(kernel, flowState, prevNode, nextNode as object);
  runEntryLifecycle(kernel, flowState, nextNode);
}

/**
 * nextStep(): следующий ВИДИМЫЙ шаг по порядку массива; скрытые пропускаются.
 * Если видимых впереди нет — финализация через flow.submit() (при ошибках
 * валидации onSubmit не вызывается, ошибки в flow.errors, шаг не меняется).
 */
export function flowNextStep(kernel: Kernel, flowState: FlowState): void {
  for (let i = flowState.currentIndex + 1; i < flowState.stepNodes.length; i++) {
    if (isStepVisible(kernel, flowState.stepNodes[i] as object)) {
      enterStep(kernel, flowState, i, true);
      return;
    }
  }
  void flowSubmit(kernel, flowState);
}

/** back(): вернуться по стеку посещений. No-op при пустом стеке (canGoBack). */
export function flowBack(kernel: Kernel, flowState: FlowState): void {
  if (flowState.visitStack.length === 0) return;
  const targetKey = flowState.visitStack.pop()!;
  const targetIndex = flowState.stepKeys.indexOf(targetKey);
  if (targetIndex === -1) return; // повреждённый стек (после гидратации со старым конфигом)
  enterStep(kernel, flowState, targetIndex, false);
}

/**
 * goTo(keyOrIndex): произвольный переход по ключу или индексу.
 * Несуществующий ключ/индекс — throw (ловит опечатки на этапе разработки).
 * Переход в текущий шаг — no-op.
 */
export function flowGoTo(kernel: Kernel, flowState: FlowState, keyOrIndex: string | number): void {
  let targetIndex: number;
  if (typeof keyOrIndex === "number") {
    if (!Number.isInteger(keyOrIndex) || keyOrIndex < 0 || keyOrIndex >= flowState.stepKeys.length) {
      throw new Error(`[palistor] flow.goTo(${keyOrIndex}): step index out of range (0..${flowState.stepKeys.length - 1}).`);
    }
    targetIndex = keyOrIndex;
  } else {
    targetIndex = flowState.stepKeys.indexOf(keyOrIndex);
    if (targetIndex === -1) {
      throw new Error(`[palistor] flow.goTo("${keyOrIndex}"): unknown step key. Steps: ${flowState.stepKeys.join(", ")}.`);
    }
  }
  if (targetIndex === flowState.currentIndex) return;
  enterStep(kernel, flowState, targetIndex, true);
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/**
 * Сброс навигации флоу: первый шаг активен, стек и visited очищены,
 * resolve-состояния шагов сброшены в idle. Lifecycle входа первого шага
 * (onEnter → resolve → onReady) выполняется заново — зеркально инициализации.
 */
export function resetFlowNav(kernel: Kernel, flowState: FlowState): void {
  flowState.currentIndex = 0;
  flowState.visitStack = [];
  flowState.visitedKeys = new Set([flowState.stepKeys[0]]);
  flowState.errors = [];

  const changed = new Set<object>([flowState as unknown as object, flowState.flowNode as object]);
  for (const stepNode of flowState.stepNodes) {
    changed.add(stepNode as object);
    const resolve = (stepNode as Record<string, unknown>).resolve as { resolver?: unknown } | undefined;
    if (resolve && typeof resolve.resolver === "function") {
      resetResolveState(stepNode, kernel.resolveManager.states);
    }
  }
  kernel.notifyChanged(changed);
  runEntryLifecycle(kernel, flowState, flowState.stepNodes[0]);
}

/**
 * Сбросить навигацию всех флоу, попавших в поддерево сброса.
 * Вызывается из ResetPipeline (root reset → все флоу; reset группы → флоу внутри неё).
 */
export function resetFlowNavForSubtree(kernel: Kernel, groupNode: AnyConfigNode): void {
  const flows = kernel.nodes.allFlowStates;
  if (flows.length === 0) return;

  const basePath = groupNode === kernel.rootConfig
    ? ""
    : kernel.nodes.nodePaths.get(groupNode as object);
  if (basePath === undefined) return;

  for (const flowState of flows) {
    const within =
      basePath === "" ||
      flowState.path === basePath ||
      flowState.path.startsWith(basePath + ".");
    if (within) resetFlowNav(kernel, flowState);
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Инициализационный lifecycle: первый шаг каждого флоу «входится» при создании
 * store (onEnter → resolve → onReady). Вызывается из конструктора Palistor.
 *
 * Дополнительно прогревает proxyCache flow-нод: identity-view шага снимает
 * parent.proxy из кэша при первом step.submit(), и flow-proxy к этому моменту
 * уже должен существовать — иначе onSubmit шага получил бы undefined
 * третьим аргументом.
 */
export function initFlows(kernel: Kernel): void {
  for (const flowState of kernel.nodes.allFlowStates) {
    kernel.proxyBuilder.build(flowState.flowNode);
    runEntryLifecycle(kernel, flowState, flowState.stepNodes[flowState.currentIndex]);
  }
}

// ─── Persist ─────────────────────────────────────────────────────────────────

/** Снимок навигации флоу в persist-снапшоте (значения полей хранятся отдельно). */
export interface FlowNavSnapshot {
  currentStepKey: string;
  visitStack: string[];
  visitedKeys: string[];
}

/**
 * Сериализовать навигацию всех флоу для persist: ключ — dot-путь flow-ноды.
 * Статусы шагов не сохраняются — выводятся из навигации при гидратации.
 */
export function serializeFlowNav(kernel: Kernel): Record<string, FlowNavSnapshot> | null {
  const flows = kernel.nodes.allFlowStates;
  if (flows.length === 0) return null;
  const out: Record<string, FlowNavSnapshot> = {};
  for (const flowState of flows) {
    out[flowState.path] = {
      currentStepKey: flowState.stepKeys[flowState.currentIndex],
      visitStack: [...flowState.visitStack],
      visitedKeys: [...flowState.visitedKeys],
    };
  }
  return out;
}

/**
 * Восстановить навигацию флоу из persist-снимка. Неизвестные ключи шагов
 * (конфиг изменился) отбрасываются; несовместимый currentStepKey — флоу
 * остаётся в текущем состоянии. Возвращает изменённые узлы для notify и
 * список флоу, чей активный шаг изменился (для повторного entry lifecycle).
 */
export function restoreFlowNav(
  kernel: Kernel,
  snapshots: Record<string, FlowNavSnapshot>,
): { changed: Set<object>; entered: FlowState[] } {
  const changed = new Set<object>();
  const entered: FlowState[] = [];

  for (const flowState of kernel.nodes.allFlowStates) {
    const snap = snapshots[flowState.path];
    if (!snap || typeof snap !== "object" || typeof snap.currentStepKey !== "string") continue;

    const targetIndex = flowState.stepKeys.indexOf(snap.currentStepKey);
    if (targetIndex === -1) continue;

    const isKnownKey = (k: unknown): k is string =>
      typeof k === "string" && flowState.stepKeys.includes(k);

    const prevIndex = flowState.currentIndex;
    flowState.currentIndex = targetIndex;
    flowState.visitStack = Array.isArray(snap.visitStack)
      ? snap.visitStack.filter(isKnownKey)
      : [];
    flowState.visitedKeys = new Set(
      Array.isArray(snap.visitedKeys) ? snap.visitedKeys.filter(isKnownKey) : [],
    );
    flowState.visitedKeys.add(snap.currentStepKey);
    flowState.errors = [];

    changed.add(flowState as unknown as object);
    changed.add(flowState.flowNode as object);
    for (const stepNode of flowState.stepNodes) changed.add(stepNode as object);

    if (prevIndex !== targetIndex) entered.push(flowState);
  }

  return { changed, entered };
}

/** Entry lifecycle текущего шага (используется persist после гидратации). */
export function runFlowEntryLifecycle(kernel: Kernel, flowState: FlowState): void {
  runEntryLifecycle(kernel, flowState, flowState.stepNodes[flowState.currentIndex]);
}
