import { NextRequest } from "next/server";
import { z } from "zod";
import { createdResponse, requireIamMenuPrefix, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { submitGrnQcInspection } from "@/lib/purchasing/grn-qc";

type Ctx = { params: Promise<{ id: string }> };

const qcItemSchema = z
  .object({
    grn_item_id: z.string().uuid(),
    raw_material_id: z.string().uuid().optional().nullable(),
    product_id: z.string().uuid().optional().nullable(),
    qty_inspected: z.number().min(0),
    qty_accepted: z.number().min(0),
    qty_rejected: z.number().min(0),
    catatan: z.string().optional().nullable(),
  })
  .superRefine((item, ctx) => {
    if (!item.raw_material_id && !item.product_id) {
      ctx.addIssue({
        code: "custom",
        message: "Item QC wajib memiliki raw material atau product",
        path: ["raw_material_id"],
      });
    }
  });

const createQcSchema = z.object({
  status: z.enum(["approved", "rejected", "partial"]).optional(),
  parameter_inspeksi: z.record(z.string(), z.unknown()).optional(),
  hasil_inspeksi: z.record(z.string(), z.string()).optional(),
  catatan: z.string().optional().nullable(),
  rekomendasi: z.string().optional().nullable(),
  items: z.array(qcItemSchema).min(1, "At least one item is required"),
});

const QC_DONE_MESSAGE = "Quality control completed and stock updated";

// GET /api/purchasing/grn/[id]/qc — inspeksi QC milik GRN (null bila belum ada)
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;

  const { data, error } = await createPgClient()
    .from("grn_qc_inspections")
    .select(
      `
      *,
      inspector:inspector_id(id, name, email),
      items:grn_qc_inspection_items(
        id,
        grn_item_id,
        raw_material_id,
        qty_inspected,
        qty_accepted,
        qty_rejected,
        item_status,
        catatan,
        raw_material:raw_materials!raw_material_id(id, nama, kode)
      )
    `
    )
    .eq("grn_id", id)
    .maybeSingle();
  if (error) throw error;

  return successResponse(data, data ? "QC inspection retrieved" : "No QC inspection yet");
}, "purchasing.grn.qc.detail");

// POST /api/purchasing/grn/[id]/qc — selesaikan QC GRN pending + posting stok
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, createQcSchema);

  const result = await submitGrnQcInspection(createPgClient(), {
    grnId: id,
    status: input.status || "approved",
    parameter_inspeksi: input.parameter_inspeksi,
    hasil_inspeksi: input.hasil_inspeksi,
    catatan: input.catatan,
    rekomendasi: input.rekomendasi,
    items: input.items,
    userId: user.id,
  });

  return createdResponse(
    {
      grn_id: id,
      inspection_id: result.inspectionId,
      grn_status: result.grnStatus,
      totals: { accepted: result.totalAccepted, rejected: result.totalRejected },
    },
    result.accountingNote ? `${QC_DONE_MESSAGE} (${result.accountingNote})` : QC_DONE_MESSAGE
  );
}, "purchasing.grn.qc.submit");
