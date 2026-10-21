import { NextResponse } from "next/server";
import { canDecideCoachLeave } from "@/lib/studio/coach-leave";
import { getCoachLeaveApprovers, leaveBlackoutConflicts } from "@/lib/studio/coach-leave-server";
import { listPendingCoachLeaves } from "@/lib/studio/coach-cover-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Antrean Program Director: cuti coach menunggu + status pengganti tiap sesi (EPIC-067 T-067-A4). */
export async function GET() {
  return studioRoute("coach-leave queue", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    const leaves = await listPendingCoachLeaves(ctx.branchId);
    const data = [];
    for (const l of leaves) {
      const { resolved } = await getCoachLeaveApprovers(ctx.branchId, l.requesterUserId);
      data.push({
        ...l,
        canDecide: canDecideCoachLeave(ctx.user, resolved, l.requesterUserId),
        // Blackout yang berlaku sekarang → persetujuan butuh alasan pengecualian (T-067-A2).
        blackouts: await leaveBlackoutConflicts(l),
      });
    }
    return NextResponse.json({ success: true, data });
  });
}
