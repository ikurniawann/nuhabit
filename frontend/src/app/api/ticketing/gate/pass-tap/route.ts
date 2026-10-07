import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { processPassTap } from "@/lib/ticketing/season-pass-server";
import { ticketingContext } from "@/lib/ticketing/server";

// EPIC-028 Fase C — validasi masuk Season Pass di gate / reader keliling.

const tapSchema = z.object({
  code: z.string().trim().min(1).max(120),
  gate_label: z.string().trim().max(60).optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  assertStaffRateLimit(
    `ticketing-pass-gate:${ctx.user.id}`,
    120,
    "Terlalu banyak scan — tunggu sebentar"
  );
  const body = await validateBody(request, tapSchema);
  return successResponse(
    await processPassTap(ctx, body.code, body.gate_label?.trim() || "gate-pass")
  );
}, "ticketing.gate.pass-tap.POST");
