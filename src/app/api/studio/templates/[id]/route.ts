import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { assertTemplateCoachFree } from "@/lib/studio/conflicts";
import { toMinutes } from "@/lib/studio/schedule";
import { templatePatchSchema } from "@/lib/studio/schemas";
import { buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("templates PATCH", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const body = await validateBody(request, templatePatchSchema);
    const current = await queryOne<{ weekday: number; start_time: string; end_time: string; coach_id: string | null; is_active: boolean }>(
      `SELECT weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, coach_id, is_active
       FROM studio.schedule_templates WHERE id = $1 AND branch_id = $2`,
      [id, ctx.branchId]
    );
    if (!current) throw ApiError.notFound("Slot template tidak ditemukan");
    const merged = { ...current, ...body };
    if (toMinutes(merged.end_time) <= toMinutes(merged.start_time)) throw ApiError.badRequest("Jam selesai harus setelah jam mulai");
    if (body.program_id) {
      const ok = await queryOne(`SELECT 1 FROM studio.programs WHERE id = $1 AND branch_id = $2`, [body.program_id, ctx.branchId]);
      if (!ok) throw ApiError.notFound("Program tidak ditemukan");
    }
    if (merged.is_active) await assertTemplateCoachFree(ctx.branchId, { id, ...merged });
    const { sets, values } = buildSet(body);
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    await query(`UPDATE studio.schedule_templates SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, [id, ...values]);
    // Sesi yang sudah di-generate TIDAK ikut berubah — ubah per sesi di Jadwal Kelas,
    // atau hapus sesi mendatang lalu generate ulang.
    return NextResponse.json({ success: true, data: { id }, message: "Slot template diperbarui (berlaku untuk generate berikutnya)" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("templates DELETE", async () => {
    const ctx = await requireStudioContext("delete");
    const { id } = await params;
    const rows = await query(`DELETE FROM studio.schedule_templates WHERE id = $1 AND branch_id = $2 RETURNING id`, [id, ctx.branchId]);
    if (rows.length === 0) throw ApiError.notFound("Slot template tidak ditemukan");
    return NextResponse.json({ success: true, message: "Slot template dihapus (sesi yang sudah terbentuk tetap ada)" });
  });
}
