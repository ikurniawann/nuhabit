import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { requireNfcUid, ticketingContext } from "@/lib/ticketing/server";
import { checkTabForCharge } from "@/lib/ticketing/tab-server";

const checkSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  amount: z.number().min(0).max(1_000_000_000),
});

/**
 * Pratinjau untuk layar pembayaran kasir: tap gelang → tampil nama
 * rombongan + apakah total order bakal lolos guard saldo/plafon.
 * Read-only — charge sungguhan terjadi saat order dibuat.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  assertStaffRateLimit(
    `ticketing-tab-check:${ctx.user.id}`,
    60,
    "Terlalu banyak pengecekan — tunggu sebentar"
  );
  const body = await validateBody(request, checkSchema);
  const result = await checkTabForCharge({
    bandUid: requireNfcUid(body.nfc_uid),
    amount: body.amount,
    companyId: ctx.companyId,
    branchId: ctx.branchId,
  });
  return successResponse(
    result.ok ? { ok: true, ...result.target } : { ok: false, reason: result.reason }
  );
}, "ticketing.tab.check.POST");
