import { CONFIG_PROPS, MAPPABLE_CONFIG_KEYS, MAPPABLE_KEYS } from "./constants";
import type { FieldMapping } from "./store/types";

const MAPPABLE_KEYS_SET = new Set<string>(MAPPABLE_KEYS);

/**
 * Приводит конфиг, написанный во ВНЕШНИХ (замапленных) именах, к внутренним —
 * один раз, на границе конструктора `Palistor`, ДО того как дерево попадёт в
 * init/compute/traversal.
 *
 * Зачем: `fieldMapping` задаёт единый публичный словарь имён полей. Автор пишет
 * конфиг в этом словаре (`required`, `helpText`, …), а всё внутреннее ядро
 * (computeFieldState, registerNodes, обходы по `CONFIG_PROPS` / `"value" in node`)
 * оперирует internal-именами (`isRequired`, `description`, …). Нормализуя дерево
 * в одной точке, мы не трогаем ни одно из ~десятка мест ниже по стеку —
 * все они продолжают работать с internal-именами без изменений.
 *
 * Переводятся только ключи из {@link MAPPABLE_CONFIG_KEYS} (пересечение
 * mappable-ключей и входных ключей конфига). Идентичность дочерних полей
 * (`email`, `passport`, …) не ремапится никогда.
 *
 * Инвариант карты (см. RFC): external-имя не должно совпадать с именем соседнего
 * дочернего поля.
 *
 * @param config             корневой конфиг (как написал автор)
 * @param externalToInternal обратная карта external→internal (sparse)
 * @param fieldMapping        прямая карта internal→external (для strict-проверок)
 * @returns новое нормализованное дерево (оригинал не мутируется). Если карта
 *          пуста — возвращается исходный `config` без копий (нулевой оверхед).
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
  // ListNode — массив [template, listConfig?]: нормализуем каждый элемент.
  if (Array.isArray(node)) {
    return node.map((el) => normalizeNode(el, e2i, fwd));
  }
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(src)) {
    const value = src[key];

    // (1) strict: автор написал INTERNAL-имя config-ключа, который активно
    //     ремапится (напр. `isRequired` при isRequired→required).
    if (MAPPABLE_CONFIG_KEYS.has(key) && key in fwd) {
      throw new Error(
        `[palistor] fieldMapping is active: write "${String(
          fwd[key as keyof FieldMapping],
        )}" instead of internal "${key}" in config.`,
      );
    }

    const internal = e2i[key];

    // (2) key — внешнее имя из карты.
    if (internal !== undefined) {
      if (MAPPABLE_CONFIG_KEYS.has(internal)) {
        // ремап во ВХОДНОЙ config-ключ → переименовываем, внутрь не рекурсируем.
        out[internal] = value;
        continue;
      }
      if (MAPPABLE_KEYS_SET.has(internal)) {
        // ремап в ВЫЧИСЛЯЕМЫЙ/выходной ключ (isInvalid/errorMessage/dirty/
        // loading/onValueChange) — в конфиге его писать нельзя.
        throw new Error(
          `[palistor] "${internal}" (mapped as "${key}") is computed and cannot be set in config — remove it.`,
        );
      }
      // internal не mappable — карта странная; трактуем key как обычно (ниже).
    }

    // (3) key — не внешнее имя карты: служебный ключ конфига или дочернее поле.
    if (CONFIG_PROPS.has(key)) {
      // служебный (validate, componentProps, resolve, value, label, …) — как есть.
      out[key] = value;
    } else {
      // дочернее поле (идентичность не ремапится) → рекурсия.
      out[key] = normalizeNode(value, e2i, fwd);
    }
  }

  return out;
}
