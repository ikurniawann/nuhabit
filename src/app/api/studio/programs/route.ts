import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { programCreateSchema } from "@/lib/studio/schemas";
import { query } from "@/lib/db";
import { loadPrograms, requireStudioContext, studioRoute } from "@/lib/studio/server";

export async function GET(request: NextRequest) {
  return studioRoute("programs GET", async () => {
    const ctx = await requireStudioContext();
    const onlyActive = request.nextUrl.searchParams.get("active") === "1";
    return NextResponse.json({ success: true, data: await loadPrograms(ctx.branchId, onlyActive) });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("programs POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, programCreateSchema);
    const capacity = b.kind === "pt" ? 1 : b.default_capacity;
    const rows = await query(
      `INSERT INTO studio.programs (company_id, branch_id, code, name, kind, description, duration_minutes,
         default_capacity, level_label, is_active, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, code, name`,
      [
        ctx.companyId, ctx.branchId, b.code, b.name, b.kind, b.description ?? null, b.duration_minutes,
        capacity, b.level_label ?? null, b.is_active, b.sort_order, ctx.user.id,
      ]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Program ${b.name} dibuat` }, { status: 201 });
  });
}
