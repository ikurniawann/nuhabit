import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { timeOffCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ coachId: string }> };

/** Catat cuti / tidak tersedia; slot Personal Training di rentang ini ditutup. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("time-off POST", async () => {
    const ctx = await requireStudioContext("update");
    const { coachId } = await params;
    const b = await validateBody(request, timeOffCreateSchema);
    if (b.date_to < b.date_from) throw ApiError.badRequest("Tanggal selesai harus setelah tanggal mulai");
    const coach = await queryOne(`SELECT id FROM studio.coaches WHERE id = $1 AND branch_id = $2`, [coachId, ctx.branchId]);
    if (!coach) throw ApiError.notFound("Coach tidak ditemukan");
    const booked = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM studio.class_sessions s
       WHERE s.coach_id = $1 AND s.origin = 'pt_booking' AND s.status = 'scheduled' AND s.session_date BETWEEN $2::date AND $3::date`,
      [coachId, b.date_from, b.date_to]
    );
    await query(
      `INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.companyId, ctx.branchId, coachId, b.date_from, b.date_to, b.reason ?? null, ctx.user.id]
    );
    const warn = Number(booked?.c) ? ` · ada ${booked?.c} sesi Personal Training terjadwal di rentang ini, ganti coach atau batalkan di Jadwal Kelas` : "";
    return NextResponse.json({ success: true, message: `Cuti dicatat${warn}` }, { status: 201 });
  });
}
