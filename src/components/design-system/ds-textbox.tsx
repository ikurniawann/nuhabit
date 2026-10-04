"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DsField } from "./ds-field";
import { dsFocusRing } from "./tokens";

export type DsTextboxSize = "sm" | "md" | "lg";

const sizeClasses: Record<DsTextboxSize, string> = {
  sm: "h-8 text-xs",
  md: "h-9 text-sm",
  lg: "h-10 text-sm",
};

export interface DsTextboxProps extends Omit<React.ComponentProps<typeof Input>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  size?: DsTextboxSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  wrapperClassName?: string;
}

export const DsTextbox = React.forwardRef<HTMLInputElement, DsTextboxProps>(
  (
    {
      label,
      hint,
      error,
      required,
      size = "md",
      leftIcon,
      rightIcon,
      className,
      wrapperClassName,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const hasError = Boolean(error);

    const input = (
      <div className={cn("relative", wrapperClassName)}>
        {leftIcon ? (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
            {leftIcon}
          </span>
        ) : null}
        <Input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          className={cn(
            sizeClasses[size],
            dsFocusRing,
            leftIcon && "pl-9",
            rightIcon && "pr-9",
            hasError && "border-red-200/80 focus-visible:border-red-300 focus-visible:ring-red-100",
            className
          )}
          {...props}
        />
        {rightIcon ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-400">
            {rightIcon}
          </span>
        ) : null}
      </div>
    );

    if (!label && !hint && !error) return input;

    return (
      <DsField
        label={label}
        htmlFor={inputId}
        required={required}
        hint={hint}
        error={error}
      >
        {input}
      </DsField>
    );
  }
);
DsTextbox.displayName = "DsTextbox";
