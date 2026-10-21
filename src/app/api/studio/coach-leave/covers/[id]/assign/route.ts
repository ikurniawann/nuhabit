import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { assignSubstitute } from "@/lib/studio/coach-cover-server";
import { substituteChoiceSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Program Director menunjuk pengganti langsung (menimpa permintaan/jawaban sebelumnya). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach-leave cover assign", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    const { id } = await params;
    const body = await validateBody(request, substituteChoiceSchema);
    await assignSubstitute(id, ctx.branchId, ctx.user, body.substitute_coach_id);
    return NextResponse.json({ success: true, message: "Pengganti ditunjuk" });
  });
}
