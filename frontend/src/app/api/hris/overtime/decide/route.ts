import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { decideOvertime, overtimeDecideSchema } from "@/lib/hris/overtime-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * POST: approve / reject / cancel pengajuan lembur. Aturan per sumber ada
 * di lib/hris/overtime-rules.ts.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readJson(request, overtimeDecideSchema, "Validation failed");
  return NextResponse.json(await decideOvertime(actor, input));
}, "hris/overtime/decide.POST");
