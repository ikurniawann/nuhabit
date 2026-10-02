import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { assertInBranch, buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";
import { programPatchSchema as patchSchema } from "@/lib/studio/schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("programs PATCH", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const body = await validateBody(request, patchSchema);
    await assertInBranch("programs", id, ctx.branchId, "Program");
    if (body.kind === "pt") body.default_capacity = 1;
    const { sets, values } = buildSet(body);
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    const rows = await query(
      `UPDATE studio.programs SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, code, name`,
      [id, ...values]
    );
    return NextResponse.json({ success: true, data: rows[0], message: "Program diperbarui" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("programs DELETE", async () => {
    const ctx = await requireStudioContext("delete");
    const { id } = await params;
    await assertInBranch("programs", id, ctx.branchId, "Program");
    const used = await queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM studio.class_sessions WHERE program_id = $1`, [id]);
    if (Number(used?.c) > 0) {
      await query(`UPDATE studio.programs SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
      return NextResponse.json({ success: true, message: "Program dinonaktifkan (sudah punya sesi)" });
    }
    await query(`DELETE FROM studio.programs WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, message: "Program dihapus" });
  });
}
