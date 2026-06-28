import { type AnyConfigNode } from "../store/types";
import type { ListState } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";
import type { EntityData } from "../entityRegistry";
import type { EntityRegistry } from "../entityRegistry";
import type { EntityNode } from "../entityRegistry/types";
import { generateTmpId } from "../entityRegistry";
import { buildEntityValues } from "../buildProxy/buildEntityProjectionProxy";
import {
  type Resolve,
  type NotifyFn,
  type ResolveState,
  type ResolveDeps,
  type ListResolveDeps,
  type AnyResolveEntry,
  type TemplateFieldResolveEntry,
  type EntityFieldResolveDeps,
  EntityResolveStateMap,
  initResolveStates,
  executeResolve,
  executeListResolve,
  executeEntityFieldResolve,
  findResolvesToRetrigger,
  resetResolveState,
} from "../resolvePipeline/index";
import { isLeafNode } from "../traversal";

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface ResolveManagerDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  recompute: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  notify: NotifyFn;
  /** Снимок начальных значений — передаётся в resolve-пайплайн для dirty-трекинга. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
  /** Экземпляр ProxyStore — передаётся вторым аргументом в resolver. */
  store: any;
  // ─── Фаза 2C: специфика списков ─────────────────────────────────────────
  /** Все объекты ListState из NodeRegistry (для диспетчеризации list resolve). */
  listStates: WeakMap<object, ListState>;
  /**
   * Upsert-ит сущности и регистрирует их листья без вызова notify.
   * Вызывается из executeListResolve после успешного list resolver-а.
   * Фаза 4: listNode передаётся для автоматического запуска entity field resolves.
   */
  setEntitiesRaw: (items: EntityData[], listNode?: object) => Set<object>;
  /**
   * Синхронизирует valuesCache.values[listKey] с текущими listState.itemIds.
   * Вызывается из executeListResolve после обновления itemIds.
   */
  syncListValuesCache: (listNode: object) => void;
  /**
   * Экземпляр EntityRegistry — используется в triggerEntityFieldResolve для проверки skipIfResolved.
   */
  entityRegistry: EntityRegistry;
}

// ─── Класс ───────────────────────────────────────────────────────────────────

/**
 * Менеджер resolve-подсистемы.
 *
 * Консолидирует:
 * - Инициализацию resolve-состояний (initResolveStates)
 * - triggerResolve / getResolveState
 * - Post-notify hook для retrigger по зависимостям
 * - Запуск eager resolvers (lazy: false)
 */
// ─── Константы ─────────────────────────────────────────────────────────────────

/**
 * Максимальное число автоматических перезапусков одного resolver-а подряд
 * (через postNotifyHook). При превышении — предупреждение и пропуск.
 * Защищает от циклических зависимостей вида A→B→A.
 */
const MAX_AUTO_RETRIGGERS = 10;

// ─── Вспомогательные функции ────────────────────────────────────────────────

function isContextSatisfied(
  contextDeps: string[] | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!contextDeps || contextDeps.length === 0) return true;
  return contextDeps.every((key) => context[key] != null);
}

// ─── Класс ───────────────────────────────────────────────────────────────────

export class ResolveManager {
  /** Resolve-состояния всех узлов с resolve-конфигом. */
  readonly states = new Map<object, ResolveState>();

  /**
   * Per-entity состояния resolve.
   * - Per-field: (entityId, templateFieldNode) → ResolveState
   * - Per-template binding: (entityId, templateNode) → ResolveState
   *   где status === "pending" означает загрузку, state.submitting === true — отправку формы.
   */
  readonly entityStates = new EntityResolveStateMap();

  private readonly resolveEntries: AnyResolveEntry[];
  private readonly resolveEntryMap: Map<AnyConfigNode, AnyResolveEntry>;
  /** Записи template-полей (per-entity field resolves). */
  readonly templateFieldEntries: TemplateFieldResolveEntry[];
  /** Быстрый поиск: templateFieldNode → TemplateFieldResolveEntry. */
  private readonly templateFieldEntryMap: Map<AnyConfigNode, TemplateFieldResolveEntry>;
  /** listNode → TemplateFieldResolveEntry[] (для фазы 4: запуск при создании entity). */
  readonly listNodeToTemplateFieldEntries: Map<AnyConfigNode, TemplateFieldResolveEntry[]>;
  private readonly resolveDeps: ResolveDeps;
  private readonly listResolveDeps: ListResolveDeps;
  private readonly listStates: WeakMap<object, ListState>;
  private readonly entityRegistry: EntityRegistry;
  /** Записи, ожидающие удовлетворения contextDeps перед запуском. */
  private readonly pendingContextQueue = new Set<AnyResolveEntry>();

  constructor(deps: ResolveManagerDeps) {
    const {
      rootConfig, nodeState, recompute, notifyChanged, notify,
      initialValueMap, valuesCache, store,
      listStates, setEntitiesRaw, syncListValuesCache, entityRegistry,
    } = deps;

    this.listStates = listStates;
    this.entityRegistry = entityRegistry;
    const allEntries = initResolveStates(rootConfig, this.states);
    this.templateFieldEntries = allEntries.filter(
      (e): e is TemplateFieldResolveEntry => (e as TemplateFieldResolveEntry).isTemplateField === true,
    );
    this.resolveEntries = allEntries.filter((e) => !(e as TemplateFieldResolveEntry).isTemplateField);
    this.resolveEntryMap = new Map(this.resolveEntries.map((e) => [e.node, e]));

    // Строим карты быстрого доступа для записей template-полей
    this.templateFieldEntryMap = new Map(
      this.templateFieldEntries.map((e) => [e.node, e]),
    );
    this.listNodeToTemplateFieldEntries = new Map();
    for (const entry of this.templateFieldEntries) {
      const listNode = entry.listNode;
      let arr = this.listNodeToTemplateFieldEntries.get(listNode);
      if (!arr) {
        arr = [];
        this.listNodeToTemplateFieldEntries.set(listNode, arr);
      }
      arr.push(entry);
    }

    this.resolveDeps = {
      rootConfig,
      nodeState,
      resolveStates: this.states,
      recompute,
      notifyChanged,
      notify,
      getValues: () => structuredClone(valuesCache.values) as Record<string, unknown>,
      initialValueMap,
      valuesCache,
      store,
    };

    this.listResolveDeps = {
      ...this.resolveDeps,
      setEntitiesRaw,
      syncListValuesCache,
    };
  }

  // ─── Публичное API ─────────────────────────────────────────────────────────

  /**
   * Запустить resolve для конкретного узла (если у него есть resolve-конфиг).
   * Arrow function — сохраняет `this` при деструктуризации/передаче как callback.
   */
  triggerResolve = (node: AnyConfigNode): void => {
    const entry = this.resolveEntryMap.get(node);
    if (!entry) return;
    // Ручной запуск сбрасывает счётчик автоматических перезапусков
    const state = this.states.get(node as object);
    if (state) state.autoRetriggerCount = 0;
    this._executeEntry(entry);
  };

  /**
   * Получить текущее состояние resolve для узла.
   * Arrow function — сохраняет `this` при деструктуризации/передаче как callback.
   */
  getResolveState = (node: AnyConfigNode): ResolveState | undefined => {
    return this.states.get(node as object);
  };

  // ─── Фаза 2: entity field resolve ──────────────────────────────────────────

  /**
   * Запустить per-entity field resolve для конкретного entity и template-поля.
   *
   * Логика:
   * 1. Найти TemplateFieldResolveEntry по templateFieldNode
   * 2. getOrCreate ResolveState в entityStates
   * 3. skipIfResolved: если entity leaf уже имеет значение ≠ template default → skip
   * 4. Deduplication: если status === "pending" → return
   * 5. Вызвать _executeEntityFieldEntry (Phase 2: stub, Phase 3: реальная execution)
   */
  triggerEntityFieldResolve(entityId: string, templateFieldNode: AnyConfigNode): void {
    const entry = this.templateFieldEntryMap.get(templateFieldNode);
    if (!entry) return;

    const state = this.entityStates.getOrCreate(
      entityId,
      templateFieldNode as object,
      new Set(entry.resolve.deps ?? []),
    );

    // Проверка skipIfResolved: если у entity leaf уже есть значение ≠ template default
    const skipIfResolved = entry.resolve.options?.skipIfResolved ?? true;
    if (skipIfResolved) {
      const entityNode = this.entityRegistry.get(entityId);
      if (entityNode) {
        const entityLeaf = entityNode[entry.fieldKey] as { value: unknown } | undefined;
        const templateDefault = (entry.node as AnyConfigNode).value;
        if (
          entityLeaf &&
          isLeafNode(entityLeaf as object) &&
          entityLeaf.value !== templateDefault &&
          entityLeaf.value !== undefined &&
          entityLeaf.value !== null
        ) {
          // Значение уже отличается от дефолтного — помечаем resolved и пропускаем
          if (state.status === "idle") {
            state.status = "resolved";
          }
          return;
        }
      }
    }

    // Дедупликация: уже выполняется
    if (state.status === "pending") return;

    this._executeEntityFieldEntry(entry, entityId);
  }

  /**
   * Запустить resolve для entity-template binding.
   * Перенесено из Palistor (фаза 6 — унификация entity resolve в ResolveManager).
   *
   * - Проверяет наличие templateNode.resolve.resolver
   * - Deduplication: пропускает если уже loading (status === "pending")
   * - status "pending" → resolver(entityProxy, store) → upsert result → markResolved → status "resolved"
   * - При ошибке: onError → status "error"
   */
  triggerEntityTemplateResolve(
    entityId: string,
    templateNode: AnyConfigNode,
    entityProxy: object,
  ): void {
    const resolve = templateNode.resolve as
      | {
          resolver?: (...args: unknown[]) => unknown;
          onError?: (...args: unknown[]) => void;
        }
      | undefined;
    if (!resolve || typeof resolve.resolver !== "function") return;

    const entityNode = this.entityRegistry.get(entityId);
    if (!entityNode) return;

    const bindingState = this.entityStates.getOrCreate(entityId, templateNode as object);
    if (bindingState.status === "pending") return;

    const entityNodeObj = entityNode as unknown as object;
    bindingState.status = "pending";
    this.resolveDeps.notifyChanged(new Set<object>([entityNodeObj]));

    void (async () => {
      try {
        const result = await resolve.resolver!(entityProxy, this.resolveDeps.store);
        bindingState.status = "resolved";

        if (result && typeof result === "object") {
          const changed = this.listResolveDeps.setEntitiesRaw([result as EntityData]);
          this.entityRegistry.markResolved(entityId, templateNode as object);
          changed.add(entityNodeObj);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          const recomputed = (this.resolveDeps.store as any).recompute(changed) as Set<object>;
          for (const n of changed) recomputed.add(n);
          this.resolveDeps.notifyChanged(recomputed);
        } else {
          this.entityRegistry.markResolved(entityId, templateNode as object);
          this.resolveDeps.notifyChanged(new Set<object>([entityNodeObj]));
        }
      } catch (err) {
        bindingState.status = "error";
        try {
          (resolve.onError as ((e: unknown, ctx: { notify: NotifyFn }) => void) | undefined)?.(
            err,
            { notify: this.resolveDeps.notify },
          );
        } catch {
          // подавляем ошибки в onError
        }
        this.resolveDeps.notifyChanged(new Set<object>([entityNodeObj]));
      }
    })();
  }

  /**
   * Запустить resolve для per-entity вложенного списка (вариант C, фаза C1).
   *
   * Состояние resolve хранится в общем `entityStates`, ключ — (ownerId, listConfigNode).
   * Состав списка — в `EntityListState` (на `ownerEntity.lists`), идентичность
   * которого служит ключом изолированной версии в хабе.
   *
   * - Проверяет `listConfigNode[1].resolve.resolver`.
   * - Дедупликация: пропускает, если уже `pending`/`resolved`.
   * - `pending` → resolver(parentValues, store) → upsert children с owner-ссылкой →
   *   обновление `EntityListState.itemIds` → notify (bump версии entityListState).
   * - При ошибке: onError → status `error`.
   */
  triggerEntityListResolve(
    ownerId: string,
    listConfigNode: AnyConfigNode,
    ownerEntity: EntityNode,
  ): void {
    const listConfig = Array.isArray(listConfigNode)
      ? (listConfigNode[1] as { resolve?: { resolver?: (...a: unknown[]) => unknown; onError?: (...a: unknown[]) => void; deps?: string[] } } | undefined)
      : undefined;
    const resolve = listConfig?.resolve;
    if (!resolve || typeof resolve.resolver !== "function") return;

    const entityListState = this.entityRegistry.getOrCreateEntityListState(
      ownerEntity,
      listConfigNode as object,
    ) as unknown as object;

    const state = this.entityStates.getOrCreate(
      ownerId,
      listConfigNode as object,
      new Set(resolve.deps ?? []),
    );
    // Дедупликация: уже выполняется или завершён (C1 — без deps-driven re-resolve).
    if (state.status === "pending" || state.status === "resolved") return;

    state.status = "pending";
    this.resolveDeps.notifyChanged(new Set<object>([entityListState]));

    void (async () => {
      try {
        // Q4: resolver получает плоский snapshot ВЛАДЕЛЬЦА (не projection-proxy).
        const parentValues = buildEntityValues(
          ownerEntity,
          this.resolveDeps.nodeState as WeakMap<object, { value: unknown }>,
        );
        const result = await resolve.resolver!(parentValues, this.resolveDeps.store);
        state.status = "resolved";

        const items = Array.isArray(result) ? (result as EntityData[]) : [];
        const changed = new Set<object>();

        // Предварительно фиксируем id (стабильно для items без id), затем заливаем.
        const ids: string[] = [];
        const itemsWithIds: EntityData[] = items.map((item) => {
          const rawId = item.id;
          const id =
            typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
          ids.push(id);
          return { ...item, id };
        });

        if (itemsWithIds.length > 0) {
          const entityChanged = this.listResolveDeps.setEntitiesRaw(itemsWithIds);
          for (const n of entityChanged) changed.add(n);
          // Проставить owner-ссылку каждому child + проиндексировать.
          for (const id of ids) {
            const childNode = this.entityRegistry.get(id);
            if (childNode) {
              this.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
            }
          }
        }

        const els = this.entityRegistry.getOrCreateEntityListState(
          ownerEntity,
          listConfigNode as object,
        );
        els.itemIds = ids;
        els.initialItemIds = [...ids];

        // C3: материализовать состав в projectionObj владельца (для getValues).
        (this.resolveDeps.store as any)._syncEntityListValuesCache(
          ownerEntity,
          listConfigNode as object,
        );

        changed.add(entityListState);
        const recomputed = (this.resolveDeps.store as any).recompute(changed) as Set<object>;
        for (const n of changed) recomputed.add(n);
        this.resolveDeps.notifyChanged(recomputed);
      } catch (err) {
        state.status = "error";
        try {
          (resolve.onError as ((e: unknown, ctx: { notify: NotifyFn }) => void) | undefined)?.(
            err,
            { notify: this.resolveDeps.notify },
          );
        } catch {
          // подавляем ошибки в onError
        }
        this.resolveDeps.notifyChanged(new Set<object>([entityListState]));
      }
    })();
  }

  /**
   * Очистить все per-entity resolve states для удалённой entity.
   * Вызывается из Palistor.delete(entityId) — фаза 4.
   */
  cleanupEntityResolveStates(entityId: string): void {
    this.entityStates.delete(entityId);
  }

  /**
   * Подключить retrigger resolve в notification hub.
   * Возвращает функцию-хук `(changedPaths) => void`, которую нужно
   * установить в `hub.setPostNotifyHook`.
   * Возвращает `null`, если resolve-записей нет.
   */
  createPostNotifyHook(): ((changedPaths: Set<string>) => void) | null {
    if (this.resolveEntries.length === 0 && this.templateFieldEntries.length === 0) return null;

    return (changedPaths: Set<string>) => {
      const toRetrigger = findResolvesToRetrigger(
        changedPaths,
        this.states,
        this.resolveEntries,
      );

      // Отслеживаем узлы, которые только что запущены, чтобы не помечать их
      // pendingRetrigger в том же тике (у них уже есть новое значение зависимости).
      const justTriggeredNodes = new Set<object>(toRetrigger.map((e) => e.node as object));

      for (const entry of toRetrigger) {
        const state = this.states.get(entry.node as object);
        if (state) {
          const count = (state.autoRetriggerCount ?? 0) + 1;
          if (count > MAX_AUTO_RETRIGGERS) {
            console.warn(
              `Palistor: resolver auto-retrigger cap (${MAX_AUTO_RETRIGGERS}) reached. ` +
              `Possible circular dependency. Node deps: [${[...state.dependencies].join(", ")}]`,
            );
            continue;
          }
          state.autoRetriggerCount = count;
        }
        resetResolveState(entry.node as AnyConfigNode, this.states);
        this._executeEntry(entry);
      }

      // Помечаем resolver-ы, которые УЖЕ были в pending (не только что запущены),
      // чьи зависимости изменились — они перезапустятся после завершения текущей резолюции.
      for (const entry of this.resolveEntries) {
        if (justTriggeredNodes.has(entry.node as object)) continue;
        const state = this.states.get(entry.node as object);
        if (!state || state.status !== "pending") continue;
        for (const dep of state.dependencies) {
          if (changedPaths.has(dep)) {
            state.pendingRetrigger = true;
            break;
          }
        }
      }

      // Фаза 4: перезапуск entity field resolves при изменении путей entity.
      if (this.templateFieldEntries.length > 0) {
        this._retriggerEntityFieldResolves(changedPaths);
      }
    };
  }

  /**
   * Фаза 4: парсит entity-пути из changedPaths и перезапускает entity field resolves,
   * чьи зависимости пересекаются с изменёнными путями полей.
   *
   * Entity-пути имеют вид `_entity_.${entityId}.${fieldPath}`.
   * Зависимости в entityStates хранятся относительно entity (например, "name", не "_entity_.u1.name").
   */
  private _retriggerEntityFieldResolves(changedPaths: Set<string>): void {
    // Парсим entity-пути: строим карту entityId → Set<changedFieldPath>
    const entityChanges = new Map<string, Set<string>>();
    for (const path of changedPaths) {
      if (!path.startsWith("_entity_.")) continue;
      const withoutPrefix = path.slice("_entity_.".length);
      const dotIndex = withoutPrefix.indexOf(".");
      if (dotIndex === -1) continue;
      const entityId = withoutPrefix.slice(0, dotIndex);
      const fieldPath = withoutPrefix.slice(dotIndex + 1);
      let fields = entityChanges.get(entityId);
      if (!fields) {
        fields = new Set();
        entityChanges.set(entityId, fields);
      }
      fields.add(fieldPath);
    }

    if (entityChanges.size === 0) return;

    for (const [entityId, changedFields] of entityChanges) {
      for (const entry of this.templateFieldEntries) {
        const state = this.entityStates.get(entityId, entry.node as object);
        if (!state) continue;

        if (state.status === "resolved" || state.status === "error") {
          // Проверяем, изменилась ли хоть одна зависимость → перезапуск
          let shouldRetrigger = false;
          for (const dep of state.dependencies) {
            if (changedFields.has(dep)) {
              shouldRetrigger = true;
              break;
            }
          }
          if (shouldRetrigger) {
            // Сбрасываем состояние в idle и выполняем напрямую (обходим skipIfResolved —
            // это перезапуск по изменению зависимости, а не начальная загрузка).
            state.status = "idle";
            state.pendingRetrigger = false;
            this._executeEntityFieldEntry(entry, entityId);
          }
        } else if (state.status === "pending") {
          // Помечаем pendingRetrigger, чтобы перезапустить после завершения текущего resolve
          for (const dep of state.dependencies) {
            if (changedFields.has(dep)) {
              state.pendingRetrigger = true;
              break;
            }
          }
        }
      }
    }
  }

  /** Запустить eager resolvers (lazy: false). */
  launchEager(): void {
    for (const entry of this.resolveEntries) {
      const lazy = entry.resolve?.options?.lazy ?? true;
      if (!lazy) {
        this._executeEntry(entry);
      }
    }
  }

  /**
   * Ретриггерить резолверы, зависящие от изменённых путей.
   * Используется из `Palistor.setContext()` для реактивного перезапуска
   * резолверов при изменении контекста.
   */
  retriggerByPaths(changedPaths: Set<string>): void {
    if (changedPaths.size === 0) return;

    const toRetrigger = findResolvesToRetrigger(
      changedPaths,
      this.states,
      this.resolveEntries,
    );

    for (const entry of toRetrigger) {
      // setContext — явное внешнее изменение, сбрасываем счётчик авто-перезапусков
      const state = this.states.get(entry.node as object);
      if (state) state.autoRetriggerCount = 0;
      resetResolveState(entry.node as AnyConfigNode, this.states);
      this._executeEntry(entry);
    }

    // Сбрасываем очередь отложенных: запускаем записи, у которых contextDeps теперь удовлетворены
    for (const entry of this.pendingContextQueue) {
      const resolve = entry.resolve as Resolve | undefined;
      if (isContextSatisfied(resolve?.contextDeps, this.resolveDeps.store.context)) {
        this.pendingContextQueue.delete(entry);
        this._executeEntry(entry);
      }
    }
  }

  // ─── Внутренняя диспетчеризация ──────────────────────────────────────────────

  /** Диспетчеризует запись в нужную функцию выполнения (группа или список). */
  private _executeEntry(entry: AnyResolveEntry): void {
    // Фаза 4, условие запуска: если contextDeps не удовлетворены — откладываем в очередь
    const resolve = entry.resolve as Resolve | undefined;
    if (!isContextSatisfied(resolve?.contextDeps, this.resolveDeps.store.context)) {
      this.pendingContextQueue.add(entry);
      return;
    }

    if (entry.isListNode) {
      const listState = this.listStates.get(entry.node as object);
      if (listState && entry.resolve) {
        executeListResolve(
          entry.node as object,
          entry.resolve as import("../store/types").ListResolveConfig,
          listState,
          this.listResolveDeps,
        );
      }
    } else {
      executeResolve(
        (entry as { node: AnyConfigNode; resolve: Resolve }).node,
        (entry as { node: AnyConfigNode; resolve: Resolve }).resolve,
        this.resolveDeps,
      );
    }
  }

  /**
   * Выполняет entity field resolve для заданной entry + entityId.
   * Делегирует вызов executeEntityFieldResolve с per-entity ResolveDeps.
   */
  private _executeEntityFieldEntry(
    entry: TemplateFieldResolveEntry,
    entityId: string,
  ): void {
    const entityNode = this.entityRegistry.get(entityId);
    if (!entityNode) return;

    const entityFieldDeps: EntityFieldResolveDeps = {
      ...this.resolveDeps,
      entityStates: this.entityStates,
    };

    executeEntityFieldResolve(entityId, entry, entityNode, entityFieldDeps);
  }
}

// ─── Устаревший алиас-фабрика ───────────────────────────────────────────────

/** @deprecated Используйте `new ResolveManager(deps)`. */
export function createResolveManager(deps: ResolveManagerDeps): ResolveManager {
  return new ResolveManager(deps);
}
