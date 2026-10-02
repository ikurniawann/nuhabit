import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { assertSessionCoachFree } from "@/lib/studio/conflicts";
import { toMinutes } from "@/lib/studio/schedule";
import { sessionPatchSchema } from "@/lib/studio/schemas";
import { buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Ubah satu sesi: ganti coach (pengganti), kuota, jam, batalkan, atau tandai selesai. */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("sessions PATCH", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const body = await validateBody(request, sessionPatchSchema);
    const current = await queryOne<{ session_date: string; start_time: string; end_time: string; coach_id: string | null; status: string }>(
      `SELECT session_date::text AS session_date, to_char(start_time,'HH24:MI') AS start_time,
              to_char(end_time,'HH24:MI') AS end_time, coach_id, status
       FROM studio.class_sessions WHERE id = $1 AND branch_id = $2`,
      [id, ctx.branchId]
    );
    if (!current) throw ApiError.notFound("Sesi tidak ditemukan");
    const merged = { ...current, ...body };
    if (toMinutes(merged.end_time) <= toMinutes(merged.start_time)) throw ApiError.badRequest("Jam selesai harus setelah jam mulai");
    if (body.status === "cancelled" && !merged.cancel_reason) throw ApiError.badRequest("Isi alasan pembatalan");
    if (body.program_id) {
      const ok = await queryOne(`SELECT 1 FROM studio.programs WHERE id = $1 AND branch_id = $2`, [body.program_id, ctx.branchId]);
      if (!ok) throw ApiError.notFound("Program tidak ditemukan");
    }
    if (merged.status !== "cancelled") await assertSessionCoachFree(ctx.branchId, { id, ...merged });
    const { sets, values } = buildSet(body);
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    await query(`UPDATE studio.class_sessions SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, [id, ...values]);
    const message = body.status === "cancelled" ? "Sesi dibatalkan" : "Sesi diperbarui";
    return NextResponse.json({ success: true, data: { id }, message });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("sessions DELETE", async () => {
    const ctx = await requireStudioContext("delete");
    const { id } = await params;
    // Booking member (EPIC-054) akan mencegah hapus sesi yang sudah dipesan;
    // sampai saat itu sesi boleh dihapus — batalkan bila ingin jejaknya tetap ada.
    const rows = await query(`DELETE FROM studio.class_sessions WHERE id = $1 AND branch_id = $2 RETURNING id`, [id, ctx.branchId]);
    if (rows.length === 0) throw ApiError.notFound("Sesi tidak ditemukan");
    return NextResponse.json({ success: true, message: "Sesi dihapus" });
  });
}
