import { NextResponse } from "next/server";
import { coachStatements, loadPeriod } from "@/lib/studio/commission-server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { venueToday } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";

/**
 * Komisi coach: estimasi bulan berjalan (dari revenue yang sudah diakui sampai
 * hari ini) + riwayat statement. Hanya angka milik coach & total pool.
 */
export async function GET() {
  return studioRoute("coach commission", async () => {
    const { coach } = await requireCoach();
    const period = (await venueToday()).slice(0, 7);
    const view = await loadPeriod(coach.branch_id, period);
    const mine = view.lines.find((l) => l.coach_id === coach.id) ?? null;
    return NextResponse.json({
      success: true,
      data: {
        current: {
          period,
          total_pool: view.total_pool,
          share_percent: mine?.share_percent ?? 0,
          amount: mine?.amount ?? 0,
          class_sessions: mine?.class_sessions ?? 0,
          pt_sessions: mine?.pt_sessions ?? 0,
          attendees: mine?.attendees ?? 0,
          status: view.status,
        },
        history: await coachStatements(coach.branch_id, coach.id),
      },
    });
  });
}
