import { NextResponse } from "next/server";
import { listSessionChanges } from "@/lib/studio/session-change-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Laporan perubahan jadwal yang dikabarkan ke member (EPIC-067 T-067-A6). */
export async function GET() {
  return studioRoute("coach-leave changes", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    return NextResponse.json({ success: true, data: await listSessionChanges(ctx.branchId) });
  });
}
