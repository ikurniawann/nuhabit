import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { newsPatchSchema } from "@/lib/studio/schemas";
import { assertInBranch, buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";

const PREFIX = ["studio.news"];
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("news PATCH", async () => {
    const ctx = await requireStudioContext("update", PREFIX);
    const { id } = await params;
    const body = await validateBody(request, newsPatchSchema);
    await assertInBranch("news", id, ctx.branchId, "News");
    const { sets, values } = buildSet(body);
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    // Terbit pertama kali → cap waktu terbit; kembali ke draft tidak menghapusnya.
    if (body.status === "published") sets.push("published_at = COALESCE(published_at, now())");
    const rows = await query(
      `UPDATE studio.news SET ${sets.join(", ")}, updated_by = $${values.length + 2}, updated_at = now()
       WHERE id = $1 RETURNING id, title, status`,
      [id, ...values, ctx.user.id]
    );
    return NextResponse.json({ success: true, data: rows[0], message: "News diperbarui" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("news DELETE", async () => {
    const ctx = await requireStudioContext("delete", PREFIX);
    const { id } = await params;
    await assertInBranch("news", id, ctx.branchId, "News");
    await query(`DELETE FROM studio.news WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, message: "News dihapus" });
  });
}
