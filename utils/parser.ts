/**
 * Парсер значений для приведения к типам dataType
 *
 * Используется в onValueChange для автоматического приведения
 * входных значений к нужному типу согласно FieldConfig.types.dataType
 * Сложные типы не преобразуются, а просто проверяются на соответствие typeof
 */

/**
 * Карта допустимых typeof для каждого dataType
 * Если typeof value не в списке — форма не может принять такое значение
 */
const typeofMap: Record<string, string[] | string> = {
  String: ["string", "number"],
  Number: ["number", "string"],
  Boolean: "boolean",
  Date: "object",
  Array: "object",
  Object: "object",
};

export function parseValue(
  value: unknown,
  dataType: "String" | "Number" | "Boolean" | "Date" | "Array" | "Object"
): any {
  const valueType = typeof value;
  const allowedTypes = typeofMap[dataType];
 
  const isAllowed = allowedTypes.includes(valueType);

  if (!isAllowed) {
    throw new Error(
      `[Palistor] Invalid value type for dataType "${dataType}": expected ${allowedTypes}, got ${valueType}`
    );
  }

  switch (dataType) {
    case "String":
      return String(value);
    case "Number":
      return Number(value);
    default:
      return value;
  }
}
