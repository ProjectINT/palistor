import type { FieldMapping } from "./store/types";

/**
 * Helper for declaring a reusable `fieldMapping` map while preserving literal
 * values in the type.
 *
 * Why it exists: when the map is extracted into a separate constant, the
 * literal values (`"required"`, …) usually widen to `string`, and static
 * field renaming stops working (runtime is unaffected). Two ways to avoid
 * that — `as const` or this helper. `defineFieldMapping` is preferred since
 * it also validates the map against {@link FieldMapping} (keys — mappable
 * names only, values — strings).
 *
 * > ⚠️ Do NOT use `... satisfies FieldMapping` for a reusable map:
 * > `satisfies` widens the values to `string` and the rename typing breaks.
 * > For an inline literal directly in `new Palistor({ fieldMapping })` the
 * > helper is unnecessary — the class `const` type parameter captures the
 * > literals by itself.
 *
 * `fieldMapping` defines the SINGLE public vocabulary of field names: the
 * config is authored in the same (external) names it is read with. The
 * normalizer in the Palistor constructor converts them to internal names
 * before compute (see `normalizeConfig`), so the core is unchanged. Writing
 * the internal name of a remapped key in the config is an error (strict).
 *
 * @example
 * const fieldMapping = defineFieldMapping({
 *   isRequired:   "required",
 *   isInvalid:    "error",
 *   errorMessage: "helperText",
 *   description:  "helpText",
 * });
 * const store = new Palistor({
 *   config: {
 *     // external names, not isRequired/description:
 *     email: { value: "", required: true, helpText: "We never share it" },
 *   },
 *   fieldMapping,
 * });
 * store.proxy.email.required;    // boolean — statically typed
 * store.proxy.email.helperText;  // string  — validation error after submit
 */
export function defineFieldMapping<const M extends FieldMapping>(mapping: M): M {
  return mapping;
}
