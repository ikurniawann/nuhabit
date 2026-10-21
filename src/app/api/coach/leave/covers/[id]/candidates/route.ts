import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { loadCover, suggestSubstitutes } from "@/lib/studio/coach-cover-server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Saran pengganti untuk sesi milik coach yang cuti (EPIC-067 T-067-A4). */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("coach cover candidates", async () => {
    const { coach } = await requireCoach();
    const { id } = await params;
    const cover = await loadCover(id);
    if (!cover || cover.original_coach_id !== coach.id) throw ApiError.notFound("Sesi tidak ditemukan");
    return NextResponse.json({ success: true, data: await suggestSubstitutes(cover) });
  });
}
