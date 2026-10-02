import { ApiError } from "@/lib/api/auth";
import { postJournalFromMapping } from "@/lib/accounting/journal-mapping-posting";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  computeCommission,
  DEFAULT_COMMISSION_SETTINGS,
  isValidPeriod,
  periodToDate,
  shareFor,
  shiftPeriod,
  type CommissionSettings,
} from "@/lib/studio/commission";
import { venueToday } from "@/lib/studio/pass-server";

/**
 * Komisi Coach (EPIC-056) — di luar payroll. Revenue dasar = nilai kredit yang
 * diakui saat dipakai (ledger redeem dengan recognized_at) di bulan itu, zona WIB.
 */

const KEYS: Record<keyof CommissionSettings, string> = {
  class_pool_percent: "commission_class_pool_percent",
  pt_pool_percent: "commission_pt_pool_percent",
  share_head_coach: "commission_share_head_coach",
  share_coach: "commission_share_coach",
};

export async function loadCommissionSettings(branchId: string): Promise<CommissionSettings> {
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM studio.settings WHERE branch_id = $1 AND key LIKE 'commission_%'`,
    [branchId]
  );
  const out = { ...DEFAULT_COMMISSION_SETTINGS };
  for (const [field, key] of Object.entries(KEYS) as [keyof CommissionSettings, string][]) {
    const row = rows.find((r) => r.key === key);
    if (row && typeof row.value === "number") out[field] = row.value;
  }
  return out;
}

export async function saveCommissionSettings(branchId: string, patch: Partial<CommissionSettings>, userId: string) {
  for (const [field, value] of Object.entries(patch) as [keyof CommissionSettings, number | undefined][]) {
    if (value === undefined) continue;
    await query(
      `INSERT INTO studio.settings (branch_id, key, value, updated_by) VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [branchId, KEYS[field], JSON.stringify(value), userId]
    );
  }
  return loadCommissionSettings(branchId);
}

const MONTH_RANGE = `
  l.recognized_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Jakarta')
  AND l.recognized_at < (($2::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta')`;

/** Revenue kelas & Personal Training yang diakui di bulan itu. */
export async function periodRevenue(branchId: string, period: string): Promise<{ class: number; pt: number }> {
  const row = await queryOne<{ class_rev: number; pt_rev: number }>(
    `SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.credit_type = 'class'), 0)::float8 AS class_rev,
            COALESCE(SUM(l.amount) FILTER (WHERE l.credit_type = 'pt'), 0)::float8 AS pt_rev
     FROM studio.pass_credit_ledger l
     WHERE l.branch_id = $1 AND l.entry_type = 'redeem' AND l.recognized_at IS NOT NULL AND ${MONTH_RANGE}`,
    [branchId, periodToDate(period)]
  );
  return { class: row?.class_rev ?? 0, pt: row?.pt_rev ?? 0 };
}

interface CoachActivity {
  id: string;
  full_name: string;
  level: "coach" | "head_coach";
  is_active: boolean;
  commission_share_percent: number | null;
  class_sessions: number;
  pt_sessions: number;
  attendees: number;
}

/** Coach aktif + coach yang mengajar di bulan itu, dengan jumlah sesi selesai & peserta hadir. */
async function coachActivity(branchId: string, period: string): Promise<CoachActivity[]> {
  return query<CoachActivity>(
    `SELECT c.id, c.full_name, c.level, c.is_active, c.commission_share_percent::float8 AS commission_share_percent,
            COALESCE(a.class_sessions, 0)::int AS class_sessions, COALESCE(a.pt_sessions, 0)::int AS pt_sessions,
            COALESCE(a.attendees, 0)::int AS attendees
     FROM studio.coaches c
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT s.id) FILTER (WHERE p.kind = 'class') AS class_sessions,
              COUNT(DISTINCT s.id) FILTER (WHERE p.kind = 'pt') AS pt_sessions,
              COUNT(b.id) FILTER (WHERE b.status = 'attended') AS attendees
       FROM studio.class_sessions s
       JOIN studio.programs p ON p.id = s.program_id
       LEFT JOIN studio.bookings b ON b.session_id = s.id
       WHERE s.coach_id = c.id AND s.status = 'completed'
         AND s.session_date >= $2::date AND s.session_date < ($2::date + interval '1 month')
     ) a ON true
     WHERE c.branch_id = $1 AND (c.is_active OR COALESCE(a.class_sessions, 0) + COALESCE(a.pt_sessions, 0) > 0)
     ORDER BY CASE c.level WHEN 'head_coach' THEN 0 ELSE 1 END, c.full_name`,
    [branchId, periodToDate(period)]
  );
}

export interface PeriodView {
  period: string;
  status: "draft" | "approved" | "paid" | "preview";
  settings: CommissionSettings;
  class_revenue: number;
  pt_revenue: number;
  class_pool: number;
  pt_pool: number;
  total_pool: number;
  allocated_percent: number;
  allocated_amount: number;
  retained_amount: number;
  over_allocated: boolean;
  month_closed: boolean;
  approved_at: string | null;
  computed_at: string | null;
  accrual_journal_id: string | null;
  lines: {
    id: string | null;
    coach_id: string;
    coach_name: string;
    level: string;
    share_percent: number;
    amount: number;
    class_sessions: number;
    pt_sessions: number;
    attendees: number;
    status: "pending" | "paid";
    paid_at: string | null;
    payment_method: string | null;
    payment_ref: string | null;
  }[];
}

async function storedPeriod(branchId: string, period: string) {
  return queryOne<{
    id: string; status: "draft" | "approved" | "paid"; class_revenue: number; pt_revenue: number;
    class_pool_percent: number; pt_pool_percent: number; class_pool: number; pt_pool: number; total_pool: number;
    allocated_percent: number; allocated_amount: number; retained_amount: number; approved_at: string | null;
    computed_at: string | null; accrual_journal_id: string | null;
  }>(
    `SELECT id, status, class_revenue::float8 AS class_revenue, pt_revenue::float8 AS pt_revenue,
            class_pool_percent::float8 AS class_pool_percent, pt_pool_percent::float8 AS pt_pool_percent,
            class_pool::float8 AS class_pool, pt_pool::float8 AS pt_pool, total_pool::float8 AS total_pool,
            allocated_percent::float8 AS allocated_percent, allocated_amount::float8 AS allocated_amount,
            retained_amount::float8 AS retained_amount, approved_at, computed_at, accrual_journal_id
     FROM studio.commission_periods WHERE branch_id = $1 AND period = $2::date`,
    [branchId, periodToDate(period)]
  );
}

async function monthClosed(period: string): Promise<boolean> {
  return periodToDate(shiftPeriod(period, 1)) <= (await venueToday());
}

/**
 * Tampilan periode: bila sudah disetujui/dibayar → angka tersimpan (terkunci);
 * selain itu dihitung langsung dari revenue terkini (pratinjau/draft).
 */
export async function loadPeriod(branchId: string, period: string): Promise<PeriodView> {
  if (!isValidPeriod(period)) throw ApiError.badRequest("Periode tidak valid (YYYY-MM)");
  const stored = await storedPeriod(branchId, period);
  const closed = await monthClosed(period);
  if (stored && stored.status !== "draft") {
    const lines = await query<PeriodView["lines"][number]>(
      `SELECT id, coach_id, coach_name, level, share_percent::float8 AS share_percent, amount::float8 AS amount,
              class_sessions, pt_sessions, attendees, status, paid_at, payment_method, payment_ref
       FROM studio.commission_lines WHERE period_id = $1 ORDER BY CASE level WHEN 'head_coach' THEN 0 ELSE 1 END, coach_name`,
      [stored.id]
    );
    return {
      period, status: stored.status,
      settings: { ...(await loadCommissionSettings(branchId)), class_pool_percent: stored.class_pool_percent, pt_pool_percent: stored.pt_pool_percent },
      class_revenue: stored.class_revenue, pt_revenue: stored.pt_revenue, class_pool: stored.class_pool, pt_pool: stored.pt_pool,
      total_pool: stored.total_pool, allocated_percent: stored.allocated_percent, allocated_amount: stored.allocated_amount,
      retained_amount: stored.retained_amount, over_allocated: stored.allocated_percent > 100, month_closed: closed,
      approved_at: stored.approved_at, computed_at: stored.computed_at, accrual_journal_id: stored.accrual_journal_id, lines,
    };
  }

  const [settings, revenue, coaches] = await Promise.all([loadCommissionSettings(branchId), periodRevenue(branchId, period), coachActivity(branchId, period)]);
  const r = computeCommission({ classRevenue: revenue.class, ptRevenue: revenue.pt, settings, coaches });
  return {
    period, status: stored ? "draft" : "preview", settings,
    class_revenue: revenue.class, pt_revenue: revenue.pt, class_pool: r.class_pool, pt_pool: r.pt_pool, total_pool: r.total_pool,
    allocated_percent: r.allocated_percent, allocated_amount: r.allocated_amount, retained_amount: r.retained_amount,
    over_allocated: r.over_allocated, month_closed: closed, approved_at: null, computed_at: new Date().toISOString(), accrual_journal_id: null,
    lines: coaches.map((c) => {
      const line = r.lines.find((l) => l.coach_id === c.id)!;
      return {
        id: null, coach_id: c.id, coach_name: c.full_name, level: c.level, share_percent: shareFor(c, settings), amount: line.amount,
        class_sessions: c.class_sessions, pt_sessions: c.pt_sessions, attendees: c.attendees, status: "pending" as const,
        paid_at: null, payment_method: null, payment_ref: null,
      };
    }),
  };
}

/**
 * Setujui periode: hitung ulang dari data terkini, kunci angka per coach,
 * posting akrual (beban komisi / utang komisi). Hanya untuk bulan yang sudah
 * berakhir dan total persentase ≤ 100%.
 */
export async function approvePeriod(ctx: { companyId: string; branchId: string; userId: string }, period: string): Promise<PeriodView> {
  const view = await loadPeriod(ctx.branchId, period);
  if (view.status === "approved" || view.status === "paid") throw ApiError.conflict("Periode sudah disetujui");
  if (!view.month_closed) throw ApiError.conflict("Komisi baru bisa disetujui setelah bulan berakhir");
  if (view.over_allocated) throw ApiError.conflict(`Total persentase ${view.allocated_percent}% melebihi 100% — sesuaikan persentase coach dulu`);

  const periodId = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO studio.commission_periods (company_id, branch_id, period, status, class_revenue, pt_revenue, class_pool_percent,
         pt_pool_percent, class_pool, pt_pool, total_pool, allocated_percent, allocated_amount, retained_amount, computed_at,
         approved_at, approved_by, created_by)
       VALUES ($1,$2,$3::date,'approved',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now(),$14,$14)
       ON CONFLICT (branch_id, period) DO UPDATE SET
         status = 'approved', class_revenue = EXCLUDED.class_revenue, pt_revenue = EXCLUDED.pt_revenue,
         class_pool_percent = EXCLUDED.class_pool_percent, pt_pool_percent = EXCLUDED.pt_pool_percent,
         class_pool = EXCLUDED.class_pool, pt_pool = EXCLUDED.pt_pool, total_pool = EXCLUDED.total_pool,
         allocated_percent = EXCLUDED.allocated_percent, allocated_amount = EXCLUDED.allocated_amount,
         retained_amount = EXCLUDED.retained_amount, computed_at = now(), approved_at = now(), approved_by = EXCLUDED.approved_by,
         updated_at = now()
       WHERE studio.commission_periods.status = 'draft'
       RETURNING id`,
      [
        ctx.companyId, ctx.branchId, periodToDate(period), view.class_revenue, view.pt_revenue, view.settings.class_pool_percent,
        view.settings.pt_pool_percent, view.class_pool, view.pt_pool, view.total_pool, view.allocated_percent, view.allocated_amount,
        view.retained_amount, ctx.userId,
      ]
    );
    if (!rows[0]) throw ApiError.conflict("Periode sudah disetujui");
    const id = rows[0].id as string;
    await client.query(`DELETE FROM studio.commission_lines WHERE period_id = $1`, [id]);
    for (const l of view.lines) {
      await client.query(
        `INSERT INTO studio.commission_lines (period_id, branch_id, coach_id, coach_name, level, share_percent, amount, class_sessions, pt_sessions, attendees)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, ctx.branchId, l.coach_id, l.coach_name, l.level, l.share_percent, l.amount, l.class_sessions, l.pt_sessions, l.attendees]
      );
    }
    // Coach dengan komisi 0 langsung dianggap lunas supaya periode bisa ditutup.
    await client.query(`UPDATE studio.commission_lines SET status = 'paid', paid_at = now() WHERE period_id = $1 AND amount = 0`, [id]);
    return id;
  });

  if (view.allocated_amount > 0) {
    try {
      const posted = await postJournalFromMapping({
        companyId: ctx.companyId, userId: ctx.userId, eventCode: "STUDIO_COMMISSION_ACCRUAL",
        documentType: "STUDIO_COMMISSION", documentId: periodId, entryDate: periodToDate(shiftPeriod(period, 1)),
        amounts: { TOTAL: view.allocated_amount, SUBTOTAL: view.allocated_amount, PAID: view.allocated_amount },
        description: `Akrual komisi coach ${period}`, sourceModule: "STUDIO",
      });
      if (posted.entryId) await query(`UPDATE studio.commission_periods SET accrual_journal_id = $2 WHERE id = $1`, [periodId, posted.entryId]);
    } catch (error) {
      console.error("[studio] jurnal akrual komisi gagal (non-blocking):", error);
    }
  }
  await closeIfAllPaid(periodId);
  return loadPeriod(ctx.branchId, period);
}

async function closeIfAllPaid(periodId: string) {
  await query(
    `UPDATE studio.commission_periods SET status = 'paid', updated_at = now()
     WHERE id = $1 AND status = 'approved' AND NOT EXISTS (SELECT 1 FROM studio.commission_lines WHERE period_id = $1 AND status = 'pending')`,
    [periodId]
  );
}

/** Catat pembayaran komisi satu coach (kas / transfer) + jurnal pembayaran. */
export async function payLine(
  ctx: { companyId: string; branchId: string; userId: string },
  lineId: string,
  input: { method: "cash" | "transfer"; ref?: string | null }
) {
  const line = await queryOne<{ id: string; period_id: string; amount: number; coach_name: string; status: string; period: string; period_status: string }>(
    `SELECT l.id, l.period_id, l.amount::float8 AS amount, l.coach_name, l.status, to_char(p.period,'YYYY-MM') AS period, p.status AS period_status
     FROM studio.commission_lines l JOIN studio.commission_periods p ON p.id = l.period_id
     WHERE l.id = $1 AND l.branch_id = $2`,
    [lineId, ctx.branchId]
  );
  if (!line) throw ApiError.notFound("Baris komisi tidak ditemukan");
  if (line.period_status === "draft") throw ApiError.conflict("Setujui periode dulu sebelum membayar");
  if (line.status === "paid") throw ApiError.conflict("Komisi coach ini sudah dibayar");
  await query(
    `UPDATE studio.commission_lines SET status = 'paid', paid_at = now(), paid_by = $2, payment_method = $3, payment_ref = $4, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [lineId, ctx.userId, input.method, input.ref ?? null]
  );
  if (line.amount > 0) {
    try {
      const posted = await postJournalFromMapping({
        companyId: ctx.companyId, userId: ctx.userId, eventCode: "STUDIO_COMMISSION_PAYMENT",
        documentType: "STUDIO_COMMISSION_LINE", documentId: lineId, entryDate: await venueToday(),
        amounts: { TOTAL: line.amount, SUBTOTAL: line.amount, PAID: line.amount },
        description: `Pembayaran komisi ${line.coach_name} ${line.period}${input.ref ? ` (${input.ref})` : ""}`, sourceModule: "STUDIO",
      });
      if (posted.entryId) await query(`UPDATE studio.commission_lines SET payment_journal_id = $2 WHERE id = $1`, [lineId, posted.entryId]);
    } catch (error) {
      console.error("[studio] jurnal pembayaran komisi gagal (non-blocking):", error);
    }
  }
  await closeIfAllPaid(line.period_id);
  return line;
}

/** Riwayat komisi satu coach (untuk Coach Portal & profil coach). */
export async function coachStatements(branchId: string, coachId: string) {
  return query(
    `SELECT l.id, to_char(p.period,'YYYY-MM') AS period, p.status AS period_status, l.share_percent::float8 AS share_percent,
            l.amount::float8 AS amount, l.class_sessions, l.pt_sessions, l.attendees, l.status, l.paid_at, l.payment_method
     FROM studio.commission_lines l JOIN studio.commission_periods p ON p.id = l.period_id
     WHERE l.branch_id = $1 AND l.coach_id = $2
     ORDER BY p.period DESC LIMIT 24`,
    [branchId, coachId]
  );
}
