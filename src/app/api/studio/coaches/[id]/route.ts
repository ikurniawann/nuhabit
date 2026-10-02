import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { assertInBranch, buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";
import { coachPatchSchema as patchSchema } from "@/lib/studio/schemas";


type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("coaches PATCH", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const body = await validateBody(request, patchSchema);
    await assertInBranch("coaches", id, ctx.branchId, "Coach");
    const { sets, values } = buildSet(body);
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    const rows = await query(
      `UPDATE studio.coaches SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, full_name`,
      [id, ...values]
    );
    return NextResponse.json({ success: true, data: rows[0], message: "Coach diperbarui" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("coaches DELETE", async () => {
    const ctx = await requireStudioContext("delete");
    const { id } = await params;
    await assertInBranch("coaches", id, ctx.branchId, "Coach");
    const used = await queryOne<{ c: number }>(
      `SELECT (SELECT COUNT(*) FROM studio.class_sessions WHERE coach_id = $1)
            + (SELECT COUNT(*) FROM studio.schedule_templates WHERE coach_id = $1) AS c`,
      [id]
    );
    if (Number(used?.c) > 0) {
      // Punya riwayat mengajar → nonaktifkan saja supaya histori & komisi tetap utuh.
      await query(`UPDATE studio.coaches SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
      return NextResponse.json({ success: true, message: "Coach dinonaktifkan (punya jadwal/riwayat mengajar)" });
    }
    await query(`DELETE FROM studio.coaches WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, message: "Coach dihapus" });
  });
}
