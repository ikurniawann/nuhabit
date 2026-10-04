import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";
import { voidVisitCharge } from "@/lib/ticketing/visits-server";

const voidSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});

// Void = wewenang supervisor (menu laporan) — kasir biasa tidak boleh
// membalik tagihan.
export const POST = apiHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; chargeId: string }> }
  ) => {
    const ctx = await ticketingContext(IAM.ticketingReports);
    assertStaffRateLimit(
      `ticketing-void:${ctx.user.id}`,
      20,
      "Terlalu banyak void — coba lagi sebentar"
    );
    const { id, chargeId } = await params;
    const parsed = voidSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw ApiError.badRequest("Alasan void wajib diisi (min 3 karakter)");
    }
    await voidVisitCharge(ctx, id, chargeId, parsed.data.reason);
    return successResponse({ id: chargeId }, "Tagihan di-void");
  },
  "ticketing.visits.charge-void.POST"
);
