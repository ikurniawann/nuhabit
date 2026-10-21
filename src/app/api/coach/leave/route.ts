import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { listCoachLeaves, loadCoachLeaveSettings } from "@/lib/studio/coach-leave-server";
import { venueToday } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";

/**
 * Cuti di Coach Portal (EPIC-067 T-067-A3): aturan H-N venue coach + riwayat
 * pengajuan. Pengajuannya sendiri lewat POST /api/hris/leaves (jalur ESS),
 * jadi aturan SOP, kuota, dan WA ke atasan tetap satu sumber.
 */
export async function GET() {
  return studioRoute("coach leave GET", async () => {
    const { coach } = await requireCoach();
    const [settings, leaves, today] = await Promise.all([
      loadCoachLeaveSettings(coach.branch_id),
      listCoachLeaves(coach.id),
      venueToday(),
    ]);
    return NextResponse.json({ success: true, data: { today, rules: settings.notice_rules, leaves } });
  });
}
