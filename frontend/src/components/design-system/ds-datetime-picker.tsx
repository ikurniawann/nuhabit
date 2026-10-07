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
import { formatDate, formatDateTime } from "@/lib/format";

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

/** Nilai flatpickr ("Y-m-d" / "Y-m-d H:i") → teks tampilan WIB. */
function formatDisplay(value: string, dateOnly: boolean) {
  if (!value) return "";
  return dateOnly ? formatDate(value, value) : formatDateTime(value.replace(" ", "T"), value);
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
  // Terkontrol bila `value` diberikan; selain itu ingat pilihan terakhir sendiri.
  const [internalValue, setInternalValue] = useState("");
  const displayValue = value ?? internalValue;
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Instance flatpickr dibuat ulang hanya bila mode tanggal/jam berubah;
  // value, min/max, dan disabled disinkronkan lewat efek di bawah.
  useEffect(() => {
    if (!inputRef.current) return;
    const instance = flatpickr(inputRef.current, {
      enableTime: !dateOnly,
      dateFormat: dateOnly ? "Y-m-d" : "Y-m-d H:i",
      altInput: false,
      locale: Indonesian,
      disableMobile: true,
      time_24hr: time24hr,
      onReady: (_dates, _dateStr, fp) => {
        fp.calendarContainer.classList.add("ds-flatpickr");
      },
      onChange: (_dates, dateStr) => {
        setInternalValue(dateStr);
        onChangeRef.current?.(dateStr);
      },
    });
    fpInstance.current = instance;
    return () => {
      instance.destroy();
      fpInstance.current = null;
    };
  }, [dateOnly, time24hr]);

  useEffect(() => {
    if (fpInstance.current && value !== undefined) fpInstance.current.setDate(value, false);
  }, [value, dateOnly, time24hr]);

  useEffect(() => {
    if (!fpInstance.current) return;
    fpInstance.current.set("minDate", minDate);
    fpInstance.current.set("maxDate", maxDate);
    if (disabled) fpInstance.current.close();
  }, [minDate, maxDate, disabled, dateOnly, time24hr]);

  const openPicker = () => {
    if (!disabled) fpInstance.current?.open();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInternalValue("");
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
