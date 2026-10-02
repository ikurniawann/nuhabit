import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { assertSessionCoachFree } from "@/lib/studio/conflicts";
import { daysBetweenInclusive, isValidDate, toMinutes } from "@/lib/studio/schedule";
import { sessionCreateSchema } from "@/lib/studio/schemas";
import { loadSessions, requireStudioContext, studioRoute } from "@/lib/studio/server";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (maks 62 hari). */
export async function GET(request: NextRequest) {
  return studioRoute("sessions GET", async () => {
    const ctx = await requireStudioContext();
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    if (!isValidDate(from) || !isValidDate(to) || to < from) throw ApiError.badRequest("Parameter from/to tidak valid");
    if (daysBetweenInclusive(from, to) > 62) throw ApiError.badRequest("Rentang maksimal 62 hari");
    return NextResponse.json({ success: true, data: await loadSessions(ctx.branchId, from, to) });
  });
}

/** Sesi tambahan di luar template (mis. kelas spesial, simulasi race). */
export async function POST(request: NextRequest) {
  return studioRoute("sessions POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, sessionCreateSchema);
    if (toMinutes(b.end_time) <= toMinutes(b.start_time)) throw ApiError.badRequest("Jam selesai harus setelah jam mulai");
    const program = await queryOne<{ default_capacity: number }>(
      `SELECT default_capacity FROM studio.programs WHERE id = $1 AND branch_id = $2`,
      [b.program_id, ctx.branchId]
    );
    if (!program) throw ApiError.notFound("Program tidak ditemukan");
    await assertSessionCoachFree(ctx.branchId, b);
    const rows = await query(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id,
         coach_id, capacity, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        ctx.companyId, ctx.branchId, b.session_date, b.start_time, b.end_time, b.program_id, b.coach_id ?? null,
        b.capacity ?? program.default_capacity, b.status, b.notes ?? null, ctx.user.id,
      ]
    );
    return NextResponse.json({ success: true, data: rows[0], message: "Sesi ditambahkan" }, { status: 201 });
  });
}
