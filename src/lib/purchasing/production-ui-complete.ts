import { splitEvenly } from "@/lib/manufacturing/variant-output";
import { displayName, toNumber } from "./production-ui-display";
import type { ProductionDetail } from "./production-ui-types";

/** Isian form "Terima Output" (semua angka masih string dari input). */
export type CompleteForm = {
  actualQty: string;
  overheadCost: string;
  laborCost: string;
  packagingCost: string;
  wasteCost: string;
  materials: CompleteMaterialRow[];
  // EPIC-047 Fase 1B: rincian output per SKU, hanya untuk produk ber-varian.
  variantOutput: CompleteVariantRow[];
};

export type CompleteMaterialRow = {
  id: string;
  name: string;
  code: string;
  unitName: string;
  plannedQty: number;
  qtyActual: string;
  wasteQty: string;
  unitCost: number;
  stockQty: number;
};

export type CompleteVariantRow = { posSkuId: string; sku: string; name: string; qty: string };

export type CompleteHeaderField = "actualQty" | "overheadCost" | "laborCost" | "packagingCost" | "wasteCost";

export const COMPLETE_HEADER_FIELDS: Array<{ field: CompleteHeaderField; label: string }> = [
  { field: "actualQty", label: "Output Aktual" },
  { field: "overheadCost", label: "Overhead" },
  { field: "laborCost", label: "Tenaga Kerja" },
  { field: "packagingCost", label: "Kemasan" },
  { field: "wasteCost", label: "Biaya Susut" },
];

export type CompleteFormAction =
  | { type: "setField"; field: CompleteHeaderField; value: string }
  | { type: "setMaterial"; id: string; field: "qtyActual" | "wasteQty"; value: string }
  | { type: "setVariantQty"; posSkuId: string; value: string }
  | { type: "splitEvenly" };

export function initCompleteForm(order: ProductionDetail): CompleteForm {
  return {
    actualQty: String(toNumber(order.actual_qty) || toNumber(order.planned_qty)),
    overheadCost: String(toNumber(order.overhead_cost)),
    laborCost: String(toNumber(order.labor_cost)),
    packagingCost: String(toNumber(order.packaging_cost)),
    wasteCost: String(toNumber(order.waste_cost)),
    materials: order.materials.map((material) => ({
      id: material.id,
      name: displayName(material.raw_material?.nama) || material.raw_material_id,
      code: material.raw_material?.kode || material.raw_material_id,
      unitName: material.satuan?.nama || "",
      plannedQty: toNumber(material.qty_planned),
      qtyActual: String(toNumber(material.qty_actual || material.qty_planned)),
      wasteQty: String(toNumber(material.waste_qty)),
      unitCost: toNumber(material.unit_cost),
      stockQty: toNumber(material.stock?.qty_onhand),
    })),
    variantOutput: (order.pos_skus || []).map((sku) => ({
      posSkuId: sku.id,
      sku: sku.sku,
      name: sku.name,
      qty: "0",
    })),
  };
}

export function completeFormReducer(state: CompleteForm, action: CompleteFormAction): CompleteForm {
  switch (action.type) {
    case "setField":
      return { ...state, [action.field]: action.value };
    case "setMaterial":
      return {
        ...state,
        materials: state.materials.map((row) =>
          row.id === action.id ? { ...row, [action.field]: action.value } : row
        ),
      };
    case "setVariantQty":
      return {
        ...state,
        variantOutput: state.variantOutput.map((row) =>
          row.posSkuId === action.posSkuId ? { ...row, qty: action.value } : row
        ),
      };
    case "splitEvenly": {
      const split = splitEvenly(
        toNumber(state.actualQty),
        state.variantOutput.map((row) => row.posSkuId)
      );
      const qtyBySku = new Map(split.map((row) => [row.pos_sku_id, row.qty]));
      return {
        ...state,
        variantOutput: state.variantOutput.map((row) => ({
          ...row,
          qty: String(qtyBySku.get(row.posSkuId) ?? 0),
        })),
      };
    }
  }
}

/** Pratinjau HPP: bahan aktual × biaya satuan + biaya tambahan, dibagi output aktual. */
export function completePreview(form: CompleteForm) {
  const materialCost = form.materials.reduce(
    (sum, material) => sum + toNumber(material.qtyActual) * material.unitCost,
    0
  );
  const overheadCost = toNumber(form.overheadCost);
  const laborCost = toNumber(form.laborCost);
  const packagingCost = toNumber(form.packagingCost);
  const wasteCost = toNumber(form.wasteCost);
  const totalCost = materialCost + overheadCost + laborCost + packagingCost + wasteCost;
  const actualQty = toNumber(form.actualQty);
  return {
    actualQty,
    materialCost,
    overheadCost,
    laborCost,
    packagingCost,
    wasteCost,
    totalCost,
    hppPerUnit: actualQty > 0 ? totalCost / actualQty : 0,
    shortageItems: form.materials.filter((material) => toNumber(material.qtyActual) > material.stockQty),
  };
}

export type CompletePreview = ReturnType<typeof completePreview>;

/** Sisa = output aktual − Σ qty per varian; harus 0 (2 desimal) sebelum submit. */
export function variantRemainder(form: CompleteForm): number {
  const split = form.variantOutput.reduce((sum, row) => sum + toNumber(row.qty), 0);
  return toNumber(form.actualQty) - split;
}

export function isVariantBalanced(remainder: number): boolean {
  return Math.round(remainder * 100) / 100 === 0;
}

export function canSubmitComplete(form: CompleteForm, variantRequired: boolean): boolean {
  const preview = completePreview(form);
  return (
    preview.actualQty > 0 &&
    preview.shortageItems.length === 0 &&
    (!variantRequired || isVariantBalanced(variantRemainder(form)))
  );
}

export function buildCompletePayload(form: CompleteForm, variantRequired: boolean) {
  return {
    action: "complete" as const,
    actual_qty: toNumber(form.actualQty),
    overhead_cost: toNumber(form.overheadCost),
    labor_cost: toNumber(form.laborCost),
    packaging_cost: toNumber(form.packagingCost),
    waste_cost: toNumber(form.wasteCost),
    materials: form.materials.map((material) => ({
      id: material.id,
      qty_actual: toNumber(material.qtyActual),
      waste_qty: toNumber(material.wasteQty),
    })),
    ...(variantRequired
      ? {
          variant_output: form.variantOutput
            .filter((row) => toNumber(row.qty) > 0)
            .map((row) => ({ pos_sku_id: row.posSkuId, qty: toNumber(row.qty) })),
        }
      : {}),
  };
}
