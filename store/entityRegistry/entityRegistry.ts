import type { EntityNode, EntityGroupNode, EntityData } from "./types";
import { generateTmpId } from "./generateId";

/**
 * Создать новую EntityNode из плоского объекта данных.
 * Каждое поле (кроме id) оборачивается в { value }.
 * Поддерживает вложенные объекты — рекурсивно создаёт EntityGroupNode.
 *
 * @param data  Плоский или вложенный объект данных
 * @param id    Строковый ID (обязателен на верхнем уровне)
 */
export function createEntityNode(data: EntityData, id: string): EntityNode {
  const node: EntityNode = { id: { value: id } };
  for (const key of Object.keys(data)) {
    if (key === "id") continue;
    const val = data[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      node[key] = createGroupNode(val as Record<string, unknown>);
    } else {
      node[key] = { value: val };
    }
  }
  return node;
}

/**
 * Рекурсивно создать EntityGroupNode для вложенного объекта.
 */
function createGroupNode(obj: Record<string, unknown>): EntityGroupNode {
  const group: EntityGroupNode = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      group[key] = createGroupNode(val as Record<string, unknown>);
    } else {
      group[key] = { value: val };
    }
  }
  return group;
}

/**
 * Рекурсивный merge данных в существующую EntityNode.
 *
 * Правила:
 * - Существующие leaf-поля: обновить `.value`
 * - Новые поля: создать leaf `{ value }`
 * - Отсутствующие поля: НЕ удалять
 * - Вложенные объекты в data: рекурсивный merge в group
 *
 * @param target  Существующая EntityNode или EntityGroupNode
 * @param data    Входные данные (flat или вложенные)
 */
export function mergeEntityNode(
  target: EntityNode | EntityGroupNode,
  data: Record<string, unknown>,
): void {
  for (const key of Object.keys(data)) {
    if (key === "id") continue;
    const val = data[key];
    const existing = target[key];

    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      // Вложенный объект
      if (existing && typeof existing === "object" && !("value" in existing)) {
        // Существующая группа → рекурсивный merge
        mergeEntityNode(existing as EntityGroupNode, val as Record<string, unknown>);
      } else if (existing && "value" in existing) {
        // Был leaf, стал группой — заменяем (редкий случай)
        target[key] = createGroupNode(val as Record<string, unknown>);
      } else {
        // Новая группа
        target[key] = createGroupNode(val as Record<string, unknown>);
      }
    } else {
      if (existing && "value" in existing) {
        // Обновляем существующий leaf
        (existing as { value: unknown }).value = val;
      } else {
        // Новый leaf
        target[key] = { value: val };
      }
    }
  }
}

/**
 * Реестр сущностей.
 *
 * Полностью изолирован от Palistor: не имеет зависимостей на store.
 * Хранит EntityNode-ы, bindings (template-привязки), resolved-кэш.
 *
 * @example
 * const registry = new EntityRegistry();
 * const entity = registry.upsert({ id: 'u1', name: 'Alice' });
 * const node = registry.get('u1');
 * registry.bind('u1', formTemplate);
 */
export class EntityRegistry {
  /** Основное хранилище: id → EntityNode */
  private readonly entities = new Map<string, EntityNode>();

  /**
   * Привязки entity к template-нодам.
   * Один entity может быть привязан к нескольким templates.
   */
  private readonly bindings = new Map<string, Set<object>>();

  /**
   * Кэш «resolve выполнен»: id → Set<templateNode>.
   * Если templateNode есть в Set, resolve для этой пары можно пропустить.
   */
  private readonly resolvedCache = new Map<string, Set<object>>();

  // ─── CRUD ──────────────────────────────────────────────────────────────

  /**
   * Создать или обновить entity.
   *
   * - Если entity с таким id не существует — создаётся новая EntityNode.
   * - Если существует — рекурсивный merge (существующие поля обновляются,
   *   новые добавляются, отсутствующие в data не удаляются).
   * - Если id не указан или пустой — генерируется `_tmp_` id.
   *
   * @returns Итоговая EntityNode
   */
  upsert(data: EntityData): EntityNode {
    const id = data.id && typeof data.id === "string" && data.id.trim() !== ""
      ? data.id
      : generateTmpId();

    const existing = this.entities.get(id);
    if (existing) {
      mergeEntityNode(existing, { ...data, id });
      return existing;
    }

    const node = createEntityNode(data, id);
    this.entities.set(id, node);
    return node;
  }

  /**
   * Получить EntityNode по id.
   * Возвращает undefined, если entity не найдена.
   */
  get(id: string): EntityNode | undefined {
    return this.entities.get(id);
  }

  /**
   * Удалить entity по id.
   * Очищает все bindings и resolvedCache для этого id.
   *
   * @returns true, если entity существовала и была удалена
   */
  delete(id: string): boolean {
    const existed = this.entities.has(id);
    this.entities.delete(id);
    this.bindings.delete(id);
    this.resolvedCache.delete(id);
    return existed;
  }

  /** Количество зарегистрированных entities. */
  get size(): number {
    return this.entities.size;
  }

  /** Проверить наличие entity. */
  has(id: string): boolean {
    return this.entities.has(id);
  }

  // ─── Bindings ──────────────────────────────────────────────────────────

  /**
   * Привязать entity к template-ноде.
   * Один entity может быть привязан к нескольким templates.
   */
  bind(id: string, templateNode: object): void {
    let set = this.bindings.get(id);
    if (!set) {
      set = new Set();
      this.bindings.set(id, set);
    }
    set.add(templateNode);
  }

  /**
   * Отвязать entity от template-ноды.
   * Если entity не привязана к этому template — no-op.
   */
  unbind(id: string, templateNode: object): void {
    this.bindings.get(id)?.delete(templateNode);
  }

  /**
   * Получить все template-ноды, привязанные к entity.
   * Возвращает undefined, если привязок нет.
   */
  getBindings(id: string): ReadonlySet<object> | undefined {
    return this.bindings.get(id);
  }

  // ─── Resolved cache ────────────────────────────────────────────────────

  /**
   * Пометить пару (entityId, templateNode) как «resolve выполнен».
   * Повторный resolve для этой пары будет пропущен.
   */
  markResolved(id: string, templateNode: object): void {
    let set = this.resolvedCache.get(id);
    if (!set) {
      set = new Set();
      this.resolvedCache.set(id, set);
    }
    set.add(templateNode);
  }

  /**
   * Проверить, был ли resolve выполнен для пары (entityId, templateNode).
   */
  isResolved(id: string, templateNode: object): boolean {
    return this.resolvedCache.get(id)?.has(templateNode) ?? false;
  }

  /**
   * Сбросить resolved-кэш:
   * - `clearResolved(id)` — очистить весь кэш для entity
   * - `clearResolved(id, templateNode)` — очистить только для конкретного template
   */
  clearResolved(id: string, templateNode?: object): void {
    if (templateNode === undefined) {
      this.resolvedCache.delete(id);
    } else {
      this.resolvedCache.get(id)?.delete(templateNode);
    }
  }

  // ─── Re-keying ─────────────────────────────────────────────────────────

  /**
   * Переименовать entity: перенести запись с oldId на newId.
   *
   * Обновляет: entities Map, bindings, resolvedCache, id leaf value.
   * Обновление itemIds в ListState — откладывается до фазы 2C.
   *
   * No-op если entity с oldId не существует.
   */
  rekey(oldId: string, newId: string): void {
    const entity = this.entities.get(oldId);
    if (!entity) return;

    // Обновить id leaf value
    entity.id.value = newId;

    // Переместить в Map
    this.entities.delete(oldId);
    this.entities.set(newId, entity);

    // Переместить bindings
    const binds = this.bindings.get(oldId);
    if (binds) {
      this.bindings.delete(oldId);
      this.bindings.set(newId, binds);
    }

    // Переместить resolvedCache
    const resolved = this.resolvedCache.get(oldId);
    if (resolved) {
      this.resolvedCache.delete(oldId);
      this.resolvedCache.set(newId, resolved);
    }
  }
}
