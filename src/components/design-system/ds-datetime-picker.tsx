"use client";

import React, { useEffect, useRef, useState } from "react";
import flatpickr from "flatpickr";
import { CalendarIcon, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DsField } from "./ds-field";
import { dsFocusRing } from "./tokens";
import "flatpickr/dist/themes/light.css";
import "./ds-flatpickr.css";
import { Indonesian } from "flatpickr/dist/l10n/id.js";

export interface DsDateTimePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  showClear?: boolean;
  id?: string;
  /** Date only (default false = date + time) */
  dateOnly?: boolean;
  time24hr?: boolean;
}

function formatDisplay(value: string, dateOnly: boolean) {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(dateOnly
      ? {}
      : {
          hour: "2-digit",
          minute: "2-digit",
        }),
  });
}

export function DsDateTimePicker({
  value,
  onChange,
  label,
  hint,
  error,
  required,
  placeholder,
  className,
  disabled,
  minDate,
  maxDate,
  showClear = true,
  id,
  dateOnly = false,
  time24hr = true,
}: DsDateTimePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fpInstance = useRef<flatpickr.Instance | null>(null);
  const [displayValue, setDisplayValue] = useState(value ?? "");
  const generatedId = React.useId();
  const inputId = id ?? generatedId;

  useEffect(() => {
    if (!inputRef.current || fpInstance.current) return;

    fpInstance.current = flatpickr(inputRef.current, {
      enableTime: !dateOnly,
      dateFormat: dateOnly ? "Y-m-d" : "Y-m-d H:i",
      altInput: false,
      locale: Indonesian,
      disableMobile: true,
      time_24hr: time24hr,
      minDate,
      maxDate,
      defaultDate: value || undefined,
      onReady: (_dates, _dateStr, instance) => {
        instance.calendarContainer.classList.add("ds-flatpickr");
      },
      onChange: (_dates, dateStr) => {
        setDisplayValue(dateStr);
        onChange?.(dateStr);
      },
    });

    return () => {
      fpInstance.current?.destroy();
      fpInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (fpInstance.current && value !== undefined) {
      fpInstance.current.setDate(value, false);
      setDisplayValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (!fpInstance.current) return;
    fpInstance.current.set("minDate", minDate);
    fpInstance.current.set("maxDate", maxDate);
    if (disabled) fpInstance.current.close();
  }, [minDate, maxDate, disabled]);

  const openPicker = () => {
    if (!disabled) fpInstance.current?.open();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDisplayValue("");
    onChange?.("");
    fpInstance.current?.clear();
  };

  const control = (
    <div className="relative">
      <input ref={inputRef} id={inputId} type="text" className="sr-only" aria-hidden tabIndex={-1} />
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center rounded-lg border border-gray-200/80 bg-transparent px-3 text-left text-sm transition-colors outline-none",
          dsFocusRing,
          "hover:border-gray-300 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          !displayValue && "text-muted-foreground",
          error && "border-red-200/80 focus-visible:border-red-300 focus-visible:ring-red-100",
          showClear && displayValue && !disabled && "pr-9",
          className
        )}
      >
        {dateOnly ? (
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <Clock className="mr-2 h-4 w-4 shrink-0 text-gray-400" />
        )}
        <span className="truncate">
          {displayValue
            ? formatDisplay(displayValue, dateOnly)
            : placeholder ?? (dateOnly ? "Pilih tanggal..." : "Pilih tanggal & waktu...")}
        </span>
      </button>
      {showClear && displayValue && !disabled ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          tabIndex={-1}
          aria-label="Hapus"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  if (!label && !hint && !error) return control;

  return (
    <DsField label={label} htmlFor={inputId} required={required} hint={hint} error={error}>
      {control}
    </DsField>
  );
}
