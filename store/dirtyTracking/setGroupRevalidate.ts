import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Устанавливает флаг `revalidate` на узле-группе и рекурсивно распространяет его
 * на ВСЕ дочерние узлы — как на листовые поля, так и на вложенные группы.
 *
 * Используется, например, при сабмите формы: чтобы отобразить ошибки валидации
 * сразу для всех полей группы, даже если пользователь их ещё не трогал.
 *
 * Пример дерева конфига:
 *
 *   address (группа)
 *   ├── city   (поле, имеет "value")
 *   ├── street (поле, имеет "value")
 *   └── zip    (поле, имеет "value")
 *
 * Вызов setGroupRevalidate(address, true, nodeState) установит revalidate=true
 * на самом узле address и на каждом из его дочерних полей: city, street, zip.
 *
 * Пример с вложенными группами:
 *
 *   contacts (группа)
 *   ├── email  (поле)
 *   └── phone  (группа)
 *       ├── number  (поле)
 *       └── country (поле)
 *
 * Вызов setGroupRevalidate(contacts, true, nodeState) пройдёт рекурсивно
 * и установит флаг на contacts, email, phone, number, country.
 *
 * @param node       — узел конфига (группа или поле)
 * @param revalidate — значение флага, которое нужно установить
 * @param nodeState  — WeakMap с текущим состоянием каждого узла (FieldState)
 * @returns          — множество узлов, у которых флаг revalidate действительно изменился
 *                     (нужно для точечного уведомления подписчиков, без лишних ре-рендеров)
 */
export function setGroupRevalidate(
  node: AnyConfigNode,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  // Собираем только те узлы, у которых состояние реально изменилось,
  // чтобы не перерисовывать компоненты, которым флаг и так уже проставлен.
  const changed = new Set<object>();

  // Обновляем сам текущий узел (может быть как группой, так и полем).
  const state = nodeState.get(node);

  if (state && state.revalidate !== revalidate) {
    // Создаём новый объект состояния (иммутабельное обновление),
    // чтобы сравнение по ссылке корректно детектировало изменение.
    nodeState.set(node, { ...state, revalidate });
    changed.add(node);
  }

  // Обходим все ключи узла, пропуская служебные свойства конфига
  // (например, "_type", "_validators" и т.д., перечисленные в CONFIG_PROPS).
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    // Пропускаем примитивы и null — нас интересуют только объекты-узлы.
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Листовой узел (поле формы): содержит свойство "value".
      // Пример: { value: "Москва", dirty: false, revalidate: false }
      // Обновляем его флаг напрямую, без рекурсии.
      const childState = nodeState.get(child);
      if (childState && childState.revalidate !== revalidate) {
        nodeState.set(child, { ...childState, revalidate });
        changed.add(child);
      }
    } else {
      // Узел-группа (вложенная секция): не имеет "value", содержит другие узлы.
      // Пример: поле phone содержит number и country — рекурсивно обходим его.
      const childChanged = setGroupRevalidate(child, revalidate, nodeState);
      // Переносим результат рекурсии в общий набор изменившихся узлов.
      for (const n of childChanged) changed.add(n);
    }
  }

  return changed;
}
