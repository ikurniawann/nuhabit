import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { listExpiringBatches } from "@/lib/inventory/stock-queries";

const paramsSchema = z.object({
  days: z.coerce.number().int().min(0).max(365).default(30),
  status: z.enum(["all", "near", "expired"]).default("all"),
  warehouse_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});

/**
 * GET /api/inventory/expiry — batch yang kedaluwarsa dalam `days` hari dan yang
 * sudah lewat, dengan nilai berisiko (qty x biaya rata-rata).
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const raw = Object.fromEntries(
      [...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== "")
    );
    const params = paramsSchema.parse(raw);
    const result = await listExpiringBatches({
      scope: await getApiUserScope(),
      days: params.days,
      status: params.status,
      warehouseId: params.warehouse_id,
      branchId: params.branch_id,
      search: params.search,
    });
    return Response.json({ success: true, data: result.rows, summary: result.summary, meta: { today: result.today, horizon: result.horizon } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return Response.json({ success: false, message: "Filter tidak valid" }, { status: 400 });
    }
    console.error("GET /api/inventory/expiry", error);
    return Response.json({ success: false, message: "Gagal memuat stok kedaluwarsa" }, { status: 500 });
  }
}
