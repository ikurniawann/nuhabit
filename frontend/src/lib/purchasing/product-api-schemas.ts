// Skema body API master produk (/api/purchasing/products).
import { z } from "zod";
import { POS_STATIONS } from "@/lib/pos/kitchen-station";

export const productCreateSchema = z.object({
  kode: z.string().max(20).optional(),
  nama: z.string().min(1, "Nama produk wajib diisi").max(100),
  deskripsi: z.string().optional(),
  kategori: z.string().optional(),
  satuan_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid("Stall wajib dipilih"),
  harga_jual: z.coerce.number().min(0).default(0),
  harga_modal: z.coerce.number().min(0).optional(),
  markup_persen: z.coerce.number().optional(),
  production_output_type: z.enum(["FINISHED_GOOD", "WIP"]).default("FINISHED_GOOD").optional(),
  station: z.enum(POS_STATIONS).default("kitchen").optional(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  deskripsi: z.string().optional().nullable(),
  kategori: z.string().optional().nullable(),
  satuan_id: z.string().uuid().optional().nullable(),
  warehouse_id: z.string().uuid().optional(),
  harga_jual: z.coerce.number().min(0).optional(),
  harga_modal: z.coerce.number().min(0).optional(),
  markup_persen: z.coerce.number().optional(),
  is_active: z.boolean().optional(),
  production_output_type: z.enum(["FINISHED_GOOD", "WIP"]).optional(),
  station: z.enum(POS_STATIONS).optional().nullable(),
});

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
