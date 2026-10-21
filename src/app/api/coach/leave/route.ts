import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { listCoachLeaves, listUpcomingBlackouts, loadCoachLeaveSettings } from "@/lib/studio/coach-leave-server";
import {
  type CoverRow,
  expireStaleRequests,
  getCoachLeaveContext,
  listIncomingRequests,
  listLeaveCovers,
  syncLeaveCovers,
} from "@/lib/studio/coach-cover-server";
import { venueToday } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";

/**
 * Cuti di Coach Portal (EPIC-067 T-067-A3/A4): aturan H-N venue coach, riwayat
 * pengajuan, status pengganti per sesi, dan permintaan menggantikan yang masuk. Pengajuannya sendiri lewat POST /api/hris/leaves (jalur ESS),
 * jadi aturan SOP, kuota, dan WA ke atasan tetap satu sumber.
 */
export async function GET() {
  return studioRoute("coach leave GET", async () => {
    const { coach } = await requireCoach();
    await expireStaleRequests();
    const [settings, leaves, today, incoming, blackoutRows] = await Promise.all([
      loadCoachLeaveSettings(coach.branch_id),
      listCoachLeaves(coach.id),
      venueToday(),
      listIncomingRequests(coach.id),
      listUpcomingBlackouts(coach.branch_id),
    ]);
    const blackouts = blackoutRows.map(({ id, date_from, date_to, reason }) => ({ id, date_from, date_to, reason }));
    // Pengganti per cuti yang masih menunggu (T-067-A4).
    const covers: Record<string, CoverRow[]> = {};
    for (const l of leaves.filter((x) => x.status === "pending")) {
      const ctx = await getCoachLeaveContext(l.id);
      if (ctx) await syncLeaveCovers(ctx);
      covers[l.id] = await listLeaveCovers(l.id);
    }
    return NextResponse.json({ success: true, data: { today, rules: settings.notice_rules, blackouts, leaves, covers, incoming } });
  });
}
