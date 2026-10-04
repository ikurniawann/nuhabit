import { z } from "zod";
import { grnBatchFields } from "@/lib/purchasing/grn-batch";
import { GRN_QTY_EPSILON } from "@/lib/purchasing/grn-receive-rules";
import { toQty } from "@/lib/purchasing/utils";

const grnStatusSchema = z.enum(["pending", "partially_received", "received", "rejected"]);
const kondisiSchema = z.enum(["baik", "rusak", "cacat"]).default("baik");

const grnItemSchema = z
  .object({
    delivery_id: z.string().uuid().optional(),
    purchase_order_item_id: z.string().uuid().optional(),
    raw_material_id: z.string().uuid().optional(),
    product_id: z.string().uuid().optional(),
    supply_item_id: z.string().uuid().optional(),
    // EPIC-047 Fase 2 — SKU varian; kalau dikirim harus sama dengan milik item PO.
    pos_sku_id: z.string().uuid().optional().nullable(),
    qty_diterima: z.number().min(0, "Qty diterima minimal 0"),
    qty_ditolak: z.number().min(0, "Qty ditolak minimal 0"),
    /** QC accepted qty — default qty_diterima bila kosong (RM/product receive + QC sekaligus). */
    qty_accepted: z.number().min(0).optional(),
    /** QC rejected qty — default 0 bila kosong. */
    qty_rejected: z.number().min(0).optional(),
    satuan_id: z.string().uuid().optional(),
    kondisi: kondisiSchema,
    catatan: z.string().optional().nullable(),
    ...grnBatchFields,
  })
  .superRefine((item, ctx) => {
    if (!item.raw_material_id && !item.product_id && !item.supply_item_id) {
      ctx.addIssue({
        code: "custom",
        message: "Item wajib memiliki raw material, product, atau barang operasional",
        path: ["supply_item_id"],
      });
    }
  });

/** Body POST /api/purchasing/grn. */
export const createGrnSchema = z
  .object({
    // raw_material/product memilih delivery yang ada; general membuat delivery otomatis dari po_id.
    delivery_id: z.string().uuid().optional(),
    po_id: z.string().uuid().optional(),
    module_type: z.enum(["raw_material", "product", "general"]).optional(),
    tanggal_penerimaan: z.string().optional(),
    catatan: z.string().optional(),
    warehouse_id: z.string().uuid("Gudang wajib dipilih"),
    items: z.array(grnItemSchema).min(1, "Minimal 1 item wajib diisi"),
  })
  .superRefine((data, ctx) => {
    if (!data.delivery_id && !data.po_id) {
      ctx.addIssue({
        code: "custom",
        message: "Delivery atau purchase order wajib dipilih",
        path: ["delivery_id"],
      });
    }

    if ((data.module_type ?? "raw_material") === "general") return;

    data.items.forEach((item, index) => {
      const received = toQty(item.qty_diterima);
      if (received <= 0) return;

      const accepted = item.qty_accepted != null ? toQty(item.qty_accepted) : received;
      const rejected = item.qty_rejected != null ? toQty(item.qty_rejected) : 0;

      if (Math.abs(accepted + rejected - received) > GRN_QTY_EPSILON) {
        ctx.addIssue({
          code: "custom",
          message: "Qty QC accepted + rejected harus sama dengan qty diterima",
          path: ["items", index, "qty_accepted"],
        });
      }
    });
  });

export type CreateGrnInput = z.infer<typeof createGrnSchema>;
export type CreateGrnItemInput = CreateGrnInput["items"][number];

/** Query GET /api/purchasing/grn. */
export const grnListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: grnStatusSchema.optional(),
  delivery_id: z.string().uuid().optional(),
  po_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export type GrnListQuery = z.infer<typeof grnListQuerySchema>;

/** Body PATCH /api/purchasing/grn/[id] (GRN Continue: baris bahan baku). */
export const updateGrnSchema = z.object({
  status: grnStatusSchema.optional(),
  catatan: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        grn_id: z.string().uuid().optional(),
        purchase_order_item_id: z.string().uuid().optional(),
        raw_material_id: z.string().uuid(),
        qty_diterima: z.number().min(0),
        qty_ditolak: z.number().min(0),
        kondisi: kondisiSchema,
        catatan: z.string().optional().nullable(),
        ...grnBatchFields,
      })
    )
    .optional(),
  tanggal_penerimaan: z.string().optional(),
});

export type UpdateGrnInput = z.infer<typeof updateGrnSchema>;
export type UpdateGrnItemInput = NonNullable<UpdateGrnInput["items"]>[number];
