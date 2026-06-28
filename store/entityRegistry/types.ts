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
    | Map<object, EntityListState>
    | { ownerId: string; ownerListNode: object }
    | undefined;
}

/**
 * Per-(owner, list) состояние вложенного списка (вариант C, фаза C1).
 *
 * @deprecated Алиас единого {@link ListState}. Введён на время унификации списков
 * (PLAN_UNIFY_LISTS.md), чтобы не переписывать сразу все импорты; будет удалён в U5.
 * Per-entity-list — это `ListState` с `ownerEntity !== null`.
 */
export type EntityListState = ListState;

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
  /** Map<listConfigNode, EntityListState>. Лениво создаётся. NON-ENUMERABLE. */
  lists?: Map<object, EntityListState>;
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
