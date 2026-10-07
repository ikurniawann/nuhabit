"use client";

import React, { useEffect, useRef, useState } from "react";
import flatpickr from "flatpickr";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import "flatpickr/dist/themes/light.css";
import { Indonesian } from "flatpickr/dist/l10n/id.js";

interface DatePickerProps {
  value?: string;
  onChange?: (date: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  showClear?: boolean;
  id?: string;
  variant?: "outline" | "neutral";
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pilih tanggal...",
  className,
  disabled,
  minDate,
  maxDate,
  showClear = true,
  id,
  variant = "outline",
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [displayDate, setDisplayDate] = useState<string>(value || "");
  const fpInstance = useRef<flatpickr.Instance | null>(null);
  // flatpickr dibuat sekali; callback & nilai awal dibaca lewat ref agar selalu terbaru.
  const onChangeRef = useRef(onChange);
  const initialRef = useRef({ value, minDate, maxDate });
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Initialize flatpickr
  useEffect(() => {
    if (inputRef.current && !fpInstance.current) {
      const { value, minDate, maxDate } = initialRef.current;
      // Get today's date in Jakarta timezone
      const today = new Date();
      const jakartaTime = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      
      fpInstance.current = flatpickr(inputRef.current, {
        dateFormat: "Y-m-d", // ISO format for easier parsing
        altFormat: "d M Y", // Display format
        altInput: true, // Use alternate input for display
        locale: Indonesian,
        disableMobile: true,
        minDate: minDate,
        maxDate: maxDate,
        defaultDate: value || jakartaTime, // Force Jakarta timezone
        onChange: (selectedDates, dateStr) => {
          setDisplayDate(dateStr);
          onChangeRef.current?.(dateStr);
        },
      });
    }

    return () => {
      if (fpInstance.current) {
        fpInstance.current.destroy();
        fpInstance.current = null;
      }
    };
  }, []);

  // Update flatpickr when external value changes
  useEffect(() => {
    if (fpInstance.current && value !== undefined) {
      fpInstance.current.setDate(value, true);
      setDisplayDate(value);
    }
  }, [value]);

  // Update flatpickr config
  useEffect(() => {
    if (fpInstance.current) {
      fpInstance.current.set("minDate", minDate);
      fpInstance.current.set("maxDate", maxDate);
      if (disabled) {
        fpInstance.current.close();
      }
    }
  }, [minDate, maxDate, disabled]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDisplayDate("");
    onChange?.("");
    if (fpInstance.current) {
      fpInstance.current.clear();
    }
  };

  const openCalendar = () => {
    if (!disabled && fpInstance.current) {
      fpInstance.current.open();
    }
  };

  return (
    <div className="relative">
      {/* Hidden input for flatpickr */}
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="sr-only"
        aria-label={placeholder}
      />
      
      {/* Visible button that triggers calendar */}
      <Button
        variant={variant === "neutral" ? "ghost" : "outline"}
        className={cn(
          "w-full justify-start text-left font-normal h-9 text-sm cursor-pointer",
          variant === "neutral" &&
            "border border-gray-300 bg-white text-gray-900 shadow-xs hover:!border-gray-300 hover:!bg-white hover:!text-gray-900 focus-visible:!border-gray-400 focus-visible:!ring-gray-100 aria-expanded:!border-gray-300 aria-expanded:!bg-white aria-expanded:!text-gray-900 [&_svg]:text-gray-400",
          !displayDate && "text-muted-foreground",
          className
        )}
        type="button"
        disabled={disabled}
        onClick={openCalendar}
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {displayDate ? (
          <span>{displayDate}</span>
        ) : (
          <span>{placeholder}</span>
        )}
      </Button>
      
      {/* Clear button */}
      {showClear && displayDate && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer z-10"
          tabIndex={-1}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
