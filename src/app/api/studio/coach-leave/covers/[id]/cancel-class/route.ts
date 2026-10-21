import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { markCoverCancelClass } from "@/lib/studio/coach-cover-server";
import { coverCancelSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Program Director memutuskan sesi dibatalkan bila tidak ada pengganti. Sesi
 * baru benar-benar dibatalkan (kredit member kembali) saat cuti disetujui.
 */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach-leave cover cancel-class", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    const { id } = await params;
    const body = await validateBody(request, coverCancelSchema);
    await markCoverCancelClass(id, ctx.branchId, ctx.user, body.reason);
    return NextResponse.json({ success: true, message: "Sesi akan dibatalkan saat cuti disetujui" });
  });
}
