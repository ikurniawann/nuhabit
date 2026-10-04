import type { RawMaterialWithStock } from "@/types/purchasing";

/**
 * Inventory keeps quantity and unit cost in the material base unit: satuan kecil
 * when the material defines one, otherwise satuan besar. Reference fields on the
 * material itself (harga_beli, stok_minimum, stok_maximum) are kept per satuan besar.
 */
export interface RawMaterialUnitInfo {
  baseUnitName: string;
  largeUnitName: string;
  smallUnitName: string;
  konversiFactor: number;
  hasSmallUnit: boolean;
}

export function getRawMaterialUnitInfo(
  material: Partial<
    Pick<
      RawMaterialWithStock,
      "satuan_besar_nama" | "satuan_kecil_nama" | "satuan_kecil_id" | "konversi_factor"
    >
  > & { satuan_besar?: { nama?: string | null } | null }
): RawMaterialUnitInfo {
  const largeUnitName = material.satuan_besar_nama || material.satuan_besar?.nama || "-";
  const smallUnitName = material.satuan_kecil_nama || "-";
  const hasSmallUnit = Boolean(material.satuan_kecil_id);
  const konversiFactor = Number(material.konversi_factor || 1) || 1;

  return {
    baseUnitName: hasSmallUnit ? smallUnitName : largeUnitName,
    largeUnitName,
    smallUnitName,
    konversiFactor: hasSmallUnit ? konversiFactor : 1,
    hasSmallUnit,
  };
}

/** Converts a base-unit quantity into the equivalent satuan besar quantity. */
export function baseToLargeUnit(qtyBase: number, konversiFactor: number) {
  if (konversiFactor <= 0) return qtyBase;
  return qtyBase / konversiFactor;
}

/** Converts a satuan besar quantity into the equivalent base-unit quantity. */
export function largeToBaseUnit(qtyLarge: number, konversiFactor: number) {
  return qtyLarge * (konversiFactor > 0 ? konversiFactor : 1);
}
