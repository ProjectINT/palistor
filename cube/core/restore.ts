// ─────────────────────────────────────────────────────────────────────────────
// Restore: a plain values tree (the shape of getValues()) put back into the
// cube tree. Two callers, one walk:
//
//   • persist hydration — a draft. Leaves take the stored value raw and keep
//     their baseline (the form stays dirty against what was loaded); a
//     paginated list is seeded from its window blob.
//   • `initialData` (the constructor) — a result. Every value is also the
//     dirty baseline, and a node with `resolve` that got data starts as
//     resolved: the state its resolver's result would have left, without a run.
//
// Lists are the same for both: rows go to the registry (merged), the list
// gets the ids as membership and baseline, then each item's own lists.
// ─────────────────────────────────────────────────────────────────────────────

import { hasLists, isLeafConfig, isPlainObject, type CubeConfig, type Values } from "./config";
import type { Cube } from "./cube";
import type { Hub } from "./hub";
import type { ListCube } from "./listCube";
import { idOf } from "./registry";
import { ResolveState } from "./resolve";
import { untracked } from "./track";

/** What a restore hands down the tree. */
export interface Restore {
  /** The data is a result (`initialData`), not a draft: values become the baseline, resolves start resolved. */
  result: boolean;
  /** persist: the window blobs of the paginated root lists, by list path. */
  blobs?: Values;
  /** Page caches, filled once every value is back: their pages are keyed on values (a seed may queue nested ones). */
  seeds: Array<() => void>;
  /** Resolves that got their result, accepted last: their dependencies are the versions after everything is applied. */
  accepts: ResolveState[];
}

/** persist hydration: the draft in `values`, the window blobs in `blobs`. */
export function restoreDraft(hub: Hub, values: Values, blobs: Values | undefined): void {
  run(hub, values, { result: false, blobs, seeds: [], accepts: [] });
}

/** The `initialData` option: results the server already has. Construction only (the caller keeps it silent). */
export function applyInitialData(hub: Hub, data: unknown): void {
  if (!isPlainObject(data)) {
    if (dev()) console.warn("[palistor] initialData must be an object in the shape of getValues(); ignored.");
    return;
  }
  run(hub, data, { result: true, seeds: [], accepts: [] });
}

function run(hub: Hub, values: Values, ctx: Restore) {
  restoreGroup(hub, hub.root, values, ctx, "");
  for (let i = 0; i < ctx.seeds.length; i++) ctx.seeds[i]();
  for (const rs of ctx.accepts) rs.accept();
}

const dev = () => typeof process === "undefined" || process.env.NODE_ENV !== "production";

/**
 * A form group: leaves take the value, groups recurse, lists are restored. A
 * key the data lacks is left alone. A result also marks the group's own
 * resolve as answered when the data carried what a group resolver returns:
 * the value of a leaf somewhere below (its result never reaches a list).
 * Returns whether a leaf took a value.
 */
function restoreGroup(hub: Hub, group: Cube, values: Values, ctx: Restore, path: string): boolean {
  let own = false;
  for (const [k, c] of group.children) {
    if (!(k in values)) continue;
    const v = values[k];
    if (ctx.result && v === undefined) continue;
    if (c.kind === "leaf") {
      if (typeof c.config.value === "function") continue;
      c.assign(v);
      if (ctx.result) { c.captureInitial(); accept(c, ctx); }
      own = true;
    } else if (c.kind === "group") {
      if (!isPlainObject(v)) continue;
      if (restoreGroup(hub, c, v, ctx, path ? `${path}.${k}` : k)) own = true;
    } else restoreList(hub, c as ListCube, v, ctx);
  }
  if (!ctx.result) return own;
  if (own) accept(group, ctx);
  if (dev()) {
    for (const k in values) {
      if (!group.children.has(k)) console.warn(`[palistor] initialData: "${path ? `${path}.${k}` : k}" is not in the config; ignored.`);
    }
  }
  return own;
}

function accept(cube: Cube, ctx: Restore) {
  if (cube.rs instanceof ResolveState) ctx.accepts.push(cube.rs);
}

/**
 * Rows go to the registry (merged), the list gets the ids as membership and
 * baseline, then each item's own lists. A paginated list waits until every
 * value is back, since its pages are keyed on values: a draft is seeded from
 * its blob (a per-entity one never has a blob: store bootstraps it), a result
 * is its first page — an array or `{ items, total, nextCursor, hasMore }` —
 * filed by the pager as a fetched page is.
 */
function restoreList(hub: Hub, list: ListCube, value: unknown, ctx: Restore) {
  const page = ctx.result && isPlainObject(value) && Array.isArray(value.items) ? value : null;
  const rows = page ? page.items : value;
  if (!Array.isArray(rows)) {
    if (ctx.result && dev()) console.warn(`[palistor] initialData: list "${list.path}" expects an array of rows; ignored.`);
    return;
  }
  const template = list.template;
  const nested = hasLists(template);
  const pager = list.pager;
  const filed = ctx.result && !!pager;
  const items: Array<[string, Values]> = [];
  const bodies: Values[] = [];
  let anonymous = false;
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    if (row.id == null || row.id === "") anonymous = true;
    const id = idOf(row);
    const body = { ...(nested ? rowData(row, template) : row), id };
    if (filed) bodies.push(body);
    else if (hub.registry.set(body)) hub.touch();
    items.push([id, row]);
  }
  if (ctx.result && anonymous && dev()) {
    console.warn(
      `[palistor] initialData: a row of list "${list.path}" has no id. It gets a temporary one, ` +
      `different on the server and on the client: anything keyed by the id will not hydrate.`,
    );
  }
  const ids = items.map(([id]) => id);

  if (pager) {
    const blob = list.item ? undefined : ctx.blobs?.[list.path];
    ctx.seeds.push(() => {
      if (filed) pager.accept({ ...page, items: bodies });
      else {
        pager.seed(ids, blob);
        // A per-entity list owns its rows whichever way they come (add, a fetched page, restore()).
        const owner = list.item;
        if (owner) for (const id of ids) hub.registry.setOwner(id, owner.entityId!, list.config);
      }
      if (!nested) return;
      for (const [id, row] of items) {
        const view = untracked(() => list.getById(id));
        if (view) restoreItemLists(hub, view, row, ctx);
      }
    });
    return;
  }
  list.restore(ids);
  if (nested) for (const [id, row] of items) restoreItemLists(hub, list.view(id), row, ctx);
  if (!ctx.result) return;
  // The rows answer the filter's current server values: a change of those issues, their return does not.
  list.filter?.markIssued();
  accept(list, ctx);
}

/** Inside an item: only lists (its fields already came with the row), in groups too. */
function restoreItemLists(hub: Hub, cube: Cube, values: Values, ctx: Restore) {
  for (const [k, c] of cube.children) {
    const v = values[k];
    if (c.kind === "list") { if (v !== undefined) restoreList(hub, c as ListCube, v, ctx); }
    else if (c.kind === "group" && isPlainObject(v)) restoreItemLists(hub, c, v, ctx);
  }
}

/** A row without the template's list keys: those belong to the per-entity lists. */
function rowData(row: Values, config: CubeConfig): Values {
  const out: Values = {};
  for (const k in row) {
    const sub = config[k];
    if (Array.isArray(sub)) continue;
    const v = row[k];
    out[k] = isPlainObject(sub) && !isLeafConfig(sub) && isPlainObject(v) ? rowData(v, sub as CubeConfig) : v;
  }
  return out;
}
