/**
 * Leaf-нода entity: минимальный объект со значением.
 * Совместим с AnyConfigNode leaf (имеет "value").
 */
export interface EntityLeafNode {
  value: unknown;
}

/**
 * Группа leaf-нод внутри entity.
 * Рекурсивная: поддерживает вложенные группы (e.g. user.passport).
 */
export interface EntityGroupNode {
  [key: string]: EntityLeafNode | EntityGroupNode;
}

/**
 * Корневая нода entity.
 * Обязательно содержит id-лист и произвольные поля (leaf или group).
 */
export interface EntityNode extends EntityGroupNode {
  id: EntityLeafNode;
}

/**
 * Плоский объект данных, передаваемый в upsert/set.
 * id — обязательный строковый ключ.
 */
export type EntityData = {
  id?: string;
  [key: string]: unknown;
};
