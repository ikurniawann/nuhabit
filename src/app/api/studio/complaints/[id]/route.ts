import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { getComplaint } from "@/lib/studio/complaints-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Detail tiket + riwayat. */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("complaint GET", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.complaints"]);
    const { id } = await params;
    const data = await getComplaint(ctx.branchId, id);
    if (!data) throw ApiError.notFound("Tiket tidak ditemukan");
    return NextResponse.json({ success: true, data });
  });
}
