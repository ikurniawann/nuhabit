import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { isValueSplitValid } from "@/lib/studio/pass";
import { passProductPatchSchema } from "@/lib/studio/schemas";
import { buildSet, requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Ubah paket. Pass yang sudah terjual memegang snapshot, jadi tidak ikut berubah. */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("pass-products PATCH", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const body = await validateBody(request, passProductPatchSchema);
    const current = await queryOne<{
      price: number; class_value: number; pt_value: number; facility_value: number;
      class_credits: number; pt_credits: number; facility_access: boolean;
    }>(
      `SELECT price::float8 AS price, class_value::float8 AS class_value, pt_value::float8 AS pt_value,
              facility_value::float8 AS facility_value, class_credits, pt_credits, facility_access
       FROM studio.pass_products WHERE id = $1 AND branch_id = $2`,
      [id, ctx.branchId]
    );
    if (!current) throw ApiError.notFound("Paket tidak ditemukan");
    const invalid = isValueSplitValid({ ...current, ...body });
    if (invalid) throw ApiError.badRequest(invalid);
    const { sets, values } = buildSet(body);
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    await query(`UPDATE studio.pass_products SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, [id, ...values]);
    return NextResponse.json({ success: true, data: { id }, message: "Paket diperbarui (pass yang sudah terjual tidak berubah)" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("pass-products DELETE", async () => {
    const ctx = await requireStudioContext("delete");
    const { id } = await params;
    const sold = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM studio.member_passes WHERE product_id = $1 AND branch_id = $2`,
      [id, ctx.branchId]
    );
    if (Number(sold?.c) > 0) {
      await query(`UPDATE studio.pass_products SET is_active = false, updated_at = now() WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]);
      return NextResponse.json({ success: true, message: "Paket dinonaktifkan (sudah pernah terjual)" });
    }
    const rows = await query(`DELETE FROM studio.pass_products WHERE id = $1 AND branch_id = $2 RETURNING id`, [id, ctx.branchId]);
    if (rows.length === 0) throw ApiError.notFound("Paket tidak ditemukan");
    return NextResponse.json({ success: true, message: "Paket dihapus" });
  });
}
