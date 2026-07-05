import type { TranslateFn } from "../store/types";
import type { FieldState } from "./types";
import { resolveFlag } from "./resolveFlag";
import { resolveString } from "./resolveString";
import { isEmpty } from "./isEmpty";

/**
 * Computes the full state of a single field from the config and current values.
 *
 * @param revalidate — when false, validation is skipped (error/errorMessage stay undefined).
 *                     The submit pipeline always passes true to force validation.
 */
export function computeFieldState(
  configNode: Record<string, any>,
  currentValue: any,
  allValues: Record<string, any>,
  revalidate = true,
  translate: TranslateFn,
): FieldState {
  // Flags
  const isVisible  = resolveFlag(configNode.isVisible, allValues, true, translate);
  const isRequired = resolveFlag(configNode.isRequired, allValues, false, translate);
  const isDisabled = resolveFlag(configNode.isDisabled, allValues, false, translate);
  const isReadOnly = resolveFlag(configNode.isReadOnly, allValues, false, translate);

  // Strings
  const label       = resolveString(configNode.label, allValues);
  const placeholder = resolveString(configNode.placeholder, allValues);
  const description = resolveString(configNode.description, allValues);

  // Validation — only when revalidate is true
  let isInvalid: boolean | undefined;
  let errorMessage: string | undefined;

  if (revalidate) {
    // isRequired auto-validation: empty value → isInvalid
    if (isRequired && isEmpty(currentValue)) {
      isInvalid = true;
      errorMessage = typeof configNode.isRequired === "string"
        ? resolveString(configNode.isRequired, allValues)
        : "required";
    }
    // User validation (runs even when isRequired already failed — the validate message takes priority)
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
