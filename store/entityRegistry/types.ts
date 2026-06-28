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
 * Источник правды для re-render — `getNodeVersion(entityListState)` в хабе
 * (сам объект EntityListState служит ключом узла), а не отдельное поле version.
 * Изоляция между владельцами достигается тем, что для каждой пары
 * (ownerEntity, listConfigNode) создаётся СВОЙ объект EntityListState.
 */
export interface EntityListState {
  /** Конфиг-узел list (ListNode из template — массив). Дублирует ключ Map — для удобства. */
  listConfigNode: object;
  /** ID элементов в порядке отображения. */
  itemIds: string[];
  /** Initial-снимок для будущего dirty (C3). В C1 заполняется при resolve. */
  initialItemIds: string[];
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
