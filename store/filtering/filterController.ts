import { isEmpty } from "../compute/isEmpty";
import type { FieldState } from "../compute/index";
import type { ListState } from "../store/types";
import type { FilterState } from "./types";

// ─── Emptiness ───────────────────────────────────────────────────────────────

/**
 * Filter-flavored emptiness: the base {@link isEmpty} (null/undefined/""/NaN)
 * plus two cases that only make sense for filter controls:
 * - `[]` — an empty multi-select filters nothing;
 * - `false` — a boolean toggle in the "off" position is an inactive filter
 *   (otherwise `onlyNew: { value: false, where: (i) => i.isNew }` would
 *   filter the moment the list renders).
 *
 * Used both to skip `where` predicates and to compute `isActive`/`activeCount`.
 */
export function isFilterEmpty(value: unknown): boolean {
  if (isEmpty(value)) return true;
  if (value === false) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * The "empty" value a field is cleared to by `filter.clear()` — typed off the
 * declared default: string → "", array → [], boolean → false, else null.
 */
export function emptyValueFor(defaultValue: unknown): unknown {
  if (typeof defaultValue === "string") return "";
  if (Array.isArray(defaultValue)) return [];
  if (typeof defaultValue === "boolean") return false;
  return null;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/** Deterministic JSON: object keys in sorted order at every level. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "u" : s;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

type NodeStateMap = WeakMap<object, FieldState>;

function readFieldValue(fs: FilterState, key: string, nodeState: NodeStateMap): unknown {
  const rt = fs.fields.get(key);
  if (!rt) return undefined;
  return nodeState.get(rt.node)?.value;
}

/**
 * Full snapshot of the filter's own values — derived fields included.
 * This is the shape `filter.values`, `ctx.filter.values`, `$all` and
 * `$toParams` consume.
 */
export function getFilterValues(
  fs: FilterState,
  nodeState: NodeStateMap,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of fs.fields.keys()) {
    values[key] = readFieldValue(fs, key, nodeState);
  }
  return values;
}

/**
 * `key` — stable hash of ALL non-derived field values (client memo key).
 * Derived fields are pure functions of values already in the key, so they are
 * excluded (redundant, and a Date-flavored derivation would thrash the cache).
 */
export function computeFilterKey(fs: FilterState, nodeState: NodeStateMap): string {
  const obj: Record<string, unknown> = {};
  for (const [key, rt] of fs.fields) {
    if (rt.isDerived) continue;
    obj[key] = nodeState.get(rt.node)?.value;
  }
  return stableStringify(obj);
}

/**
 * `serverKey` — stable hash of SERVER field values only: the request identity.
 * A client (`where`) field is in `key` but not here; that asymmetry is the
 * no-spurious-requests guarantee.
 */
export function computeServerKey(fs: FilterState, nodeState: NodeStateMap): string {
  const obj: Record<string, unknown> = {};
  for (const [key, rt] of fs.fields) {
    if (rt.isDerived || rt.isClient) continue;
    obj[key] = nodeState.get(rt.node)?.value;
  }
  return stableStringify(obj);
}

// ─── Params ──────────────────────────────────────────────────────────────────

/**
 * Build `ctx.filter.params` from SERVER fields only: per-field `param` renames,
 * or `$toParams` over the full values snapshot. `undefined` when the block has
 * no server fields and no `$toParams` (an all-`where` block issues nothing).
 */
export function buildFilterParams(
  fs: FilterState,
  filterValues: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown {
  if (fs.toParams) return fs.toParams(filterValues, context);
  if (!fs.hasServerFields) return undefined;
  const params: Record<string, unknown> = {};
  for (const [key, rt] of fs.fields) {
    if (rt.isClient || rt.isDerived) continue;
    params[rt.param ?? key] = filterValues[key];
  }
  return params;
}

// ─── Activity ────────────────────────────────────────────────────────────────

/** How many non-derived fields are non-empty. */
export function filterActiveCount(fs: FilterState, nodeState: NodeStateMap): number {
  let count = 0;
  for (const rt of fs.fields.values()) {
    if (rt.isDerived) continue;
    if (!isFilterEmpty(nodeState.get(rt.node)?.value)) count++;
  }
  return count;
}

/** `isActive` is emptiness, and nothing else: any non-derived field non-empty. */
export function isFilterActive(fs: FilterState, nodeState: NodeStateMap): boolean {
  for (const rt of fs.fields.values()) {
    if (rt.isDerived) continue;
    if (!isFilterEmpty(nodeState.get(rt.node)?.value)) return true;
  }
  return false;
}

// ─── Client projection ───────────────────────────────────────────────────────

/** Minimal slice of the Palistor kernel the projection needs (avoids an import cycle). */
export interface ProjectionKernel {
  nodes: { nodeState: NodeStateMap };
  entityProjectionObjs: Map<string, Record<string, unknown>>;
  getVersion(): number;
}

/**
 * Read-time projection of the loaded membership through the client fields.
 * `itemIds` is never rewritten — filtering is a projection, not a mutation, so
 * membership `dirty` stays honest and the reset baseline is untouched.
 *
 * - Per-field `where` predicates are skipped while their field's value is
 *   empty; the survivors are ANDed; `$all` runs last and always.
 * - Locally added ids (present in `itemIds` but not in `initialItemIds`)
 *   bypass the predicates — an optimistic `add()` must not vanish on creation.
 *   The exemption ends at the next resolve, which rewrites `initialItemIds`.
 * - Memoized on (filter key, store version): at most one re-predicate per
 *   store change per list. Ceiling: a few thousand rows; past it the answer
 *   is server fields.
 */
export function applyClientFilter(listState: ListState, kernel: ProjectionKernel): string[] {
  const fs = listState.filter as FilterState | undefined;
  if (!fs || !fs.hasClientFields) return listState.itemIds;

  const nodeState = kernel.nodes.nodeState;
  const key = computeFilterKey(fs, nodeState);
  fs.key = key;
  const version = kernel.getVersion();
  if (fs.memo && fs.memo.key === key && fs.memo.version === version) {
    return fs.memo.ids;
  }

  const filterValues = getFilterValues(fs, nodeState);
  const initialSet = new Set(listState.initialItemIds);

  const ids = listState.itemIds.filter((id) => {
    // Local-add exemption: not part of the server truth yet — always visible.
    if (!initialSet.has(id)) return true;
    const item = kernel.entityProjectionObjs.get(id);
    if (!item) return true;
    for (const [fieldKey, rt] of fs.fields) {
      if (!rt.isClient || !rt.where) continue;
      const value = filterValues[fieldKey];
      if (isFilterEmpty(value)) continue;
      if (!rt.where(item, value)) return false;
    }
    if (fs.all && !fs.all(item, filterValues)) return false;
    return true;
  });

  fs.memo = { key, version, ids };
  return ids;
}
