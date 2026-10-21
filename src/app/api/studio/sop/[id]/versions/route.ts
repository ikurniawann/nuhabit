import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { publishSopVersion } from "@/lib/studio/sop-server";
import { sopInputSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Terbitkan versi baru — semua coach wajib konfirmasi ulang. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("sop publish", async () => {
    const ctx = await requireStudioContext("update", ["studio.sop"]);
    const { id } = await params;
    const b = await validateBody(request, sopInputSchema);
    const version = await publishSopVersion(ctx.branchId, id, ctx.user.id, b);
    return NextResponse.json({ success: true, data: { version }, message: `Versi ${version} diterbitkan — coach diminta konfirmasi ulang` }, { status: 201 });
  });
}
