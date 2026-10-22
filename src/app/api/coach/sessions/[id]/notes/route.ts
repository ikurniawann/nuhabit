import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireCoach } from "@/lib/studio/coach-portal";
import { sessionNoteSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";
import { createSessionNote } from "@/lib/studio/session-notes-server";

type Params = { params: Promise<{ id: string }> };

/** Coach menulis catatan setelah sesi untuk satu member di sesi miliknya (EPIC-067 T-067-C4). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach session note POST", async () => {
    const { coach, userId } = await requireCoach();
    const { id } = await params;
    const b = await validateBody(request, sessionNoteSchema);
    const noteId = await createSessionNote(coach, userId, id, b);
    return NextResponse.json({ success: true, data: { id: noteId }, message: "Catatan disimpan" }, { status: 201 });
  });
}
