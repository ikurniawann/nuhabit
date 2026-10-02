import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { daysBetweenInclusive, expandTemplates, isValidDate, MAX_GENERATE_DAYS, type TemplateSlot } from "@/lib/studio/schedule";
import { generateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/**
 * Bentuk sesi kelas dari template mingguan untuk rentang tanggal. Idempoten:
 * template yang sudah punya sesi di tanggal itu dilewati (unique index
 * template_id+session_date), jadi aman dijalankan ulang setelah menambah slot.
 */
export async function POST(request: NextRequest) {
  return studioRoute("sessions generate", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, generateSchema);
    if (!isValidDate(b.from) || !isValidDate(b.to) || b.to < b.from) throw ApiError.badRequest("Rentang tanggal tidak valid");
    if (daysBetweenInclusive(b.from, b.to) > MAX_GENERATE_DAYS) {
      throw ApiError.badRequest(`Rentang maksimal ${MAX_GENERATE_DAYS} hari per generate`);
    }

    const templates = await query<TemplateSlot>(
      `SELECT id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time,
              program_id, coach_id, capacity, is_active
       FROM studio.schedule_templates WHERE branch_id = $1`,
      [ctx.branchId]
    );
    if (!templates.some((t) => t.is_active)) throw ApiError.badRequest("Belum ada slot template aktif");

    const existingRows = await query<{ key: string }>(
      `SELECT template_id::text || '|' || session_date::text AS key
       FROM studio.class_sessions
       WHERE branch_id = $1 AND template_id IS NOT NULL AND session_date BETWEEN $2::date AND $3::date`,
      [ctx.branchId, b.from, b.to]
    );
    const holidays = b.skip_holidays
      ? await query<{ d: string }>(
          `SELECT holiday_date::text AS d FROM hris.public_holidays
           WHERE deleted_at IS NULL AND status = 'aktif' AND holiday_date BETWEEN $1::date AND $2::date`,
          [b.from, b.to]
        ).catch(() => [])
      : [];

    const planned = expandTemplates(
      templates,
      b.from,
      b.to,
      new Set(existingRows.map((r) => r.key)),
      new Set(holidays.map((h) => h.d))
    );

    let created = 0;
    if (planned.length > 0) {
      await withTransaction(async (client) => {
        for (const p of planned) {
          const res = await client.query(
            `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id,
               coach_id, capacity, template_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (template_id, session_date) WHERE template_id IS NOT NULL DO NOTHING`,
            [ctx.companyId, ctx.branchId, p.session_date, p.start_time, p.end_time, p.program_id, p.coach_id,
             p.capacity, p.template_id, ctx.user.id]
          );
          created += res.rowCount ?? 0;
        }
      });
    }

    const skippedHolidays = holidays.length;
    return NextResponse.json({
      success: true,
      data: { created, skipped_existing: existingRows.length, skipped_holidays: skippedHolidays },
      message:
        created > 0
          ? `${created} sesi dibuat${skippedHolidays ? ` · ${skippedHolidays} hari libur dilewati` : ""}`
          : "Tidak ada sesi baru — jadwal di rentang ini sudah lengkap",
    });
  });
}
