import { toNumber } from "./production-ui-display";
import type {
  CogsData,
  CogsMaterial,
  CreateProductionOrderPayload,
  ProductionDetail,
  ProductionProduct,
} from "./production-ui-types";

export type AdditionalCostType = "OVERHEAD" | "LABOR" | "PACKAGING" | "OTHER";

export type AdditionalCostLine = {
  id: string;
  description: string;
  type: AdditionalCostType;
  amount: string;
};

export const ADDITIONAL_COST_TYPES: Array<{ value: AdditionalCostType; label: string }> = [
  { value: "OVERHEAD", label: "Overhead" },
  { value: "LABOR", label: "Tenaga Kerja" },
  { value: "PACKAGING", label: "Kemasan" },
  { value: "OTHER", label: "Lainnya" },
];

export function createAdditionalCostLine(id: string = crypto.randomUUID()): AdditionalCostLine {
  return { id, description: "", type: "OVERHEAD", amount: "" };
}

/** API hanya punya kolom overhead/labor/packaging; tipe "Lainnya" ikut overhead. Nominal negatif diabaikan. */
export function aggregateAdditionalCosts(lines: AdditionalCostLine[]) {
  let overhead = 0;
  let labor = 0;
  let packaging = 0;
  for (const line of lines) {
    const amount = Math.max(0, toNumber(line.amount));
    if (line.type === "LABOR") labor += amount;
    else if (line.type === "PACKAGING") packaging += amount;
    else overhead += amount;
  }
  return { overhead, labor, packaging, total: overhead + labor + packaging };
}

export type CostTotals = ReturnType<typeof aggregateAdditionalCosts>;

/** Kebutuhan dan biaya satu baris BOM untuk `plannedQty` unit output. */
export function bomLineRequirement(material: CogsMaterial, plannedQty: number) {
  const required = material.effective_qty * plannedQty;
  return {
    required,
    lineTotal: material.subtotal * plannedQty,
    shortage: Math.max(0, required - material.qty_available),
  };
}

/** Pratinjau HPP order baru: biaya bahan BOM × qty + biaya tambahan, dibagi qty. */
export function estimateProductionOrder(
  cogs: CogsData | null | undefined,
  plannedQty: number,
  additionalCosts: number
) {
  const materials = cogs?.breakdown_bahan ?? [];
  const materialCost = toNumber(cogs?.total_bom_cost) * plannedQty;
  const totalCost = materialCost + additionalCosts;
  return {
    materialCost,
    totalCost,
    hppPerUnit: plannedQty > 0 ? totalCost / plannedQty : 0,
    shortages: materials.filter((material) => bomLineRequirement(material, plannedQty).shortage > 0),
  };
}

export function buildCreateOrderPayload(
  isProduct: boolean,
  item: ProductionProduct,
  plannedQty: number,
  costs: CostTotals
): CreateProductionOrderPayload {
  const shared = {
    planned_qty: plannedQty,
    overhead_cost: costs.overhead,
    labor_cost: costs.labor,
    packaging_cost: costs.packaging,
  };
  return isProduct
    ? {
        production_context: "product",
        product_id: item.id,
        output_type: item.production_output_type === "WIP" ? "WIP" : "FINISHED_GOOD",
        ...shared,
      }
    : { production_context: "raw_material", raw_material_id: item.id, ...shared };
}

/** Jumlah bahan yang stoknya kurang menurut cek stok terakhir order. */
export function countShortMaterials(detail: Pick<ProductionDetail, "materials">): number {
  return detail.materials.filter((material) => toNumber(material.stock?.shortage_qty) > 0).length;
}

/**
 * Payload "complete" dari daftar order: memakai qty & biaya yang tersimpan
 * (aktual bila sudah diisi, kalau belum rencana).
 */
export function buildQuickCompletePayload(detail: ProductionDetail) {
  return {
    action: "complete" as const,
    actual_qty: toNumber(detail.actual_qty) || toNumber(detail.planned_qty),
    overhead_cost: toNumber(detail.overhead_cost),
    labor_cost: toNumber(detail.labor_cost),
    packaging_cost: toNumber(detail.packaging_cost),
    waste_cost: toNumber(detail.waste_cost),
    materials: detail.materials.map((material) => ({
      id: material.id,
      qty_actual: toNumber(material.qty_actual || material.qty_planned),
      waste_qty: toNumber(material.waste_qty),
    })),
  };
}
