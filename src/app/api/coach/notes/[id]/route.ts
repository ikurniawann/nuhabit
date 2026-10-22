import { NextRequest, NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { studioRoute } from "@/lib/studio/server";
import { deleteSessionNote } from "@/lib/studio/session-notes-server";

type Params = { params: Promise<{ id: string }> };

/** Hapus catatan sesi (hanya penulisnya). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("coach session note DELETE", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    await deleteSessionNote(coach, id);
    return NextResponse.json({ success: true, message: "Catatan dihapus" });
  });
}
