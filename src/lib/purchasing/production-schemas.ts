import { z } from "zod";

const costFields = {
  overhead_cost: z.number().min(0).default(0),
  labor_cost: z.number().min(0).default(0),
  packaging_cost: z.number().min(0).default(0),
  waste_cost: z.number().min(0).default(0),
  catatan: z.string().optional().nullable(),
};

export const createProductProductionSchema = z.object({
  production_context: z.literal("product").default("product"),
  product_id: z.string().uuid("Product is required"),
  output_type: z.enum(["FINISHED_GOOD", "WIP"]).default("FINISHED_GOOD"),
  planned_qty: z.number().positive("Planned quantity must be greater than 0"),
  ...costFields,
});

export const createRawMaterialProductionSchema = z.object({
  production_context: z.literal("raw_material"),
  raw_material_id: z.string().uuid("Output raw material is required"),
  planned_qty: z.number().positive("Planned quantity must be greater than 0"),
  ...costFields,
});

/** Body tanpa production_context diperlakukan sebagai order produk (perilaku lama). */
export const createProductionSchema = z.preprocess(
  (body) =>
    body && typeof body === "object" && !(body as { production_context?: unknown }).production_context
      ? { ...body, production_context: "product" }
      : body,
  z.discriminatedUnion("production_context", [
    createRawMaterialProductionSchema,
    createProductProductionSchema,
  ])
);

export type CreateProductProductionInput = z.infer<typeof createProductProductionSchema>;
export type CreateRawMaterialProductionInput = z.infer<typeof createRawMaterialProductionSchema>;

export const updateProductionSchema = z.object({
  action: z.enum(["recheck_stock", "release", "start", "complete", "cancel"]),
  actual_qty: z.number().positive().optional(),
  overhead_cost: z.number().min(0).optional(),
  labor_cost: z.number().min(0).optional(),
  packaging_cost: z.number().min(0).optional(),
  waste_cost: z.number().min(0).optional(),
  materials: z
    .array(
      z.object({
        id: z.string().uuid(),
        qty_actual: z.number().min(0),
        waste_qty: z.number().min(0).optional(),
      })
    )
    .optional(),
  // EPIC-047 Fase 1B: rincian output per SKU POS (produk merchandise
  // ber-varian) saat action "complete". Diabaikan untuk WIP / raw_material /
  // produk tanpa SKU aktif (lihat requiresVariantSplit).
  variant_output: z
    .array(
      z.object({
        pos_sku_id: z.string().uuid(),
        qty: z.number().positive(),
      })
    )
    .max(100)
    .optional(),
});

export type UpdateProductionInput = z.infer<typeof updateProductionSchema>;
export type MaterialActualInput = NonNullable<UpdateProductionInput["materials"]>[number];
