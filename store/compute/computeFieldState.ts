import type { TranslateFn } from "../types";
import type { FieldState } from "./types";
import { resolveFlag } from "./resolveFlag";
import { resolveString } from "./resolveString";
import { isEmpty } from "./isEmpty";

/**
 * Вычисляет полное состояние одного поля на основе конфига и текущих values.
 *
 * @param revalidate — если false, валидация пропускается (error/errorMessage остаются undefined).
 *                     Submit pipeline всегда передаёт true, чтобы принудительно запустить валидацию.
 */
export function computeFieldState(
  configNode: Record<string, any>,
  currentValue: any,
  allValues: Record<string, any>,
  revalidate = true,
  translate: TranslateFn,
): FieldState {
  // Вычисляем флаги
  const isVisible  = resolveFlag(configNode.isVisible, allValues, true);
  const isRequired = resolveFlag(configNode.isRequired, allValues, false);
  const isDisabled = resolveFlag(configNode.isDisabled, allValues, false);
  const isReadOnly = resolveFlag(configNode.isReadOnly, allValues, false);

  // Строки
  const label       = resolveString(configNode.label, allValues);
  const placeholder = resolveString(configNode.placeholder, allValues);
  const description = resolveString(configNode.description, allValues);

  // Валидация — только если revalidate равен true
  let isInvalid: boolean | undefined;
  let errorMessage: string | undefined;

  if (revalidate) {
    // Автовалидация isRequired: пустое значение → isInvalid
    if (isRequired && isEmpty(currentValue)) {
      isInvalid = true;
      errorMessage = typeof configNode.isRequired === "string"
        ? resolveString(configNode.isRequired, allValues)
        : "required";
    }
    // Пользовательская валидация (выполняется даже если isRequired уже не прошёл — сообщение из validate имеет приоритет)
    if (typeof configNode.validate === "function") {
      const result = configNode.validate(currentValue, allValues, translate);

      if (result) {
        isInvalid = Boolean(result);
        errorMessage = result;
      }
    }
  }

  return {
    value: currentValue,
    isVisible,
    isRequired,
    isDisabled,
    isReadOnly,
    label,
    placeholder,
    description,
    isInvalid,
    errorMessage,
  };
}
