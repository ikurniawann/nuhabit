import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { isValueSplitValid } from "@/lib/studio/pass";
import { passProductCreateSchema } from "@/lib/studio/schemas";
import { PASS_PRODUCT_COLUMNS } from "@/lib/studio/pass-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

export async function GET(request: NextRequest) {
  return studioRoute("pass-products GET", async () => {
    const ctx = await requireStudioContext();
    const onlyActive = request.nextUrl.searchParams.get("active") === "1";
    const rows = await query(
      `SELECT ${PASS_PRODUCT_COLUMNS},
              (SELECT COUNT(*)::int FROM studio.member_passes mp WHERE mp.product_id = p.id) AS sold_count
       FROM studio.pass_products p
       WHERE p.branch_id = $1 ${onlyActive ? "AND p.is_active" : ""}
       ORDER BY p.is_active DESC, p.sort_order, p.price`,
      [ctx.branchId]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("pass-products POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, passProductCreateSchema);
    const invalid = isValueSplitValid(b);
    if (invalid) throw ApiError.badRequest(invalid);
    const rows = await query(
      `INSERT INTO studio.pass_products (company_id, branch_id, code, name, category, class_credits, pt_credits,
         facility_access, validity_days, price, class_value, pt_value, facility_value, description, is_active,
         is_public, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, name`,
      [
        ctx.companyId, ctx.branchId, b.code, b.name, b.category, b.class_credits, b.pt_credits, b.facility_access,
        b.validity_days, b.price, b.class_value, b.pt_value, b.facility_value, b.description ?? null, b.is_active,
        b.is_public, b.sort_order, ctx.user.id,
      ]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Paket ${b.name} dibuat` }, { status: 201 });
  });
}
