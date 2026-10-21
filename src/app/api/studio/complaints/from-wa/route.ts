import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { createComplaintFromWa } from "@/lib/studio/complaints-server";
import { complaintFromWaSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Satu klik dari WA inbox: tiket dengan kontak & member dari percakapan. 409 bila sudah ada tiket aktif. */
export async function POST(request: NextRequest) {
  return studioRoute("complaints from-wa", async () => {
    const ctx = await requireStudioContext("create", ["studio.complaints"]);
    const { wa_conversation_id, ...rest } = await validateBody(request, complaintFromWaSchema);
    const data = await createComplaintFromWa(ctx, ctx.user.id, wa_conversation_id, rest);
    return NextResponse.json({ success: true, data, message: `Tiket ${data.code} dibuat` }, { status: 201 });
  });
}
