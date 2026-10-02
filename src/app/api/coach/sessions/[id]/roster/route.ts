import { NextRequest, NextResponse } from "next/server";
import { loadRoster } from "@/lib/studio/booking-server";
import { assertOwnSession, requireCoach } from "@/lib/studio/coach-portal";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Peserta sesi milik coach (tanpa data pass/nilai). */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("coach roster", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    await assertOwnSession(coach.id, id);
    const roster = (await loadRoster(coach.branch_id, id)) as { id: string; status: string; member_name: string | null; checked_in_at: string | null; source: string }[];
    return NextResponse.json({
      success: true,
      data: roster
        .filter((r) => r.status !== "cancelled")
        .map((r) => ({ id: r.id, status: r.status, member_name: r.member_name ?? "Member", checked_in_at: r.checked_in_at, source: r.source })),
    });
  });
}
