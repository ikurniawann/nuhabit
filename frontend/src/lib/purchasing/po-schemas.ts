import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalDateSchema = z
  .union([z.string().regex(ISO_DATE), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

const sourceTypeSchema = z
  .enum(["manual", "production_order", "low_stock"])
  .optional()
  .default("manual");

const poHeaderFields = {
  pr_id: z.string().uuid().optional(),
  tanggal_kirim_estimasi: optionalDateSchema,
  catatan: z.string().optional(),
  alamat_pengiriman: z.string().optional(),
  diskon_persen: z.number().min(0).max(100).default(0),
  diskon_nominal: z.number().min(0).default(0),
  ppn_persen: z.number().min(0).max(100).default(11),
  source_type: sourceTypeSchema,
};

const poLineFields = {
  pr_item_id: z.string().uuid().optional(),
  satuan_id: z.string().uuid().optional(),
  notes: z.string().optional(),
};

/** PO bahan baku (pemasok = `suppliers`). */
export const rawMaterialPoCreateSchema = z.object({
  ...poHeaderFields,
  supplier_id: z.string().uuid("Supplier wajib dipilih"),
  tanggal_po: z.string().regex(ISO_DATE, "Format tanggal: YYYY-MM-DD"),
  production_order_id: z.string().uuid().optional().nullable(),
  source_reference: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        ...poLineFields,
        raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
        qty_ordered: z.number().min(0.0001, "Jumlah pesanan minimal 0.0001"),
        harga_satuan: z.number().min(0, "Harga tidak boleh negatif"),
      })
    )
    .min(1, "Minimal 1 item PO"),
});

/** PO produk (pemasok = `vendors`); baris ber-varian memilih SKU (EPIC-047). */
export const productPoCreateSchema = z.object({
  ...poHeaderFields,
  vendor_id: z.string().uuid("Vendor is required"),
  tanggal_po: z.string().regex(ISO_DATE, "Date format must be YYYY-MM-DD"),
  items: z
    .array(
      z.object({
        ...poLineFields,
        product_id: z.string().uuid("Product is required"),
        qty_ordered: z.number().min(0.0001, "Order quantity must be at least 0.0001"),
        harga_satuan: z.number().min(0, "Price cannot be negative"),
        pos_sku_id: z.string().uuid().optional().nullable(),
      })
    )
    .min(1, "At least one PO item is required"),
});

/** PO barang operasional (EPIC-026 B3): pemasok REUSE `vendors`, item = `supply_item_id`. */
export const generalPoCreateSchema = z.object({
  ...poHeaderFields,
  vendor_id: z.string().uuid("Vendor wajib dipilih"),
  tanggal_po: z.string().regex(ISO_DATE, "Format tanggal: YYYY-MM-DD"),
  items: z
    .array(
      z.object({
        ...poLineFields,
        supply_item_id: z.string().uuid("Barang operasional wajib dipilih"),
        qty_ordered: z.number().min(0.0001, "Jumlah pesanan minimal 0.0001"),
        harga_satuan: z.number().min(0, "Harga tidak boleh negatif"),
      })
    )
    .min(1, "Minimal 1 item PO"),
});

export type PoCreateInput =
  | z.infer<typeof rawMaterialPoCreateSchema>
  | z.infer<typeof productPoCreateSchema>
  | z.infer<typeof generalPoCreateSchema>;
export type PoCreateLine = PoCreateInput["items"][number];

export const poUpdateSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  tanggal_po: z.string().regex(ISO_DATE).optional(),
  tanggal_kirim_estimasi: z.string().regex(ISO_DATE).optional().nullable(),
  catatan: z.string().optional().nullable(),
  alamat_pengiriman: z.string().optional().nullable(),
  diskon_persen: z.number().min(0).max(100).optional(),
  diskon_nominal: z.number().min(0).optional(),
  ppn_persen: z.number().min(0).max(100).optional(),
});

export const poItemCreateSchema = z.object({
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  pr_item_id: z.string().uuid().optional(),
  qty_ordered: z.number().min(0.0001, "Jumlah pesanan minimal 0.0001"),
  satuan_id: z.string().uuid().optional(),
  harga_satuan: z.number().min(0, "Harga tidak boleh negatif"),
  diskon_item: z.number().min(0).default(0),
  catatan: z.string().optional(),
});

export const poItemUpdateSchema = z.object({
  qty_ordered: z.number().min(0.0001).optional(),
  satuan_id: z.string().uuid().optional().nullable(),
  harga_satuan: z.number().min(0).optional(),
  diskon_item: z.number().min(0).optional(),
  catatan: z.string().optional().nullable(),
});

export const poPaymentTermSchema = z.object({
  term_no: z.number().int().min(1).optional(),
  description: z.string().min(1).default("Termin"),
  due_date: z.string().regex(ISO_DATE),
  amount: z.number().min(0),
  notes: z.string().optional().nullable(),
});

export const poSendSchema = z.object({
  sent_via: z.enum(["EMAIL", "WHATSAPP", "PRINT", "OTHER"]),
});

export const poCancelSchema = z.object({
  reason: z.string().min(1, "Alasan pembatalan wajib diisi"),
});

export const poCloseSchema = z.object({
  reason: z.string().min(1, "Alasan penutupan wajib diisi"),
});
