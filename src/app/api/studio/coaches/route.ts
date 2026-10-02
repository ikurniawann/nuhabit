import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { coachCreateSchema } from "@/lib/studio/schemas";
import { query } from "@/lib/db";
import { loadCoaches, requireStudioContext, studioRoute } from "@/lib/studio/server";

export async function GET(request: NextRequest) {
  return studioRoute("coaches GET", async () => {
    const ctx = await requireStudioContext();
    const onlyActive = request.nextUrl.searchParams.get("active") === "1";
    return NextResponse.json({ success: true, data: await loadCoaches(ctx.branchId, onlyActive) });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("coaches POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, coachCreateSchema);
    const rows = await query(
      `INSERT INTO studio.coaches (company_id, branch_id, employee_id, full_name, display_name, level, phone, email,
         photo_url, bio, certifications, specialties, is_public, is_active, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, full_name`,
      [
        ctx.companyId, ctx.branchId, b.employee_id ?? null, b.full_name, b.display_name ?? null, b.level,
        b.phone ?? null, b.email ?? null, b.photo_url ?? null, b.bio ?? null, b.certifications ?? null,
        b.specialties, b.is_public, b.is_active, b.sort_order, ctx.user.id,
      ]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Coach ${b.full_name} ditambahkan` }, { status: 201 });
  });
}
