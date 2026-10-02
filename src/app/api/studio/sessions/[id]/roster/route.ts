import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { loadRoster } from "@/lib/studio/booking-server";
import { loadSessions, requireStudioContext, studioRoute } from "@/lib/studio/server";
import { queryOne } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("session roster", async () => {
    const ctx = await requireStudioContext();
    const { id } = await params;
    const s = await queryOne<{ d: string }>(`SELECT session_date::text AS d FROM studio.class_sessions WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]);
    if (!s) throw ApiError.notFound("Kelas tidak ditemukan");
    const [session] = (await loadSessions(ctx.branchId, s.d, s.d)).filter((x) => (x as { id: string }).id === id);
    return NextResponse.json({ success: true, data: { session, roster: await loadRoster(ctx.branchId, id) } });
  });
}
