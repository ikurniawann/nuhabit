import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rate-limit";
import { realizeQuotation, realizeSchema, requireAccessibleQuotation } from "@/lib/sales-funnel/quotations-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Realisasi quotation (EPIC-022 Fase F3) — dipanggil ops menjelang acara.
 * Stok kurang → 409 dengan `shortages` & `warnings`.
 */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  // Endpoint berat (mengunci baris quotation + inventory) — rem per user
  if (!checkRateLimit(`sales-funnel-realize:${user.id}`, 10).allowed) {
    throw new ApiError(429, "Terlalu banyak percobaan realisasi — coba lagi sebentar");
  }
  const { id } = await params;
  const { deal } = await requireAccessibleQuotation(id, user);
  // Body opsional: tanpa body = tanpa force
  const parsed = realizeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw ApiError.badRequest("Validation failed", parsed.error.issues);
  const result = await realizeQuotation(user, id, deal.branch_id, parsed.data.force_skip_bom);
  return successResponse(
    result,
    result.bomStatus === "terpotong"
      ? `Realisasi selesai — ${result.movedCount} pergerakan stok dicatat`
      : "Realisasi dicatat TANPA memotong BOM"
  );
}, "sales-funnel.quotations.realize.POST");
