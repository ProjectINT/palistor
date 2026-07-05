import type { ListState } from "../store/types";

/**
 * Entity leaf node: a minimal object holding a value.
 * Compatible with an AnyConfigNode leaf (has "value").
 */
export interface EntityLeafNode {
  value: unknown;
}

/**
 * A group of leaf nodes inside an entity.
 * Recursive: supports nested groups (e.g. user.passport).
 *
 * The index signature is widened with the `lists`/`owner` meta members so
 * EntityNode can declare them as named fields without a TS2411 conflict.
 * At runtime they are non-enumerable and appear only on root EntityNodes.
 */
export interface EntityGroupNode {
  [key: string]:
    | EntityLeafNode
    | EntityGroupNode
    | Map<object, ListState>
    | { ownerId: string; ownerListNode: object }
    | undefined;
}


/**
 * Root entity node.
 * Always contains the id leaf plus arbitrary fields (leaf or group).
 *
 * The `lists` and `owner` fields MUST be non-enumerable (assigned via
 * Object.defineProperty in EntityRegistry) — otherwise `buildEntityValues`
 * and any `Object.keys(entityNode)` walk would drag them into the flat
 * values seen by resolvers/computed props.
 */
export interface EntityNode extends EntityGroupNode {
  id: EntityLeafNode;
  /** Map<listConfigNode, ListState> (per-entity, ownerEntity!==null). Lazy. NON-ENUMERABLE. */
  lists?: Map<object, ListState>;
  /** Owner reference for a child entity (set when resolver results are ingested). NON-ENUMERABLE. */
  owner?: { ownerId: string; ownerListNode: object };
}

/**
 * Flat data object passed to upsert/set.
 * id — the required string key.
 */
export type EntityData = {
  id?: string;
  [key: string]: unknown;
};
