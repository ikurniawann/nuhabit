import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("time-off DELETE", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const rows = await query(`DELETE FROM studio.coach_time_off WHERE id = $1 AND branch_id = $2 RETURNING id`, [id, ctx.branchId]);
    if (!rows.length) throw ApiError.notFound("Data cuti tidak ditemukan");
    return NextResponse.json({ success: true, message: "Cuti dihapus" });
  });
}
