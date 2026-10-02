import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { newsCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const PREFIX = ["studio.news"];

export async function GET() {
  return studioRoute("news GET", async () => {
    const ctx = await requireStudioContext(undefined, PREFIX);
    const rows = await query(
      `SELECT id, title, category, summary, body, image_url, status, pinned, published_at, created_at, updated_at
       FROM studio.news WHERE branch_id = $1 ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC LIMIT 200`,
      [ctx.branchId]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("news POST", async () => {
    const ctx = await requireStudioContext("create", PREFIX);
    const b = await validateBody(request, newsCreateSchema);
    const rows = await query(
      `INSERT INTO studio.news (company_id, branch_id, title, category, summary, body, image_url, status, pinned, published_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::varchar,$9, CASE WHEN $8::varchar = 'published' THEN now() END, $10, $10)
       RETURNING id, title, status`,
      [ctx.companyId, ctx.branchId, b.title, b.category, b.summary ?? null, b.body ?? null, b.image_url ?? null, b.status, b.pinned, ctx.user.id]
    );
    return NextResponse.json(
      { success: true, data: rows[0], message: b.status === "published" ? "News diterbitkan" : "Draft disimpan" },
      { status: 201 }
    );
  });
}
