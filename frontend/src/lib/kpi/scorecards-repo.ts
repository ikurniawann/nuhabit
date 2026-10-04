/**
 * Scorecard KPI bulanan (EPIC-010). Tiga mode baca: TIM (atasan langsung
 * melihat bawahannya), RIWAYAT (N scorecard terakhir satu karyawan), dan
 * PERIODE. HR melihat semua; selain HR dikunci ke scorecard miliknya.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { formatNumber } from "@/lib/format";
import { unwrap } from "@/lib/hris/workforce-route";
import type { WorkforceActor } from "@/lib/hris/workforce-auth";
import { periodLabelId } from "@/lib/payroll/period";
import type { PgClient } from "@/lib/pg/create-client";
import { buildWaLink } from "@/lib/recruitment/wa";

const SCORECARD_WITH_EMPLOYEE = `*, employee:employees ( id, full_name, nip, department_id,
  department:departments ( name ) )`;

export const scorecardQuerySchema = z.object({
  period_year: z.coerce.number().optional(),
  period_month: z.coerce.number().optional(),
  team: z.string().optional(),
  employee_id: z.string().optional(),
  history: z.coerce.number().optional(),
});

const ACTION_REQUIRED = "action (finalize|reopen) dan scorecard_id wajib";

export const scorecardActionSchema = z.object({
  action: z.enum(["finalize", "reopen"], { error: ACTION_REQUIRED }),
  scorecard_id: z.string({ error: ACTION_REQUIRED }).min(1, ACTION_REQUIRED),
});

type ScorecardQuery = z.infer<typeof scorecardQuerySchema>;

/**
 * Filter karyawan: non-HR dikunci ke dirinya; HR bebas memilih (atau "me").
 * `undefined` = non-HR tanpa record karyawan (hasil kosong).
 */
export function scorecardEmployeeFilter(
  actor: Pick<WorkforceActor, "isHr" | "employeeId">,
  requested: string | undefined
): string | null | undefined {
  if (!actor.isHr) return actor.employeeId ?? undefined;
  if (requested === "me") return actor.employeeId;
  return requested ?? null;
}

export async function listScorecards(db: PgClient, actor: WorkforceActor, q: ScorecardQuery) {
  const now = new Date();
  const periodYear = q.period_year || now.getFullYear();
  const periodMonth = q.period_month || now.getMonth() + 1;
  const period = { period_year: periodYear, period_month: periodMonth };

  // Peta label indikator untuk render breakdown di klien
  const { data: indicators } = await db
    .from("kpi_indicators")
    .select("id, code, name, unit, direction")
    .eq("is_active", true);

  // Mode TIM (Fase E): atasan langsung melihat scorecard bawahannya (MSS)
  if (q.team === "1") {
    if (!actor.employeeId) return { data: [], indicators };
    const { data: reports } = await db
      .from("employees")
      .select("id")
      .eq("reporting_to", actor.employeeId)
      .eq("is_active", true);
    const reportIds = ((reports ?? []) as { id: string }[]).map((row) => row.id);
    if (reportIds.length === 0) return { data: [], indicators };

    const data = unwrap(
      await db
        .from("kpi_scorecards")
        .select(SCORECARD_WITH_EMPLOYEE)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .in("employee_id", reportIds)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(200)
    );
    return { data, indicators, ...period };
  }

  const employeeFilter = scorecardEmployeeFilter(actor, q.employee_id);
  if (employeeFilter === undefined) return { data: [] };

  // Mode RIWAYAT: N scorecard terakhir SATU karyawan (ESS/riwayat HRD)
  const historyN = q.history || 0;
  if (historyN > 0) {
    // Akun tanpa record karyawan minta riwayat dirinya → kosong yang ramah
    if (!employeeFilter && q.employee_id === "me") return { data: [], indicators };
    if (!employeeFilter) throw ApiError.badRequest("history membutuhkan employee_id");
    const data = unwrap(
      await db
        .from("kpi_scorecards")
        .select("*")
        .eq("employee_id", employeeFilter)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(Math.min(24, historyN))
    );
    return { data, indicators };
  }

  let query = db
    .from("kpi_scorecards")
    .select(SCORECARD_WITH_EMPLOYEE)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(500);
  if (employeeFilter) query = query.eq("employee_id", employeeFilter);
  return { data: unwrap(await query), indicators, ...period };
}

/**
 * Finalisasi mengunci scorecard (snapshot & skor beku); reopen membuka lagi.
 * Saat final, siapkan link WhatsApp pemberitahuan skor (pola wa.me).
 */
export async function setScorecardStatus(
  db: PgClient,
  reviewerId: string,
  input: z.infer<typeof scorecardActionSchema>
) {
  const { action, scorecard_id: scorecardId } = input;
  const { data: existing } = await db
    .from("kpi_scorecards")
    .select("id, status")
    .eq("id", scorecardId)
    .maybeSingle();
  if (!existing) throw ApiError.notFound("Scorecard tidak ditemukan");
  if (action === "finalize" && existing.status !== "draft") {
    throw ApiError.conflict("Scorecard sudah final");
  }
  if (action === "reopen" && existing.status !== "final") {
    throw ApiError.conflict("Scorecard masih draft");
  }

  const now = new Date().toISOString();
  const patch =
    action === "finalize"
      ? { status: "final", reviewed_by: reviewerId, reviewed_at: now, updated_at: now }
      : { status: "draft", reviewed_by: null, reviewed_at: null, updated_at: now };
  const data = unwrap(
    await db.from("kpi_scorecards").update(patch).eq("id", scorecardId).select("*").single()
  );

  let waLink: string | null = null;
  if (action === "finalize" && data) {
    const { data: employee } = await db
      .from("employees")
      .select("full_name, phone")
      .eq("id", data.employee_id)
      .maybeSingle();
    const scoreText =
      data.score === null ? "belum ada data" : formatNumber(data.score, 3);
    waLink = buildWaLink(
      employee?.phone,
      `Halo ${employee?.full_name}, skor KPI Anda periode ${periodLabelId(data.period_month, data.period_year)} sudah FINAL: ${scoreText}. ` +
        `Lihat rinciannya di portal karyawan: menu Area Karyawan → KPI Saya.`
    );
  }

  return {
    data,
    wa_link: waLink,
    message: action === "finalize" ? "Scorecard difinalkan" : "Scorecard dibuka kembali",
  };
}
