"use client";

import type { RawMaterialUnitMode } from "@/lib/inventory/raw-material-units";

const UNIT_MODE_OPTIONS: {
  value: RawMaterialUnitMode;
  label: string;
  hint: string;
}[] = [
  { value: "besar", label: "Satuan besar", hint: "mis. Karung, Dus" },
  { value: "kecil", label: "Satuan kecil", hint: "mis. Kg, Pcs" },
];

/** Pilihan satuan hitung default untuk semua bahan yang punya konversi. */
export function UnitModeToggle({
  unitMode,
  disabled,
  onChange,
}: {
  unitMode: RawMaterialUnitMode;
  disabled: boolean;
  onChange: (mode: RawMaterialUnitMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-gray-200/80 p-0.5"
      role="radiogroup"
      aria-label="Satuan hitung"
    >
      {UNIT_MODE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={unitMode === opt.value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={
            "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:flex-none " +
            (unitMode === opt.value
              ? "bg-gray-900 text-white"
              : "text-gray-700 hover:bg-gray-50")
          }
        >
          {opt.label}
          <span
            className={
              "block text-[10px] font-normal " +
              (unitMode === opt.value ? "text-white/70" : "text-gray-400")
            }
          >
            {opt.hint}
          </span>
        </button>
      ))}
    </div>
  );
}
