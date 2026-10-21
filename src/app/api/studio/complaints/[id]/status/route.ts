import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { COMPLAINT_STATUS_LABEL } from "@/lib/studio/complaints";
import { transitionComplaint } from "@/lib/studio/complaints-server";
import { complaintStatusSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Pindah status tiket (mulai tangani, selesai, dikonfirmasi member, buka lagi, batal). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("complaint status", async () => {
    const ctx = await requireStudioContext("update", ["studio.complaints"]);
    const { id } = await params;
    const b = await validateBody(request, complaintStatusSchema);
    await transitionComplaint(ctx.branchId, id, ctx.user.id, b.to, b.note);
    return NextResponse.json({ success: true, message: `Status: ${COMPLAINT_STATUS_LABEL[b.to]}` });
  });
}
