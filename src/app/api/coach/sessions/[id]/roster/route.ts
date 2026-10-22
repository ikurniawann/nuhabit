import { NextRequest, NextResponse } from "next/server";
import { loadRoster } from "@/lib/studio/booking-server";
import { assertOwnSession, requireCoach } from "@/lib/studio/coach-portal";
import { coachFlagsForCustomers } from "@/lib/studio/member-flags-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Peserta sesi milik coach (tanpa data pass/nilai) + penanda perhatian khusus
 * (EPIC-067 T-067-C2). Penanda medis disaring di query: hanya untuk sesi
 * hari ini/mendatang yang dipegang coach ini, atau penanda buatannya sendiri.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("coach roster", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    await assertOwnSession(coach.id, id);
    const roster = (
      (await loadRoster(coach.branch_id, id)) as { id: string; status: string; customer_id: string; member_name: string | null; checked_in_at: string | null; source: string }[]
    ).filter((r) => r.status !== "cancelled");
    const flags = await coachFlagsForCustomers(coach.id, coach.branch_id, [...new Set(roster.map((r) => r.customer_id))]);
    return NextResponse.json({
      success: true,
      data: roster.map((r) => ({
        id: r.id,
        status: r.status,
        customer_id: r.customer_id,
        member_name: r.member_name ?? "Member",
        checked_in_at: r.checked_in_at,
        source: r.source,
        flags: flags
          .filter((f) => f.customer_id === r.customer_id)
          .map((f) => ({ id: f.id, type_label: f.type_label, category: f.category, severity: f.severity, note: f.note, valid_until: f.valid_until, created_by_name: f.created_by_name, source: f.source, needs_review: f.needs_review })),
      })),
    });
  });
}
