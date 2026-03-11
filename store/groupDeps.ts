import { type AnyConfigNode } from "./types";
import { CONFIG_PROPS } from "./constants";

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

// ─── Константы ───────────────────────────────────────────────────────────────

/** Разделитель пары "донор→реципиент". */
const SEP = "\u2192"; // →

// ─── Утилиты пар ─────────────────────────────────────────────────────────────

/** Создать ключ пары "донор→реципиент". */
export function pairKey(donor: string, recipient: string): string {
  return `${donor}${SEP}${recipient}`;
}

/** Разобрать ключ обратно в [donor, recipient]. */
function parsePairKey(key: string): [string, string] {
  const idx = key.indexOf(SEP);
  return [key.slice(0, idx), key.slice(idx + SEP.length)];
}

// ─── Создание карты зависимостей ─────────────────────────────────────────────

/**
 * Создать карту зависимостей с self-зависимостью для каждой группы.
 *
 * Группа — любой узел конфига без "value".
 * Root-группа обозначается пустой строкой "".
 */
export function createGroupDeps(
  rootConfig: AnyConfigNode,
  nodePaths: WeakMap<object, string>,
): Set<string> {
  const deps = new Set<string>();

  // Self-зависимость корня
  deps.add(pairKey("", ""));

  // Self-зависимости вложенных групп
  function walk(node: AnyConfigNode): void {
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;
      if ("value" in child) continue; // лист — не группа
      const path = nodePaths.get(child) ?? "";
      deps.add(pairKey(path, path));
      walk(child);
    }
  }

  walk(rootConfig);
  return deps;
}

// ─── Запрос зависимостей ─────────────────────────────────────────────────────

/**
 * Получить все группы-реципиенты для данного донора (исключая self-зависимость).
 */
export function getRecipientGroups(deps: Set<string>, donorPath: string): string[] {
  const recipients: string[] = [];
  for (const pair of deps) {
    const [donor, recipient] = parsePairKey(pair);
    if (donor === donorPath && recipient !== donorPath) {
      recipients.push(recipient);
    }
  }
  return recipients;
}

// ─── Определение группы узла ─────────────────────────────────────────────────

/**
 * Определить путь группы, к которой принадлежит узел.
 *
 * - Листовой узел (есть "value") → путь родительской группы
 * - Групповой узел → свой собственный путь
 * - Root → ""
 */
export function getNodeGroupPath(
  node: object,
  nodeParents: WeakMap<object, object>,
  nodePaths: WeakMap<object, string>,
): string {
  // Групповой узел → его собственный путь
  if (!("value" in (node as Record<string, unknown>))) {
    return nodePaths.get(node) ?? "";
  }
  // Листовой → путь родительской группы
  const parent = nodeParents.get(node);
  if (!parent) return "";
  return nodePaths.get(parent) ?? "";
}

// ─── Резолв группы по пути ───────────────────────────────────────────────────

/**
 * Найти узел конфига группы по dot-пути.
 * "" → rootConfig, "passport" → rootConfig.passport, и т.д.
 */
export function resolveGroupByPath(
  rootConfig: AnyConfigNode,
  path: string,
): AnyConfigNode {
  if (!path) return rootConfig;
  const parts = path.split(".");
  let node: AnyConfigNode = rootConfig;
  for (const part of parts) {
    node = node[part] as AnyConfigNode;
  }
  return node;
}

// ─── Tracking-proxy для values-кеша ───────────────────────────────────────────────

/**
 * Обёртка для valuesCache.values, которая перехватывает READ-доступы
 * и записывает кросс-групповые зависимости в Set.
 *
 * При чтении leaf-значения определяется группа-донор (по текущему уровню вложенности).
 * Если донор ≠ реципиент → записываем пару donor→recipient.
 *
 * @param values             — плоский объект значений из valuesCache.values
 * @param recipientGroupPath — путь группы, для которой сейчас идёт вычисление
 * @param deps               — Set для записи обнаруженных зависимостей
 * @param currentGroupPath   — текущий уровень вложенности в дереве значений (начинается с "")
 */
export function createTrackingValues(
  values: Record<string, unknown>,
  recipientGroupPath: string,
  deps: Set<string>,
  currentGroupPath = "",
): Record<string, unknown> {
  return new Proxy(values, {
    get(target, key: string | symbol): unknown {
      if (typeof key === "symbol") return (target as any)[key];

      const val = (target as Record<string, unknown>)[key];

      // Вложенный объект (группа) — рекурсивный proxy
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const childPath = currentGroupPath ? `${currentGroupPath}.${key}` : key;
        return createTrackingValues(
          val as Record<string, unknown>,
          recipientGroupPath,
          deps,
          childPath,
        );
      }

      // Чтение leaf-значения: донор = currentGroupPath
      if (currentGroupPath !== recipientGroupPath) {
        deps.add(pairKey(currentGroupPath, recipientGroupPath));
      }

      return val;
    },
  });
}
