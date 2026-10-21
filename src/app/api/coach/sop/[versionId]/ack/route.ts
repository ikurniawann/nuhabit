import { NextRequest, NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { acknowledgeSop } from "@/lib/studio/sop-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ versionId: string }> };

/** "Saya sudah membaca dan setuju". */
export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("coach sop ack", async () => {
    const { coach, userId } = await requireCoach();
    const { versionId } = await params;
    await acknowledgeSop(coach, userId, versionId);
    return NextResponse.json({ success: true, message: "Terima kasih — konfirmasi tersimpan" });
  });
}
