import { CONFIG_PROPS, MAPPABLE_CONFIG_KEYS, MAPPABLE_KEYS } from "./constants";
import type { FieldMapping } from "./store/types";

const MAPPABLE_KEYS_SET = new Set<string>(MAPPABLE_KEYS);

/**
 * Converts a config authored in EXTERNAL (mapped) names to internal names —
 * once, at the `Palistor` constructor boundary, BEFORE the tree reaches
 * init/compute/traversal.
 *
 * Why: `fieldMapping` defines the single public vocabulary of field names.
 * The author writes the config in that vocabulary (`required`, `helpText`, …)
 * while the whole internal core (computeFieldState, registerNodes, walks over
 * `CONFIG_PROPS` / `"value" in node`) operates on internal names
 * (`isRequired`, `description`, …). Normalizing the tree at a single point
 * leaves the ~dozen call sites below the stack untouched — they keep working
 * with internal names unchanged.
 *
 * Only keys from {@link MAPPABLE_CONFIG_KEYS} are translated (the
 * intersection of mappable keys and config input keys). Child field identity
 * (`email`, `passport`, …) is never remapped.
 *
 * Map invariant: an external name must not collide with a sibling child-field
 * name.
 *
 * @param config             root config (as authored)
 * @param externalToInternal reverse map, external→internal (sparse)
 * @param fieldMapping       forward map, internal→external (for strict checks)
 * @returns a new normalized tree (the original is not mutated). When the map
 *          is empty the original `config` is returned without copies (zero
 *          overhead).
 */
export function normalizeConfig<T>(
  config: T,
  externalToInternal: Record<string, string>,
  fieldMapping: FieldMapping,
): T {
  if (Object.keys(externalToInternal).length === 0) return config;
  return normalizeNode(config, externalToInternal, fieldMapping) as T;
}

function normalizeNode(
  node: unknown,
  e2i: Record<string, string>,
  fwd: FieldMapping,
): unknown {
  // ListNode — array [template, listConfig?]: normalize each element.
  if (Array.isArray(node)) {
    return node.map((el) => normalizeNode(el, e2i, fwd));
  }
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(src)) {
    const value = src[key];

    // (1) strict: the author wrote the INTERNAL name of a config key that is
    //     actively remapped (e.g. `isRequired` when isRequired→required).
    if (MAPPABLE_CONFIG_KEYS.has(key) && key in fwd) {
      throw new Error(
        `[palistor] fieldMapping is active: write "${String(
          fwd[key as keyof FieldMapping],
        )}" instead of internal "${key}" in config.`,
      );
    }

    const internal = e2i[key];

    // (2) key is an external name from the map.
    if (internal !== undefined) {
      if (MAPPABLE_CONFIG_KEYS.has(internal)) {
        // remap to an INPUT config key → rename, do not recurse inside.
        out[internal] = value;
        continue;
      }
      if (MAPPABLE_KEYS_SET.has(internal)) {
        // remap to a COMPUTED/output key (isInvalid/errorMessage/dirty/
        // loading/onValueChange) — it must not be written in a config.
        throw new Error(
          `[palistor] "${internal}" (mapped as "${key}") is computed and cannot be set in config — remove it.`,
        );
      }
      // internal is not mappable — odd map; treat key normally (below).
    }

    // (3) key is not an external map name: a service config key or a child field.
    if (CONFIG_PROPS.has(key)) {
      // service key (validate, componentProps, resolve, value, label, …) — as-is.
      out[key] = value;
    } else {
      // child field (identity is never remapped) → recurse.
      out[key] = normalizeNode(value, e2i, fwd);
    }
  }

  return out;
}
