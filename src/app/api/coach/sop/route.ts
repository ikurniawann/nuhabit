import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { coachSopStatus } from "@/lib/studio/sop-server";
import { studioRoute } from "@/lib/studio/server";

/** SOP aktif untuk coach ini + status konfirmasinya (EPIC-067 T-067-D1). */
export async function GET() {
  return studioRoute("coach sop", async () => {
    const { coach } = await requireCoach();
    return NextResponse.json({ success: true, data: await coachSopStatus(coach) });
  });
}
