import { NextResponse } from "next/server";
import { leaderboard } from "@/lib/studio/loyalty-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

/** Leaderboard konsistensi bulan ini (sesi hadir) — hanya member yang memilih tampil. */
export async function GET() {
  return studioRoute("member leaderboard", async () => {
    const { customerId, actor } = await requireMemberStudio();
    return NextResponse.json({ success: true, data: await leaderboard(actor.branchId, customerId) });
  });
}
