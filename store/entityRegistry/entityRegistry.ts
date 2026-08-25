import type { EntityNode, EntityGroupNode, EntityData } from "./types";
import type { ListConfig, ListState } from "../store/types";
import { generateTmpId } from "./generateId";
import { isLeafNode, isGroupNode } from "../traversal/nodeClassifier";
import { createPaginationState } from "../pagination/paginationController";

/**
 * Create a new EntityNode from a flat data object.
 * Every field (except id) is wrapped in { value }.
 * Supports nested objects — recursively creates EntityGroupNodes.
 *
 * @param data  Flat or nested data object
 * @param id    String ID (required at the top level)
 */
export function createEntityNode(data: EntityData, id: string): EntityNode {
  const node: EntityNode = { id: { value: id } };
  (node.id as any).__kind = "leaf";
  for (const key of Object.keys(data)) {
    if (key === "id") continue;
    const val = data[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      node[key] = createGroupNode(val as Record<string, unknown>);
    } else {
      const leaf = { value: val };
      (leaf as any).__kind = "leaf";
      node[key] = leaf;
    }
  }
  // EntityNode root is a group container
  (node as any).__kind = "group";
  return node;
}

/**
 * Recursively create an EntityGroupNode for a nested object.
 */
function createGroupNode(obj: Record<string, unknown>): EntityGroupNode {
  const group: EntityGroupNode = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      group[key] = createGroupNode(val as Record<string, unknown>);
    } else {
      const leaf = { value: val };
      (leaf as any).__kind = "leaf";
      group[key] = leaf;
    }
  }
  (group as any).__kind = "group";
  return group;
}

/**
 * Recursive merge of data into an existing EntityNode.
 *
 * Rules:
 * - Existing leaf fields: update `.value`
 * - New fields: create a leaf `{ value }`
 * - Missing fields: do NOT delete
 * - Nested objects in data: recursive merge into the group
 *
 * @param target  Existing EntityNode or EntityGroupNode
 * @param data    Input data (flat or nested)
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
      // Nested object
      if (existing && typeof existing === "object" && isGroupNode(existing as object)) {
        // Existing group → recursive merge
        mergeEntityNode(existing as EntityGroupNode, val as Record<string, unknown>);
      } else if (existing && isLeafNode(existing as object)) {
        // Was a leaf, became a group — replace (rare case)
        target[key] = createGroupNode(val as Record<string, unknown>);
      } else {
        // New group
        target[key] = createGroupNode(val as Record<string, unknown>);
      }
    } else {
      if (existing && isLeafNode(existing as object)) {
        // Update the existing leaf
        (existing as { value: unknown }).value = val;
      } else {
        // New leaf
        const leaf = { value: val };
        (leaf as any).__kind = "leaf";
        target[key] = leaf;
      }
    }
  }
}

/**
 * Entity registry.
 *
 * Fully isolated from Palistor: no dependencies on the store.
 * Holds EntityNodes, bindings (template attachments), the resolved cache.
 *
 * @example
 * const registry = new EntityRegistry();
 * const entity = registry.upsert({ id: 'u1', name: 'Alice' });
 * const node = registry.get('u1');
 * registry.bind('u1', formTemplate);
 */
export class EntityRegistry {
  /** Main storage: id → EntityNode */
  private readonly entities = new Map<string, EntityNode>();

  /**
   * Entity-to-template bindings.
   * One entity can be bound to several templates.
   */
  private readonly bindings = new Map<string, Set<object>>();

  /**
   * "Resolve completed" cache: id → Set<templateNode>.
   * When templateNode is in the Set, resolve for that pair can be skipped.
   */
  private readonly resolvedCache = new Map<string, Set<object>>();

  /**
   * Registered ListState objects.
   * Used in rekey() to update itemIds when an entity's id changes.
   * Structural type { itemIds: string[] } — no dependency on the ListState import.
   */
  private readonly registeredLists: Array<{ itemIds: string[] }> = [];

  /**
   * Reverse ownership index: ownerId → Set<childId>.
   * Filled by `setEntityOwner` when child-list resolver results are ingested.
   * Needed for cascade deletion; maintained from the start so the owner link
   * is registered as soon as it exists.
   */
  private readonly childrenByOwner = new Map<string, Set<string>>();

  // ─── CRUD ──────────────────────────────────────────────────────────────

  /**
   * Create or update an entity.
   *
   * - If no entity with the id exists — a new EntityNode is created.
   * - If it exists — recursive merge (existing fields update, new ones are
   *   added, fields missing from data are not deleted).
   * - If the id is missing or empty — a `_tmp_` id is generated.
   *
   * @returns The resulting EntityNode
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
   * Get an EntityNode by id.
   * Returns undefined when the entity is not found.
   */
  get(id: string): EntityNode | undefined {
    return this.entities.get(id);
  }

  /**
   * Delete an entity by id.
   * Clears all bindings and resolvedCache entries for the id.
   *
   * @returns true when the entity existed and was removed
   */
  delete(id: string): boolean {
    const existed = this.entities.has(id);
    const node = this.entities.get(id);
    this.entities.delete(id);
    this.bindings.delete(id);
    this.resolvedCache.delete(id);
    // Clear the owner's per-entity lists: the EntityListState objects are no
    // longer needed — the entity is gone. Palistor.delete drives the child-id cascade.
    node?.lists?.clear();
    // Clear the owner index: this entity's record as an owner …
    this.childrenByOwner.delete(id);
    // … and its membership in its own owner's set (when it is a child).
    const ownerId = node?.owner?.ownerId;
    if (ownerId) this.childrenByOwner.get(ownerId)?.delete(id);
    return existed;
  }

  /** Number of registered entities. */
  get size(): number {
    return this.entities.size;
  }

  /** Check whether an entity exists. */
  has(id: string): boolean {
    return this.entities.has(id);
  }

  // ─── Per-entity nested lists ───────────────────────────────────────────────

  /**
   * Get (or lazily create) the EntityListState for the (entity, listConfigNode) pair.
   *
   * `entity.lists` is created on first access as a **non-enumerable** field,
   * so it never leaks into flat values via `Object.keys`.
   *
   * A nested list declared with `resolve.pagination` gets its OWN pagination
   * sidecar per instance — one page cache per `(owner, listConfigNode)` pair,
   * driven by the shared paged executor exactly like a root list.
   *
   * @param fieldPath — the list's dot-path inside its template (diagnostics
   *   only: it names the instance in dev warnings as `<ownerId>.<fieldPath>`).
   */
  getOrCreateEntityListState(
    entity: EntityNode,
    listConfigNode: object,
    fieldPath?: string,
  ): ListState {
    let lists = entity.lists;
    if (!lists) {
      lists = new Map<object, ListState>();
      Object.defineProperty(entity, "lists", {
        value: lists,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    let state = lists.get(listConfigNode);
    if (!state) {
      const arr = listConfigNode as unknown[];
      const listConfig = arr.length > 1 ? (arr[1] as ListConfig) : undefined;
      state = {
        listConfigNode,
        template: arr[0] as object,
        listConfig,
        ownerEntity: entity,
        itemIds: [],
        initialItemIds: [],
      };
      const paginationBlock = listConfig?.resolve?.pagination;
      if (paginationBlock) {
        const ownerId = String(entity.id.value ?? "");
        state.pagination = createPaginationState(
          paginationBlock,
          `${ownerId}.${fieldPath ?? "list"}`,
        );
      }
      lists.set(listConfigNode, state);
    }
    return state;
  }

  /** Visit every per-entity ListState of every registered entity. */
  forEachEntityList(cb: (owner: EntityNode, state: ListState) => void): void {
    for (const entity of this.entities.values()) {
      const lists = entity.lists;
      if (!lists) continue;
      for (const state of lists.values()) cb(entity, state);
    }
  }

  /**
   * Set the owner reference on a child entity (**non-enumerable**) and
   * index it in `childrenByOwner`.
   *
   * "One owner per child" model: if the child already belonged to another
   * owner, the stale membership is removed so a cascade deletion of the old
   * owner does not touch the re-parented child.
   */
  setEntityOwner(child: EntityNode, ownerId: string, ownerListNode: object): void {
    const childId = child.id.value as string;
    const prevOwnerId = child.owner?.ownerId;
    if (prevOwnerId && prevOwnerId !== ownerId) {
      this.childrenByOwner.get(prevOwnerId)?.delete(childId);
    }
    Object.defineProperty(child, "owner", {
      value: { ownerId, ownerListNode },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    let set = this.childrenByOwner.get(ownerId);
    if (!set) {
      set = new Set<string>();
      this.childrenByOwner.set(ownerId, set);
    }
    set.add(childId);
  }

  /** Get the IDs of all child entities belonging to an owner. */
  getChildrenByOwner(ownerId: string): ReadonlySet<string> | undefined {
    return this.childrenByOwner.get(ownerId);
  }

  /**
   * Restore the membership of all per-entity lists to the initial snapshot (reset).
   *
   * Returns the affected `{ owner, state }` pairs so the caller (resetPipeline)
   * bumps node versions in the hub → React redraws the lists — and re-syncs
   * the owner's projectionObj for getValues. A PAGINATED instance is returned
   * untouched: its rollback is per cached page (the caller runs
   * `resetPagination`), never a window rewrite.
   */
  resetEntityListStates(): Array<{ owner: EntityNode; state: ListState }> {
    const affected: Array<{ owner: EntityNode; state: ListState }> = [];
    for (const entity of this.entities.values()) {
      const lists = entity.lists;
      if (!lists) continue;
      for (const state of lists.values()) {
        if (!state.pagination) state.itemIds = [...state.initialItemIds];
        affected.push({ owner: entity, state });
      }
    }
    return affected;
  }

  // ─── Bindings ──────────────────────────────────────────────────────────

  /**
   * Bind an entity to a template node.
   * One entity can be bound to several templates.
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
   * Unbind an entity from a template node.
   * No-op when the entity is not bound to that template.
   */
  unbind(id: string, templateNode: object): void {
    this.bindings.get(id)?.delete(templateNode);
  }

  /**
   * Get all template nodes bound to an entity.
   * Returns undefined when there are no bindings.
   */
  getBindings(id: string): ReadonlySet<object> | undefined {
    return this.bindings.get(id);
  }

  // ─── Resolved cache ────────────────────────────────────────────────────

  /**
   * Mark the (entityId, templateNode) pair as "resolve completed".
   * A repeat resolve for this pair is skipped.
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
   * Check whether resolve completed for the (entityId, templateNode) pair.
   */
  isResolved(id: string, templateNode: object): boolean {
    return this.resolvedCache.get(id)?.has(templateNode) ?? false;
  }

  /**
   * Clear the resolved cache:
   * - `clearResolved(id)` — clear the whole cache for the entity
   * - `clearResolved(id, templateNode)` — clear only for a specific template
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
   * Rename an entity: move its record from oldId to newId.
   *
   * Updates: the entities Map, bindings, resolvedCache, the id leaf value,
   * and itemIds in all registered ListState objects.
   *
   * No-op when no entity with oldId exists.
   */
  rekey(oldId: string, newId: string): void {
    const entity = this.entities.get(oldId);
    if (!entity) return;

    // Update the id leaf value
    entity.id.value = newId;

    // Move within the Map
    this.entities.delete(oldId);
    this.entities.set(newId, entity);

    // Move bindings
    const binds = this.bindings.get(oldId);
    if (binds) {
      this.bindings.delete(oldId);
      this.bindings.set(newId, binds);
    }

    // Move resolvedCache
    const resolved = this.resolvedCache.get(oldId);
    if (resolved) {
      this.resolvedCache.delete(oldId);
      this.resolvedCache.set(newId, resolved);
    }

    // Update itemIds in all registered ListState objects
    for (const list of this.registeredLists) {
      const idx = list.itemIds.indexOf(oldId);
      if (idx >= 0) list.itemIds[idx] = newId;
    }

    // Move the owner index: this entity's record as an owner …
    const owned = this.childrenByOwner.get(oldId);
    if (owned) {
      this.childrenByOwner.delete(oldId);
      this.childrenByOwner.set(newId, owned);
    }
    // … and its membership in its own owner's set (as a child).
    const ownerId = entity.owner?.ownerId;
    if (ownerId) {
      const set = this.childrenByOwner.get(ownerId);
      if (set?.has(oldId)) {
        set.delete(oldId);
        set.add(newId);
      }
    }
  }

  /**
   * Register a ListState for automatic itemIds updates on rekey().
   * Called from Palistor after NodeRegistry initialization.
   */
  registerList(list: { itemIds: string[] }): void {
    this.registeredLists.push(list);
  }
}
