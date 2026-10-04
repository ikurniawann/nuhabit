"use client";

import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { POS_STATION_OPTIONS } from "@/lib/pos/kitchen-station";

type ProductStationFieldProps = {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function ProductStationField({ value, onChange, disabled }: ProductStationFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="station" className="text-xs">
        Station <span className="text-red-500">*</span>
      </Label>
      <Combobox
        options={POS_STATION_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={value || ""}
        onChange={onChange}
        placeholder="Pilih station..."
        searchPlaceholder="Cari station..."
        emptyMessage="Station tidak ditemukan"
        disabled={disabled}
        className="h-9 text-sm"
      />
    </div>
  );
}
