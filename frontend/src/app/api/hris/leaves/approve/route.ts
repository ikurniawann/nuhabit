import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { decideLeave, leaveApprovalSchema } from "@/lib/hris/leaves-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";

/** POST /api/hris/leaves/approve: approve/reject oleh HRD/admin atau atasan langsung. */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readJson(request, leaveApprovalSchema, "Validation failed");
  return NextResponse.json(await decideLeave(actor, input));
}, "hris/leaves/approve.POST");
