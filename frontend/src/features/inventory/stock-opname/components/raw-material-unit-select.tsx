"use client";

import { Combobox } from "@/components/ui/combobox";
import {
  getItemUnitModeOptions,
  type RawMaterialUnitInfo,
  type RawMaterialUnitMode,
} from "@/lib/inventory/raw-material-units";

type RawMaterialUnitSelectProps = {
  info: RawMaterialUnitInfo;
  value: RawMaterialUnitMode;
  onChange: (mode: RawMaterialUnitMode) => void;
  disabled?: boolean;
};

export function RawMaterialUnitSelect({
  info,
  value,
  onChange,
  disabled = false,
}: RawMaterialUnitSelectProps) {
  const options = getItemUnitModeOptions(info).map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  if (options.length <= 1) {
    return (
      <span className="text-sm text-gray-600">{options[0]?.label ?? "—"}</span>
    );
  }

  return (
    <Combobox
      value={value}
      onChange={(v) => onChange((v || "besar") as RawMaterialUnitMode)}
      options={options}
      placeholder="Pilih satuan"
      searchPlaceholder="Cari satuan..."
      emptyMessage="Satuan tidak ditemukan"
      disabled={disabled}
      className="h-9 min-w-[6.5rem] border-gray-200/80 text-sm"
    />
  );
}
