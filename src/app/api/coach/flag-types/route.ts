import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { listFlagTypes } from "@/lib/studio/member-flags-server";
import { studioRoute } from "@/lib/studio/server";

/** Jenis penanda aktif untuk form catatan coach. */
export async function GET() {
  return studioRoute("coach flag types", async () => {
    await requireCoach();
    return NextResponse.json({ success: true, data: await listFlagTypes() });
  });
}
