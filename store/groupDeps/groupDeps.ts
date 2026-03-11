/**
 * Карта зависимостей между группами.
 *
 * Хранит пары "донор→реципиент" в Set<string>.
 * Когда значение в группе-доноре меняется, все группы-реципиенты
 * нужно пересчитать.
 *
 * Пример: если поле в группе passport читает значение из root,
 * записывается зависимость "→passport" (root — донор, passport — реципиент).
 *
 * Каждая группа по умолчанию зависит от себя ("AA", "BB").
 */
export { pairKey } from "./pairKey";
export { createGroupDeps } from "./createGroupDeps";
export { getRecipientGroups } from "./getRecipientGroups";
export { getNodeGroupPath } from "./getNodeGroupPath";
export { resolveGroupByPath } from "./resolveGroupByPath";
export { createTrackingValues } from "./createTrackingValues";
