import type { ProductWithCOGS, Unit } from "@/types/purchasing";

export function mapUnitComboboxOptions(units: Unit[]) {
  return units
    .filter((unit) => unit.is_active !== false)
    .map((unit) => ({
      value: unit.id,
      label: unit.nama,
      description: unit.simbol || unit.kode || undefined,
    }));
}

export function getProductUnitLabel(product?: Pick<ProductWithCOGS, "satuan_nama" | "unit"> | null) {
  return product?.satuan_nama || product?.unit?.nama || "—";
}
