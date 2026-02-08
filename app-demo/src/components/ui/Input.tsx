"use client";

import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  placeholder?: string;
  description?: string;
  errorMessage?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  isRequired?: boolean;
  isVisible?: boolean; // Will be filtered out
  value?: string | number;
  onValueChange?: (value: string) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      placeholder,
      description,
      errorMessage,
      isInvalid,
      isDisabled,
      isReadOnly,
      isRequired,
      isVisible: _isVisible, // Filter out - not passed to DOM
      value,
      onValueChange,
      className,
      type = "text",
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
        <input
          ref={ref}
          type={type}
          value={value ?? ""}
          onChange={(e) => onValueChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={isDisabled}
          readOnly={isReadOnly}
          className={`
            w-full px-3 py-2 rounded-lg border transition-colors
            bg-white dark:bg-zinc-900
            ${isInvalid 
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" 
              : "border-zinc-300 dark:border-zinc-700 focus:border-blue-500 focus:ring-blue-500/20"
            }
            ${isDisabled ? "opacity-50 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800" : ""}
            ${isReadOnly ? "bg-zinc-50 dark:bg-zinc-800 cursor-default" : ""}
            focus:outline-none focus:ring-2
            placeholder:text-zinc-400 dark:placeholder:text-zinc-500
            text-zinc-900 dark:text-zinc-100
            ${className ?? ""}
          `}
        />
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

Input.displayName = "Input";
