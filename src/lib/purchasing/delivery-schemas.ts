import { z } from "zod";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";

/** Query GET /api/purchasing/delivery. */
export const deliveryListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  supplier_id: z.string().optional(),
  vendor_id: z.string().optional(),
  po_id: z.string().optional(),
  module_type: z.enum(["raw_material", "product"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort_by: z.enum(["tanggal_kirim", "created_at", "status"]).default("created_at"),
  sort_dir: z.enum(["ASC", "DESC"]).default("DESC"),
});

export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>;

/** Body POST /api/purchasing/delivery. */
export const createDeliverySchema = z
  .object({
    po_id: z.string().uuid("Purchase order identifier must be valid"),
    supplier_id: z.string().uuid("Supplier identifier must be valid").optional(),
    vendor_id: z.string().uuid("Vendor identifier must be valid").optional(),
    module_type: z.enum(["raw_material", "product"]).optional(),
    tanggal_kirim: z.string().min(1, "Shipment date is required"),
    no_surat_jalan: z.string().min(1, "Delivery note number is required"),
    no_resi: z.string().optional(),
    kurir: z.string().optional(),
    tanggal_estimasi_tiba: z.string().min(1, "Estimated arrival date is required"),
    catatan: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (parsePurchasingModuleType(data.module_type) === "product") {
      if (!data.vendor_id) {
        ctx.addIssue({ code: "custom", message: "Vendor is required", path: ["vendor_id"] });
      }
    } else if (!data.supplier_id) {
      ctx.addIssue({ code: "custom", message: "Supplier is required", path: ["supplier_id"] });
    }
  });

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

/** Body PUT /api/purchasing/delivery/[id]. */
export const updateDeliverySchema = z.object({
  no_surat_jalan: z.string().min(1).optional(),
  ekspedisi: z.string().optional(),
  no_resi: z.string().optional(),
  tanggal_kirim: z.string().optional(),
  tanggal_estimasi_tiba: z.string().optional(),
  tanggal_aktual_tiba: z.string().optional(),
  status: z.enum(["pending", "shipped", "in_transit", "delivered", "cancelled"]).optional(),
  catatan: z.string().optional(),
});

export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>;

/** Body POST /api/purchasing/delivery/[id]/arrive (opsional). */
export const arriveDeliverySchema = z.object({ notes: z.string().optional() }).catch({});
