"use client";

import { Label } from "@/components/ui/label";
import type { ProductOutputType } from "@/types/purchasing";

type ProductOutputTypeFieldProps = {
  value: ProductOutputType;
  onChange: (value: ProductOutputType) => void;
};

export function ProductOutputTypeField({ value, onChange }: ProductOutputTypeFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Tipe Item</Label>
      <div className="grid h-9 max-w-md grid-cols-2 rounded-lg border border-gray-200/70 bg-muted/50 p-0.5">
        <button
          type="button"
          onClick={() => onChange("WIP")}
          className={`rounded-md text-xs font-semibold transition ${
            value === "WIP"
              ? "bg-card text-brand-text shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          WIP
        </button>
        <button
          type="button"
          onClick={() => onChange("FINISHED_GOOD")}
          className={`rounded-md text-xs font-semibold transition ${
            value === "FINISHED_GOOD"
              ? "bg-card text-brand-text shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Barang Jadi
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value === "WIP"
          ? "Output produksi default masuk stok WIP dan bisa dipakai sebagai komponen resep."
          : "Output produksi default masuk stok barang jadi."}
      </p>
    </div>
  );
}
