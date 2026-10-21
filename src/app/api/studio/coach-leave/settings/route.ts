import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import {
  getCoachLeaveApprovers,
  listBackupCandidates,
  loadCoachLeaveSettings,
  saveCoachLeaveSettings,
} from "@/lib/studio/coach-leave-server";
import { coachLeaveSettingsSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MENU = ["studio.coach-leave"] as const;

/** Pengaturan approver cuti coach: daftar Program Director, cadangan, dan siapa yang memutus hari ini. */
export async function GET() {
  return studioRoute("coach-leave settings GET", async () => {
    const ctx = await requireStudioContext(undefined, MENU);
    const [settings, state, candidates] = await Promise.all([
      loadCoachLeaveSettings(ctx.branchId),
      getCoachLeaveApprovers(ctx.branchId),
      listBackupCandidates(ctx.branchId),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        settings,
        program_directors: state.programDirectors,
        backup: state.backup,
        active_approvers: state.resolved.approvers,
        approver_source: state.resolved.source,
        candidates,
      },
    });
  });
}

export async function PATCH(request: NextRequest) {
  return studioRoute("coach-leave settings PATCH", async () => {
    const ctx = await requireStudioContext("update", MENU);
    const b = await validateBody(request, coachLeaveSettingsSchema);
    if (b.backup_approver_user_id) {
      const candidates = await listBackupCandidates(ctx.branchId);
      if (!candidates.some((c) => c.id === b.backup_approver_user_id)) {
        throw ApiError.badRequest("Approver cadangan harus user aktif yang bisa masuk backoffice");
      }
    }
    const data = await saveCoachLeaveSettings(ctx.branchId, b, ctx.user.id);
    return NextResponse.json({ success: true, data, message: "Pengaturan approver disimpan" });
  });
}
