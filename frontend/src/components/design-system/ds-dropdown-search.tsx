"use client";

import * as React from "react";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { DsField } from "./ds-field";

export type DsDropdownOption = ComboboxOption;

export interface DsDropdownSearchProps extends ComboboxProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

export function DsDropdownSearch({
  label,
  hint,
  error,
  required,
  className,
  ...props
}: DsDropdownSearchProps) {
  const control = (
    <Combobox
      {...props}
      className={cn(
        error && "border-red-200/80 focus-visible:border-red-300 focus-visible:ring-red-100",
        className
      )}
    />
  );

  if (!label && !hint && !error) return control;

  return (
    <DsField label={label} required={required} hint={hint} error={error}>
      {control}
    </DsField>
  );
}
