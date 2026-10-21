import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { loadCover, suggestSubstitutes } from "@/lib/studio/coach-cover-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Coach yang bisa ditunjuk Program Director untuk satu sesi. */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("coach-leave cover candidates", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.coach-leave"]);
    const { id } = await params;
    const cover = await loadCover(id);
    if (!cover || cover.branch_id !== ctx.branchId) throw ApiError.notFound("Sesi tidak ditemukan");
    return NextResponse.json({ success: true, data: await suggestSubstitutes(cover) });
  });
}
