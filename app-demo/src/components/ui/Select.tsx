"use client";

import { type SelectHTMLAttributes, forwardRef } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  label?: string;
  placeholder?: string;
  description?: string;
  errorMessage?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isRequired?: boolean;
  isVisible?: boolean; // Will be filtered out
  isReadOnly?: boolean; // Will be filtered out
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      placeholder,
      description,
      errorMessage,
      isInvalid,
      isDisabled,
      isRequired,
      isVisible: _isVisible, // Filter out
      isReadOnly: _isReadOnly, // Filter out
      value,
      onValueChange,
      options,
      className,
    },
    ref
  ) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {label}
            {isRequired && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <select
          ref={ref}
          value={value ?? ""}
          onChange={(e) => onValueChange?.(e.target.value)}
          disabled={isDisabled}
          className={`
            w-full px-3 py-2 rounded-lg border transition-colors
            bg-white dark:bg-zinc-900
            ${isInvalid 
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" 
              : "border-zinc-300 dark:border-zinc-700 focus:border-blue-500 focus:ring-blue-500/20"
            }
            ${isDisabled ? "opacity-50 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800" : ""}
            focus:outline-none focus:ring-2
            text-zinc-900 dark:text-zinc-100
            ${className ?? ""}
          `}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {description && !errorMessage && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        )}
        {errorMessage && (
          <p className="text-xs text-red-500 dark:text-red-400">{errorMessage}</p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
