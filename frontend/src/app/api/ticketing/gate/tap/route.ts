import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { processGateTap } from "@/lib/ticketing/gate-server";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { requireNfcUid, ticketingContext } from "@/lib/ticketing/server";

const tapSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  gate_label: z.string().trim().max(60).optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  // Gate men-tap terus-menerus — longgar tapi tetap berpagar
  assertStaffRateLimit(`ticketing-gate:${ctx.user.id}`, 120, "Terlalu banyak tap — tunggu sebentar");
  const body = await validateBody(request, tapSchema);
  const uid = requireNfcUid(body.nfc_uid);
  return successResponse(await processGateTap(ctx, uid, body.gate_label?.trim() || "gate-1"));
}, "ticketing.gate.tap.POST");
