import { NextResponse } from "next/server";
import { listIncidents, listWarnings, loadDisciplineRules } from "@/lib/studio/coach-discipline-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Disiplin coach (EPIC-067 T-067-A8): aturan, catatan pelanggaran 120 hari, dan usulan/riwayat SP. */
export async function GET() {
  return studioRoute("coach discipline GET", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    const [rules, incidents, warnings] = await Promise.all([loadDisciplineRules(ctx.branchId), listIncidents(ctx.branchId), listWarnings(ctx.branchId)]);
    return NextResponse.json({ success: true, data: { rules, incidents, warnings } });
  });
}
