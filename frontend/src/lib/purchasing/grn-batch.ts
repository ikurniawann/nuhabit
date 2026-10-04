import { z } from "zod";
import { defaultExpiryDate } from "@/lib/inventory/batches";

/** Kolom batch per baris GRN (grn_items.batch_number / expiry_date). */
export const grnBatchFields = {
  batch_number: z.string().trim().max(100, "Nomor batch maksimal 100 karakter").optional().nullable(),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal kedaluwarsa YYYY-MM-DD")
    .optional()
    .nullable(),
};

/**
 * Nomor batch & tanggal kedaluwarsa yang disimpan untuk satu baris GRN. Bila
 * supplier tidak memberi tanggal, pakai tanggal terima + shelf_life_days.
 */
export function resolveGrnLineBatch(
  line: { batch_number?: string | null; expiry_date?: string | null },
  shelfLifeDays: number | null | undefined,
  receivedOn: string
): { batch_number: string | null; expiry_date: string | null } {
  return {
    batch_number: line.batch_number?.trim() || null,
    expiry_date: line.expiry_date || defaultExpiryDate(receivedOn, shelfLifeDays),
  };
}
