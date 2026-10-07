"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import type { ProductFormData, ProductOutputType } from "@/types/purchasing";
import { ProductOutputTypeField } from "./product-output-type-field";
import { ProductStationField } from "./product-station-field";

type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
};

type ProductInfoFieldsProps = {
  formData: ProductFormData;
  onChange: (patch: Partial<ProductFormData>) => void;
  stallOptions: ComboboxOption[];
  categoryOptions: ComboboxOption[];
  unitOptions: ComboboxOption[];
  warehousesLoading?: boolean;
  categoriesLoading?: boolean;
  unitsLoading?: boolean;
  disabled?: boolean;
};

export function ProductInfoFields({
  formData,
  onChange,
  stallOptions,
  categoryOptions,
  unitOptions,
  warehousesLoading = false,
  categoriesLoading = false,
  unitsLoading = false,
  disabled = false,
}: ProductInfoFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="nama" className="text-xs">
          Nama Produk <span className="text-red-500">*</span>
        </Label>
        <Input
          id="nama"
          value={formData.nama}
          onChange={(e) => onChange({ nama: e.target.value })}
          placeholder="Contoh: Roti Lava Cokelat"
          required
          disabled={disabled}
          className="h-9 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="warehouse_id" className="text-xs">
            Stall <span className="text-red-500">*</span>
          </Label>
          <Combobox
            options={stallOptions}
            value={formData.warehouse_id || ""}
            onChange={(warehouse_id) => onChange({ warehouse_id })}
            placeholder={warehousesLoading ? STALL_LABELS.loading : STALL_LABELS.selectPlaceholder}
            searchPlaceholder={STALL_LABELS.search}
            emptyMessage={STALL_LABELS.empty}
            disabled={warehousesLoading || disabled}
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kategori" className="text-xs">
            Kategori <span className="text-red-500">*</span>
          </Label>
          <Combobox
            options={categoryOptions}
            value={formData.kategori || ""}
            onChange={(kategori) => onChange({ kategori })}
            placeholder={categoriesLoading ? "Memuat kategori..." : "Pilih kategori..."}
            searchPlaceholder="Cari kategori..."
            emptyMessage="Kategori tidak ditemukan"
            disabled={categoriesLoading || disabled}
            allowClear
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="satuan_id" className="text-xs">
            Satuan <span className="text-red-500">*</span>
          </Label>
          <Combobox
            options={unitOptions}
            value={formData.satuan_id || ""}
            onChange={(satuan_id) => onChange({ satuan_id })}
            placeholder={unitsLoading ? "Memuat satuan..." : "Pilih satuan..."}
            searchPlaceholder="Cari satuan..."
            emptyMessage="Satuan tidak ditemukan"
            disabled={unitsLoading || disabled}
            className="h-9 text-sm"
          />
        </div>
        <ProductStationField
          value={formData.station}
          onChange={(station) => onChange({ station })}
          disabled={disabled}
        />
      </div>

      <ProductOutputTypeField
        value={(formData.production_output_type as ProductOutputType) || "FINISHED_GOOD"}
        onChange={(production_output_type) => onChange({ production_output_type })}
      />

      <div className="space-y-1.5">
        <Label htmlFor="deskripsi" className="text-xs">
          Deskripsi
        </Label>
        <Textarea
          id="deskripsi"
          value={formData.deskripsi}
          onChange={(e) => onChange({ deskripsi: e.target.value })}
          placeholder="Deskripsi produk..."
          rows={2}
          disabled={disabled}
          className="resize-none text-sm"
        />
      </div>
    </div>
  );
}
