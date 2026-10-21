import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { assignComplaint } from "@/lib/studio/complaints-server";
import { complaintAssignSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Tunjuk / ganti / lepas PIC tiket. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("complaint assign", async () => {
    const ctx = await requireStudioContext("update", ["studio.complaints"]);
    const { id } = await params;
    const b = await validateBody(request, complaintAssignSchema);
    await assignComplaint(ctx.branchId, id, ctx.user.id, b.user_id);
    return NextResponse.json({ success: true, message: b.user_id ? "PIC disimpan" : "PIC dilepas" });
  });
}
