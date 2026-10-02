import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { assertTemplateCoachFree } from "@/lib/studio/conflicts";
import { toMinutes } from "@/lib/studio/schedule";
import { templateCreateSchema } from "@/lib/studio/schemas";
import { loadTemplates, requireStudioContext, studioRoute } from "@/lib/studio/server";

export async function GET() {
  return studioRoute("templates GET", async () => {
    const ctx = await requireStudioContext();
    return NextResponse.json({ success: true, data: await loadTemplates(ctx.branchId) });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("templates POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, templateCreateSchema);
    if (toMinutes(b.end_time) <= toMinutes(b.start_time)) throw ApiError.badRequest("Jam selesai harus setelah jam mulai");
    const program = await queryOne<{ default_capacity: number }>(
      `SELECT default_capacity FROM studio.programs WHERE id = $1 AND branch_id = $2`,
      [b.program_id, ctx.branchId]
    );
    if (!program) throw ApiError.notFound("Program tidak ditemukan");
    await assertTemplateCoachFree(ctx.branchId, b);
    const rows = await query(
      `INSERT INTO studio.schedule_templates (company_id, branch_id, weekday, start_time, end_time, program_id,
         coach_id, capacity, notes, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        ctx.companyId, ctx.branchId, b.weekday, b.start_time, b.end_time, b.program_id, b.coach_id ?? null,
        b.capacity ?? program.default_capacity, b.notes ?? null, b.is_active, ctx.user.id,
      ]
    );
    return NextResponse.json({ success: true, data: rows[0], message: "Slot template ditambahkan" }, { status: 201 });
  });
}
