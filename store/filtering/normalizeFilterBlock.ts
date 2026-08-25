import type { AnyConfigNode } from "../store/types";
import type { NormalizedFilterBlock, NormalizedFilterField } from "./types";

/**
 * Builtin members of the `list.filter` proxy. Field names must not collide —
 * every builtin is a subtraction from the author's vocabulary, so a collision
 * is a construction-time error rather than a silently shadowed field.
 */
export const FILTER_PROXY_BUILTINS = new Set<string>([
  "values",
  "set",
  "reset",
  "clear",
  "isActive",
  "activeCount",
  "isPending",
]);

/**
 * Normalize an author-facing `filter` block into flat field descriptors.
 *
 * Rules (see FilteringPlan.md):
 * - Block-level keys are `$`-prefixed (`$all`, `$toParams`, `$persist`) — in a
 *   filter block a `$` key is block config, everything else is a field.
 * - Literal shorthand: a non-config default expands to `{ value: literal }`.
 *   The discriminator is the codebase-wide `"value" in node` rule: a plain
 *   object WITH a `value` key is a field config; anything else (primitive,
 *   array, object without `value`) is a literal default.
 * - Fields are flat leaves — an object default without `value` is an
 *   object-shaped literal, not a nested group.
 * - Classification is syntactic: `where` ⇒ client field, no `where` ⇒ server.
 * - Dead config that looks live throws: `param`/`debounce` on a `where` field
 *   can never fire (the field never reaches the resolver); same for a derived
 *   field (its value never forms the request identity).
 */
export function normalizeFilterBlock(
  block: Record<string, unknown>,
  listPath: string,
): NormalizedFilterBlock {
  const fields: NormalizedFilterField[] = [];
  let all: NormalizedFilterBlock["all"];
  let toParams: NormalizedFilterBlock["toParams"];
  let persist = false;

  for (const key of Object.keys(block)) {
    const raw = block[key];

    // ── Block-level `$` keys ────────────────────────────────────────────────
    if (key.startsWith("$")) {
      switch (key) {
        case "$all":
          if (typeof raw !== "function") {
            throw new Error(
              `[palistor] filter "$all" on list "${listPath}" must be a function.`,
            );
          }
          all = raw as NormalizedFilterBlock["all"];
          break;
        case "$toParams":
          if (typeof raw !== "function") {
            throw new Error(
              `[palistor] filter "$toParams" on list "${listPath}" must be a function.`,
            );
          }
          toParams = raw as NormalizedFilterBlock["toParams"];
          break;
        case "$persist":
          persist = Boolean(raw);
          break;
        default:
          throw new Error(
            `[palistor] unknown filter block option "${key}" on list "${listPath}" ` +
              `(known: $all, $toParams, $persist). Field names must not start with "$".`,
          );
      }
      continue;
    }

    // ── Field names must not shadow the filter proxy builtins ──────────────
    if (FILTER_PROXY_BUILTINS.has(key)) {
      throw new Error(
        `[palistor] filter field "${key}" on list "${listPath}" collides with a ` +
          `built-in member of list.filter (${[...FILTER_PROXY_BUILTINS].join(", ")}).`,
      );
    }

    // ── Guard: a list config used as a filter field ─────────────────────────
    if (
      Array.isArray(raw) &&
      raw.some(
        (el) =>
          el !== null &&
          typeof el === "object" &&
          !Array.isArray(el) &&
          ("resolve" in (el as object) || "template" in (el as object)),
      )
    ) {
      throw new Error(
        `[palistor] filter field "${key}" on list "${listPath}" looks like a list ` +
          `config — nested lists are not valid filter fields.`,
      );
    }

    // ── Literal shorthand vs field config ───────────────────────────────────
    const isConfig =
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "value" in (raw as object);

    const node: AnyConfigNode = isConfig
      ? (raw as AnyConfigNode)
      : ({ value: raw } as AnyConfigNode);

    const value = (node as { value?: unknown }).value;
    const isDerived = typeof value === "function";
    const where = (node as { where?: unknown }).where;
    const param = (node as { param?: unknown }).param;
    const debounce = (node as { debounce?: unknown }).debounce;
    const isClient = where !== undefined;

    if (isClient && typeof where !== "function") {
      throw new Error(
        `[palistor] filter field "${key}" on list "${listPath}": "where" must be a function.`,
      );
    }
    if (isClient && (param !== undefined || debounce !== undefined)) {
      // Dead config that looks live: a `where` field never reaches the
      // resolver, so a param rename / invalidation debounce on it never fires.
      throw new Error(
        `[palistor] filter field "${key}" on list "${listPath}" declares "where" ` +
          `together with "${param !== undefined ? "param" : "debounce"}" — a client ` +
          `field never issues a request, so that option can never apply.`,
      );
    }
    if (isDerived && (param !== undefined || debounce !== undefined)) {
      throw new Error(
        `[palistor] derived filter field "${key}" on list "${listPath}" declares ` +
          `"${param !== undefined ? "param" : "debounce"}" — a derived field is ` +
          `excluded from the request identity, so that option can never apply.`,
      );
    }
    if (param !== undefined && typeof param !== "string") {
      throw new Error(
        `[palistor] filter field "${key}" on list "${listPath}": "param" must be a string.`,
      );
    }
    if (debounce !== undefined && typeof debounce !== "number") {
      throw new Error(
        `[palistor] filter field "${key}" on list "${listPath}": "debounce" must be a number (ms).`,
      );
    }

    fields.push({
      key,
      node,
      isClient,
      isDerived,
      where: isClient ? (where as (item: unknown, value: unknown) => boolean) : undefined,
      param: param as string | undefined,
      debounce: debounce as number | undefined,
      defaultValue: isDerived ? undefined : value,
    });
  }

  return { fields, all, toParams, persist };
}
