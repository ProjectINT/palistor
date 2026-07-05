/**
 * Map of dependencies between groups.
 *
 * Stores "donor→recipient" pairs in a Set<string>.
 * When a value in a donor group changes, all recipient groups
 * need to be recomputed.
 *
 * Example: if a field in the passport group reads a value from the root,
 * the dependency "→passport" is recorded (root is the donor, passport the recipient).
 *
 * Every group depends on itself by default ("AA", "BB").
 */
export { pairKey } from "./pairKey";
export { createGroupDeps } from "./createGroupDeps";
export { getRecipientGroups } from "./getRecipientGroups";
export { getNodeGroupPath } from "./getNodeGroupPath";
export { resolveGroupByPath } from "./resolveGroupByPath";
export { createTrackingValues } from "./createTrackingValues";
