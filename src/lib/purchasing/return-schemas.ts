import { z } from "zod";

const REASON_TYPES = [
  "damaged",
  "wrong_item",
  "expired",
  "overstock",
  "specification_mismatch",
  "other",
] as const;

const returnLineSchema = z.object({
  grn_item_id: z.string().uuid(),
  raw_material_id: z.string().uuid().nullish(),
  product_id: z.string().uuid().nullish(),
  qty_returned: z.number().positive(),
  unit_cost: z.number().min(0),
  batch_number: z.string().nullish(),
  expiry_date: z.string().nullish(),
  condition_notes: z.string().nullish(),
});

export type ReturnLineInput = z.infer<typeof returnLineSchema>;

export const returnUpdateSchema = z.object({
  return_date: z.string().min(1),
  reason_type: z.enum(REASON_TYPES),
  reason_notes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(returnLineSchema).min(1),
});

/** Header wajib dicek per module di service (pesan lama dipertahankan). */
export const returnCreateSchema = z.object({
  grn_id: z.string().nullish(),
  supplier_id: z.string().nullish(),
  vendor_id: z.string().nullish(),
  module_type: z.string().nullish(),
  return_date: z.string().nullish(),
  reason_type: z.enum(REASON_TYPES).nullish(),
  reason_notes: z.string().nullish(),
  notes: z.string().nullish(),
  items: z.array(returnLineSchema).nullish(),
});

export const returnRejectSchema = z.object({
  rejection_reason: z.string().nullish(),
});

/** Baris `purchase_return_items`; item retur selalu berstatus QC rejected. */
export function buildReturnItemRows(returnId: string, items: ReturnLineInput[]) {
  return items.map((item) => ({
    return_id: returnId,
    grn_item_id: item.grn_item_id,
    raw_material_id: item.raw_material_id || null,
    product_id: item.product_id || null,
    qty_returned: item.qty_returned,
    unit_cost: item.unit_cost,
    subtotal: item.qty_returned * item.unit_cost,
    batch_number: item.batch_number || null,
    expiry_date: item.expiry_date || null,
    condition_notes: item.condition_notes || null,
    qc_status: "rejected" as const,
  }));
}

/** Σ qty × harga satuan baris retur. */
export function sumReturnLines(items: Array<Pick<ReturnLineInput, "qty_returned" | "unit_cost">>): number {
  return items.reduce((sum, item) => sum + item.qty_returned * item.unit_cost, 0);
}
