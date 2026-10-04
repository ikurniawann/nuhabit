import { formatRupiah } from "@/lib/format";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export interface ProductionMaterialRow {
  id: string;
  raw_material_id: string;
  qty_planned?: Numeric;
  qty_actual?: Numeric;
  waste_qty?: Numeric;
  unit_cost?: Numeric;
  inventory_movement_id?: string | null;
  raw_material?: { kode?: string | null; nama?: string | null } | null;
}

export interface MaterialStockRow {
  id: string;
  qty_onhand?: Numeric;
  avg_cost?: Numeric;
  satuan_kecil_nama?: string | null;
  satuan_besar_nama?: string | null;
}

export interface StockCoverage {
  id: string;
  raw_material_id: string;
  kode: string;
  nama: string;
  required_qty: number;
  qty_onhand: number;
  shortage_qty: number;
  stock_status: "INSUFFICIENT" | "ENOUGH";
}

export type CoverageMode = "planned" | "actual";

/** Order yang sudah berjalan dihitung dari qty aktual; sisanya dari qty rencana. */
export function coverageModeForStatus(status: string): CoverageMode {
  return status === "IN_PROGRESS" || status === "COMPLETED" ? "actual" : "planned";
}

export function buildStockCoverage(
  materials: ProductionMaterialRow[],
  stockMap: Map<string, MaterialStockRow>,
  mode: CoverageMode = "planned"
): StockCoverage[] {
  return materials.map((material) => {
    const requiredQty =
      mode === "actual"
        ? toQty(material.qty_actual || material.qty_planned)
        : toQty(material.qty_planned);
    const qtyOnhand = toQty(stockMap.get(material.raw_material_id)?.qty_onhand);
    const shortageQty = Math.max(0, requiredQty - qtyOnhand);

    return {
      id: material.id,
      raw_material_id: material.raw_material_id,
      kode: material.raw_material?.kode || "",
      nama: material.raw_material?.nama || material.raw_material_id,
      required_qty: requiredQty,
      qty_onhand: qtyOnhand,
      shortage_qty: shortageQty,
      stock_status: shortageQty > 0 ? "INSUFFICIENT" : "ENOUGH",
    };
  });
}

export function nextProductionStep(status: string) {
  if (status === "DRAFT") return "Production order bisa di-release.";
  if (status === "RELEASED") return "Production order bisa dimulai.";
  if (status === "IN_PROGRESS") return "Production order bisa diselesaikan.";
  if (status === "COMPLETED") return "Production order sudah selesai.";
  if (status === "CANCELLED") return "Production order sudah dibatalkan.";
  return "Production order bisa dilanjutkan.";
}

/** Satu batch per order: nomor batch deterministik supaya complete ulang idempoten. */
export function batchNumber(orderNumber: string) {
  return `${orderNumber}-B01`;
}

export function buildWipCode(productCode?: string | null) {
  const base = (productCode || "WIP").replace(/[^A-Za-z0-9]/g, "").slice(0, 17);
  return `WP${base}`.slice(0, 20).toUpperCase();
}

/** PROD-YYYYMM untuk bulan berjalan (jam lokal server, seperti sebelumnya). */
export function productionNumberPrefix(now = new Date()) {
  return `PROD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function nextProductionNumber(prefix: string, lastNumber?: string | null) {
  const lastSequence = lastNumber?.split("-").pop();
  const next = Number.isFinite(Number(lastSequence)) ? Number(lastSequence) + 1 : 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export interface BomLine {
  raw_material_id: string;
  satuan_id: string | null;
  qty_required: Numeric;
  waste_factor: Numeric;
}

export interface PlannedMaterial {
  raw_material_id: string;
  satuan_id: string | null;
  qty_planned: number;
  qty_actual: number;
  waste_qty: number;
  unit_cost: number;
  total_cost: number;
}

/** Kebutuhan bahan = qty BOM x (1 + waste) x qty rencana, dinilai dengan avg cost stok. */
export function planMaterialsFromBom(
  bomLines: BomLine[],
  avgCostByMaterialId: Map<string, number>,
  plannedQty: number
): PlannedMaterial[] {
  return bomLines.map((line) => {
    const qtyPlanned = toQty(line.qty_required) * (1 + toQty(line.waste_factor)) * plannedQty;
    const unitCost = avgCostByMaterialId.get(line.raw_material_id) || 0;
    return {
      raw_material_id: line.raw_material_id,
      satuan_id: line.satuan_id,
      qty_planned: qtyPlanned,
      qty_actual: qtyPlanned,
      waste_qty: 0,
      unit_cost: unitCost,
      total_cost: qtyPlanned * unitCost,
    };
  });
}

export interface ConversionCosts {
  overhead_cost: number;
  labor_cost: number;
  packaging_cost: number;
  waste_cost: number;
}

export function sumConversionCosts(costs: ConversionCosts) {
  return costs.overhead_cost + costs.labor_cost + costs.packaging_cost + costs.waste_cost;
}

export function sumMaterialCost(materials: Array<{ total_cost: number }>) {
  return materials.reduce((sum, item) => sum + item.total_cost, 0);
}

export interface MaterialActualOverride {
  qty_actual: number;
  waste_qty?: number;
}

export interface MaterialConsumption extends ProductionMaterialRow {
  qtyActual: number;
  wasteQty: number;
  unitCost: number;
  totalCost: number;
}

/** Qty aktual per bahan: input user menang, lalu qty_actual tersimpan, lalu qty rencana. */
export function resolveMaterialConsumption(
  materials: ProductionMaterialRow[],
  overrides: Map<string, MaterialActualOverride>
): MaterialConsumption[] {
  return materials.map((material) => {
    const override = overrides.get(material.id);
    const qtyActual = override
      ? override.qty_actual
      : toQty(material.qty_actual || material.qty_planned);
    const wasteQty = override?.waste_qty || toQty(material.waste_qty);
    const unitCost = toQty(material.unit_cost);
    return { ...material, qtyActual, wasteQty, unitCost, totalCost: qtyActual * unitCost };
  });
}

/** Rata-rata tertimbang biaya stok barang jadi setelah output produksi masuk. */
export function weightedFinishedGoodsCost(
  currentQty: number,
  currentUnitCost: number,
  addedQty: number,
  addedTotalCost: number,
  fallbackUnitCost: number
) {
  const qtyAfter = currentQty + addedQty;
  return {
    qtyAfter,
    unitCost: qtyAfter > 0 ? (currentQty * currentUnitCost + addedTotalCost) / qtyAfter : fallbackUnitCost,
  };
}

/** posMarginPercentage null = HPP tidak disinkron ke POS (WIP / bahan baku). */
export function completionMessage(
  orderNumber: string,
  hppPerUnit: number,
  posMarginPercentage: number | null
) {
  const base = `Produksi ${orderNumber} selesai. HPP aktual ${formatRupiah(hppPerUnit)}`;
  return posMarginPercentage === null
    ? base
    : `${base} tersinkron ke POS. Margin POS ${posMarginPercentage}%.`;
}
