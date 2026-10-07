// Skema body API BOM: resep produk (bom_items) & komponen bahan baku
// (raw_material_bom_items). Klien lama mengirim qty_needed / waste_persen.
import { z } from "zod";

/** POST /products/:id/bom */
export const productBomCreateSchema = z
  .object({
    raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
    qty_required: z.number().min(0.0001, "Jumlah harus lebih dari 0").optional(),
    qty_needed: z.number().min(0.0001, "Jumlah harus lebih dari 0").optional(),
    satuan_id: z.string().uuid().nullable().optional(),
    waste_factor: z.number().min(0).max(1).optional(),
    waste_persen: z.number().min(0).max(100).optional(),
  })
  .transform((value) => ({
    raw_material_id: value.raw_material_id,
    qty_required: value.qty_required ?? value.qty_needed ?? 0,
    satuan_id: value.satuan_id || null,
    waste_factor: value.waste_factor ?? (value.waste_persen ?? 0) / 100,
  }))
  .refine((value) => value.qty_required > 0, {
    message: "Jumlah harus lebih dari 0",
    path: ["qty_required"],
  });

export type ProductBomCreateInput = z.infer<typeof productBomCreateSchema>;

/** PUT /bom/:id — hanya field yang dikirim yang ikut di-update. */
export const productBomUpdateSchema = z
  .object({
    qty_required: z.number().min(0.0001, "Jumlah harus lebih dari 0").optional(),
    qty_needed: z.number().min(0.0001, "Jumlah harus lebih dari 0").optional(),
    satuan_id: z.string().uuid().optional().nullable(),
    waste_factor: z.number().min(0).max(1).optional(),
    waste_persen: z.number().min(0).max(100).optional(),
    is_active: z.boolean().optional(),
  })
  .transform((value) => ({
    ...(value.qty_required !== undefined || value.qty_needed !== undefined
      ? { qty_required: value.qty_required ?? value.qty_needed }
      : {}),
    ...(value.satuan_id !== undefined ? { satuan_id: value.satuan_id } : {}),
    ...(value.waste_factor !== undefined || value.waste_persen !== undefined
      ? { waste_factor: value.waste_factor ?? (value.waste_persen ?? 0) / 100 }
      : {}),
    ...(value.is_active !== undefined ? { is_active: value.is_active } : {}),
  }));

/** POST /raw-materials/:id/bom */
export const rawMaterialBomCreateSchema = z
  .object({
    component_raw_material_id: z.string().uuid("Component raw material is required"),
    qty_required: z.number().min(0.0001, "Quantity must be greater than 0").optional(),
    satuan_id: z.string().uuid().nullable().optional(),
    waste_factor: z.number().min(0).max(1).optional(),
    waste_persen: z.number().min(0).max(100).optional(),
  })
  .transform((value) => ({
    component_raw_material_id: value.component_raw_material_id,
    qty_required: value.qty_required ?? 0,
    satuan_id: value.satuan_id || null,
    waste_factor: value.waste_factor ?? (value.waste_persen ?? 0) / 100,
  }))
  .refine((value) => value.qty_required > 0, {
    message: "Quantity must be greater than 0",
    path: ["qty_required"],
  });

export type RawMaterialBomCreateInput = z.infer<typeof rawMaterialBomCreateSchema>;

/** PUT /raw-material-bom/:id */
export const rawMaterialBomUpdateSchema = z.object({
  qty_required: z.number().min(0.0001).optional(),
  satuan_id: z.string().uuid().optional().nullable(),
  waste_factor: z.number().min(0).max(1).optional(),
  is_active: z.boolean().optional(),
});
