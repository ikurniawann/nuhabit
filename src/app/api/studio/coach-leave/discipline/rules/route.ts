import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { saveDisciplineRules } from "@/lib/studio/coach-discipline-server";
import { disciplineRulesSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Ubah potongan per jenis, batas potongan, dan ambang usulan SP (berlaku untuk catatan baru). */
export async function PATCH(request: NextRequest) {
  return studioRoute("coach discipline rules PATCH", async () => {
    const ctx = await requireStudioContext("update", ["studio.coach-leave"]);
    const b = await validateBody(request, disciplineRulesSchema);
    const data = await saveDisciplineRules(ctx.branchId, b, ctx.user.id);
    return NextResponse.json({ success: true, data, message: "Aturan disiplin disimpan" });
  });
}
