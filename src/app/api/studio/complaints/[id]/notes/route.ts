import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { addComplaintNote } from "@/lib/studio/complaints-server";
import { complaintNoteSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Catatan internal tiket (tidak dikirim ke member). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("complaint note", async () => {
    const ctx = await requireStudioContext("update", ["studio.complaints"]);
    const { id } = await params;
    const b = await validateBody(request, complaintNoteSchema);
    await addComplaintNote(ctx.branchId, id, ctx.user.id, b.body);
    return NextResponse.json({ success: true, message: "Catatan disimpan" });
  });
}
