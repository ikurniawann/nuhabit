import { NextRequest, NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { studioRoute } from "@/lib/studio/server";
import { releaseSessionNote } from "@/lib/studio/session-notes-server";

type Params = { params: Promise<{ id: string }> };

/** Catatan tidak perlu dibawa lagi ke sesi berikutnya (mis. sudah pulih). */
export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("coach session note release", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    await releaseSessionNote(coach, id);
    return NextResponse.json({ success: true, message: "Catatan tidak lagi dibawa ke sesi berikutnya" });
  });
}
