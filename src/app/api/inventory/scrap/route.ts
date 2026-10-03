import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, validateWarehouseForReceivingScope } from "@/lib/api/scope";
import { requestMeta } from "@/lib/audit";
import { listMovements } from "@/lib/inventory/stock-queries";
import { ScrapError, scrapStock } from "@/lib/inventory/scrap";
import { SCRAP_REASONS, type ScrapReason } from "@/lib/inventory/scrap-reasons";

const scrapSchema = z.object({
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  qty: z.number().positive("Qty scrap harus lebih dari 0"),
  reason: z.enum(Object.keys(SCRAP_REASONS) as [ScrapReason, ...ScrapReason[]]),
  notes: z.string().max(500).optional().nullable(),
  batch_id: z.string().uuid().optional().nullable(),
});

/** GET /api/inventory/scrap — riwayat scrap/write-off terbaru. */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const sp = request.nextUrl.searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 50));
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const { rows, total } = await listMovements(
      { scope: await getApiUserScope(), referenceType: "scrap" },
      { limit, offset: (page - 1) * limit }
    );
    return Response.json({ success: true, data: rows, meta: { page, limit, total } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/inventory/scrap", error);
    return Response.json({ success: false, message: "Gagal memuat riwayat scrap" }, { status: 500 });
  }
}

/**
 * POST /api/inventory/scrap — catat scrap/write-off. Dengan `batch_id`, batch
 * itu yang dikurangi (mis. write-off dari halaman Stok Kedaluwarsa).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.itemsInventory);
    const body = scrapSchema.parse(await request.json());
    const scope = await getApiUserScope();
    const warehouse = await validateWarehouseForReceivingScope(body.warehouse_id, scope, null);
    if ("error" in warehouse) {
      return Response.json({ success: false, message: "Gudang tidak valid atau di luar cabang Anda" }, { status: 400 });
    }

    const result = await scrapStock({
      rawMaterialId: body.raw_material_id,
      warehouseId: body.warehouse_id,
      qty: body.qty,
      reason: body.reason,
      notes: body.notes,
      batchId: body.batch_id,
      actor: { id: user.id, name: user.full_name },
      ...requestMeta(request),
    });

    const base = `Scrap ${result.reference_number} tercatat, stok berkurang ${result.qty}`;
    return Response.json(
      {
        success: true,
        data: result,
        message: result.accounting_note ? `${base} (${result.accounting_note})` : base,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof ScrapError) {
      return Response.json({ success: false, message: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: error.issues[0]?.message ?? "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("POST /api/inventory/scrap", error);
    return Response.json({ success: false, message: "Gagal mencatat scrap" }, { status: 500 });
  }
}
