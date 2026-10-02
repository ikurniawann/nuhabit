import { NextRequest, NextResponse } from "next/server";
import { completeSession } from "@/lib/studio/booking-server";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Selesaikan kelas: no-show diproses, kredit diakui sebagai revenue kelas. */
export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("session complete", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const r = await completeSession(staffActor(ctx), id);
    return NextResponse.json({
      success: true,
      data: r,
      message: `Kelas selesai · ${r.attended} hadir, ${r.no_show} tidak hadir · Rp ${r.recognized.toLocaleString("id-ID")} diakui`,
    });
  });
}
