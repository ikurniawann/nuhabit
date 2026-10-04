"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type NumericInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "prefix"
> & {
  value?: number | null;
  onValueChange: (value: number) => void;
  decimalScale?: number;
  allowNegative?: boolean;
  /** Label statis di sisi kiri input, mis. "Rp" untuk kolom nominal. */
  prefix?: React.ReactNode;
};

function sanitizeNumberInput(value: string, decimalScale: number, allowNegative: boolean) {
  let sanitized = value.replace(decimalScale > 0 ? /[^0-9,.-]/g : /[^0-9.-]/g, "");

  if (!allowNegative) {
    sanitized = sanitized.replace(/-/g, "");
  } else {
    sanitized = sanitized.replace(/(?!^)-/g, "");
  }

  const parts = sanitized.split(",");
  if (parts.length > 1) {
    sanitized = `${parts[0]},${parts.slice(1).join("").replace(/,/g, "")}`;
  }

  return sanitized;
}

function parseFormattedNumber(value: string, decimalScale: number, allowNegative: boolean) {
  const sanitized = sanitizeNumberInput(value, decimalScale, allowNegative);
  const normalized = sanitized
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number, decimalScale: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: decimalScale,
  }).format(value);
}

function formatDisplayValue(value: number | null | undefined, decimalScale: number) {
  return value === null || value === undefined ? "" : formatNumber(value, decimalScale);
}

function getFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function NumericInput({
  value,
  onValueChange,
  decimalScale = 4,
  allowNegative = false,
  className,
  onBlur,
  prefix,
  ...props
}: NumericInputProps) {
  const [displayValue, setDisplayValue] = React.useState(
    formatDisplayValue(value, decimalScale)
  );
  // Teks yang sedang diketik dipertahankan; baru ditimpa saat value/skala dari luar berubah.
  const [synced, setSynced] = React.useState({ value, decimalScale });
  if (synced.value !== value || synced.decimalScale !== decimalScale) {
    setSynced({ value, decimalScale });
    setDisplayValue(formatDisplayValue(value, decimalScale));
  }

  const input = (
    <Input
      {...props}
      type="text"
      inputMode={decimalScale > 0 ? "decimal" : "numeric"}
      value={displayValue}
      onChange={(event) => {
        const nextValue = sanitizeNumberInput(event.target.value, decimalScale, allowNegative);
        const parsed = parseFormattedNumber(nextValue, decimalScale, allowNegative);
        const max = getFiniteNumber(props.max);
        const clamped = max !== undefined && parsed > max ? max : parsed;

        setDisplayValue(clamped !== parsed ? formatNumber(clamped, decimalScale) : nextValue);
        onValueChange(clamped);
      }}
      onBlur={(event) => {
        const parsed = parseFormattedNumber(event.target.value, decimalScale, allowNegative);
        const max = getFiniteNumber(props.max);
        const clamped = max !== undefined && parsed > max ? max : parsed;
        setDisplayValue(event.target.value === "" ? "" : formatNumber(clamped, decimalScale));
        onBlur?.(event);
      }}
      className={cn(
        "text-left tabular-nums",
        prefix != null && "pl-9",
        className
      )}
    />
  );

  if (prefix == null) return input;

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-gray-500">
        {prefix}
      </span>
      {input}
    </div>
  );
}
