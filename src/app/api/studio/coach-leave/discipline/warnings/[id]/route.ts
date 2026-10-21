import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { decideWarning } from "@/lib/studio/coach-discipline-server";
import { warningDecisionSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Program Director menerbitkan / mengabaikan usulan SP. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach warning decide", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    const { id } = await params;
    const b = await validateBody(request, warningDecisionSchema);
    await decideWarning(ctx.branchId, id, ctx.user, b.decision, b.note);
    return NextResponse.json({ success: true, message: b.decision === "issued" ? "SP diterbitkan" : "Usulan SP diabaikan" });
  });
}
