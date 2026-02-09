/**
 * Проверяет, изменилась ли форма относительно initialValues
 * Использует глубокое сравнение через JSON (простое и надёжное)
 */
export const computeDirty = <TValues extends Record<string, any>>(
  values: TValues,
  initialValues: TValues
): boolean => {
  return JSON.stringify(values) !== JSON.stringify(initialValues);
}