// Biaya baris BOM (resep produk & komponen bahan baku). Murni, tanpa DB.

type Numeric = number | string | null | undefined;

/** Baris v_raw_materials_stock yang dipakai untuk harga bahan. */
export interface StockCostRow {
  id: string;
  avg_cost?: Numeric;
  konversi_factor?: Numeric;
  satuan_kecil_id?: string | null;
}

/** Harga cadangan dari embed raw_material bila bahan tak ada di view stok. */
export interface BomMaterialPrice {
  avg_cost?: Numeric;
  harga_avg?: Numeric;
  harga_terakhir?: Numeric;
  konversi_factor?: Numeric;
  satuan_kecil_id?: string | null;
}

export interface BomCostLine {
  qty_required?: Numeric;
  waste_factor?: Numeric;
}

/**
 * Harga acuan disimpan per satuan BESAR; BOM memakai qty satuan KECIL, jadi
 * biaya dibagi konversi_factor bila bahan punya satuan kecil.
 */
export function normalizeToSmallUnit(
  baseCost: number,
  konversiFactor?: Numeric,
  satuanKecilId?: string | null
): number {
  const factor = Number(konversiFactor ?? 0);
  if (satuanKecilId && factor > 0) return baseCost / factor;
  return baseCost;
}

/** id bahan → harga per unit; `perSmallUnit` menormalkan ke satuan kecil. */
export function buildStockCostMap(
  rows: readonly StockCostRow[],
  perSmallUnit: boolean
): Map<string, number> {
  return new Map(
    rows.map((row) => {
      const cost = Number(row.avg_cost ?? 0);
      return [
        row.id,
        perSmallUnit ? normalizeToSmallUnit(cost, row.konversi_factor, row.satuan_kecil_id) : cost,
      ];
    })
  );
}

/** avg_cost → harga_avg → harga_terakhir dari master bahan. */
export function fallbackMaterialCost(
  material: BomMaterialPrice | null | undefined,
  perSmallUnit: boolean
): number {
  const cost = Number(
    material?.avg_cost ?? material?.harga_avg ?? material?.harga_terakhir ?? 0
  );
  return perSmallUnit
    ? normalizeToSmallUnit(cost, material?.konversi_factor, material?.satuan_kecil_id)
    : cost;
}

/** qty × (1 + waste) */
export function qtyWithWaste(line: BomCostLine): number {
  return Number(line.qty_required ?? 0) * (1 + Number(line.waste_factor ?? 0));
}

/** Tambah cost_per_unit & total_cost per baris, plus total seluruh baris. */
export function costBomLines<T extends BomCostLine>(
  lines: readonly T[],
  costPerUnitOf: (line: T) => number
): { lines: Array<T & { cost_per_unit: number; total_cost: number }>; total: number } {
  let total = 0;
  const costed = lines.map((line) => {
    const costPerUnit = costPerUnitOf(line);
    const totalCost = costPerUnit * qtyWithWaste(line);
    total += totalCost;
    return { ...line, cost_per_unit: costPerUnit, total_cost: totalCost };
  });
  return { lines: costed, total };
}
