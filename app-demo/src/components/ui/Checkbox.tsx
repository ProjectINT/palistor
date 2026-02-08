"use client";

import { type InputHTMLAttributes, forwardRef } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> {
  label?: string;
  description?: string;
  errorMessage?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isRequired?: boolean;
  isVisible?: boolean; // Will be filtered out
  isReadOnly?: boolean; // Will be filtered out
  value?: boolean;
  onValueChange?: (value: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      description,
      errorMessage,
      isInvalid,
      isDisabled,
      isRequired,
      isVisible: _isVisible, // Filter out
      isReadOnly: _isReadOnly, // Filter out
      value,
      onValueChange,
      className,
    },
    ref
  ) => {
    return (
      <div className="flex flex-col gap-1">
        <label className={`
          flex items-start gap-3 cursor-pointer
          ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}
        `}>
          <input
            ref={ref}
            type="checkbox"
            checked={value ?? false}
            onChange={(e) => onValueChange?.(e.target.checked)}
            disabled={isDisabled}
            className={`
              mt-0.5 w-5 h-5 rounded border transition-colors cursor-pointer
              ${isInvalid 
                ? "border-red-500 text-red-500 focus:ring-red-500/20" 
                : "border-zinc-300 dark:border-zinc-600 text-blue-500 focus:ring-blue-500/20"
              }
              ${isDisabled ? "cursor-not-allowed" : ""}
              focus:outline-none focus:ring-2
              ${className ?? ""}
            `}
          />
          <div className="flex flex-col gap-0.5">
            {label && (
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {label}
                {isRequired && <span className="text-red-500 ml-0.5">*</span>}
              </span>
            )}
            {description && !errorMessage && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{description}</span>
            )}
          </div>
        </label>
        {errorMessage && (
          <p className="text-xs text-red-500 dark:text-red-400 ml-8">{errorMessage}</p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
