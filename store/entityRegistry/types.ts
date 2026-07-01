import type { ListState } from "../store/types";

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
 *
 * Index-сигнатура расширена meta-членами (`lists`/`owner`) варианта C, чтобы
 * EntityNode мог объявить их как именованные поля без конфликта TS2411.
 * На рантайме они non-enumerable и встречаются только на корневых EntityNode.
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
 * Корневая нода entity.
 * Обязательно содержит id-лист и произвольные поля (leaf или group).
 *
 * Поля `lists` и `owner` ОБЯЗАТЕЛЬНО non-enumerable (присваиваются через
 * Object.defineProperty в EntityRegistry) — иначе `buildEntityValues`
 * и любые `Object.keys(entityNode)`-обходы утянут их в плоские values
 * резолверов/computed.
 */
export interface EntityNode extends EntityGroupNode {
  id: EntityLeafNode;
  /** Map<listConfigNode, ListState> (per-entity, ownerEntity!==null). Лениво. NON-ENUMERABLE. */
  lists?: Map<object, ListState>;
  /** Owner-ссылка для child-entity (проставляется при заливке resolver-результата). NON-ENUMERABLE. */
  owner?: { ownerId: string; ownerListNode: object };
}

/**
 * Плоский объект данных, передаваемый в upsert/set.
 * id — обязательный строковый ключ.
 */
export type EntityData = {
  id?: string;
  [key: string]: unknown;
};
