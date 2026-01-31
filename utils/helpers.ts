/**
 * Capitalizes the first letter of a string and makes the rest lowercase.
 * @param str - The string to capitalize.
 * @returns The capitalized string, or an empty string if input is undefined or null.
 */
export const capitalize = (str: string | undefined | null): string => {
  if (!str) return "";

  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Checks if a value is empty (null, undefined, empty string, empty array, empty object).
 * @param value - The value to check.
 * @returns True if the value is empty, false otherwise.
 */
export const isEmpty = (value: any): boolean => {
  if (value == null) return true;
  if (typeof value === "string" || Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;

  return false;
};

/**
 * Computes the intersection of arrays using a key to compare elements.
 * @param arrays - The arrays to intersect.
 * @param key - The key to use for comparison.
 * @returns The intersection array.
 */
export const intersectionBy = <T>(...arrays: (T[] | keyof T)[]): T[] => {
  if (arrays.length < 2) return [];
  const key = arrays.pop() as keyof T;
  const arrs = arrays as T[][];

  return arrs[0].filter(item =>
    arrs.slice(1).every(arr => arr.some(other => other[key] === item[key]))
  );
};

/**
 * Получает значение поля по указанному пути в объекте.
 * Возвращает ссылку на оригинальный вложенный объект (не копию).
 * @param obj - Исходный объект.
 * @param path - Массив ключей, определяющих путь к полю.
 * @returns Значение по указанному пути или undefined, если путь не существует.
 */
export const getFieldByPath = <T extends Record<string, any>>(
  obj: T,
  path: string[]
): unknown => {
  return path.reduce<unknown>((acc, key) => {
    const current = acc as Record<string, unknown>;

    try {
      return current[key];
    } catch {
      throw Error(`Cannot access path ${path.join(".")}: intermediate value is not an object`);
    }

  }, obj);
};

/**
 * Устанавливает значение поля по указанному пути в объекте (иммутабельно).
 * Возвращает новый объект с обновлённым значением, не изменяя оригинальный объект.
 * Применяет структурный шаринг: объекты вне пути остаются теми же самыми ссылками.
 * @param obj - Исходный объект.
 * @param path - Массив ключей, определяющих путь к полю.
 * @param value - Значение, которое нужно установить.
 * @returns Новый объект с обновлённым значением по указанному пути.
 */
export const setFieldByPath = <T extends Record<string, any>>(obj: T, path: string[], value: any): T => {
  if (path.length === 0) return obj;

  const [firstKey, ...restPath] = path;

  if (restPath.length === 0) {
    // Базовый случай: обновляем поле на текущем уровне
    return { ...obj, [firstKey]: value };
  }

  // Рекурсивный случай: спускаемся глубже
  const nested = obj[firstKey] || {};

  return {
    ...obj,
    [firstKey]: setFieldByPath(nested, restPath, value)
  };
};

/**
 * Удаляет поле по указанному пути из объекта (иммутабельно).
 * Возвращает новый объект без указанного поля, не изменяя оригинальный объект.
 * Применяет структурный шаринг: объекты вне пути остаются теми же самыми ссылками.
 * @param obj - Исходный объект.
 * @param path - Массив ключей, определяющих путь к полю для удаления.
 * @returns Новый объект без указанного поля.
 */
export const removeFieldByPath = <T extends Record<string, any>>(obj: T, path: string[]): T => {
  /* Эта функция должна пересоздавать объект без указанного поля */
  if (path.length === 0) return obj;

  const [firstKey, ...restPath] = path;

  if (!(firstKey in obj)) {
    return obj; // Поле не существует, возвращаем оригинальный объект
  }

  if (restPath.length === 0) {
    const { [firstKey]: _, ...rest } = obj;

    return rest as T;
  }

  return {
    ...obj,
    [firstKey]: removeFieldByPath(obj[firstKey], restPath),
  } as T;
};

/**
 * Преобразует строковый ключ с точечной нотацией в массив пути.
 * Используется для поддержки path-based API в формах.
 * @param key - Строка с ключом (поддерживает точечную нотацию: "email", "passport.issue_date")
 * @returns Массив ключей пути (например: ["passport", "issue_date"])
 * @throws Error если key не является строкой
 * @example
 * getPathFromKey("email")                 // ["email"]
 * getPathFromKey("passport.issue_date")   // ["passport", "issue_date"]
 * getPathFromKey("user.profile.name")     // ["user", "profile", "name"]
 */
export const getPathFromKey = (key: string): string[] => {
  if (typeof key === "string") {
    return key.split(".");
  }
  throw new Error("Key must be a string");
};
