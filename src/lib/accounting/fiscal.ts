import { ApiError } from "@/lib/api/auth";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { assertRecordInScope } from "@/lib/accounting/route-helpers";
import type {
  AccountingPeriodListItem,
  FiscalCoverageResult,
  FiscalOpenSuggestion,
  PeriodClosePreview,
  ResolvedFiscalPeriod,
} from "@/lib/accounting/fiscal-types";

export type {
  AccountingPeriodListItem,
  PeriodClosePreview,
  ResolvedFiscalPeriod,
} from "@/lib/accounting/fiscal-types";

const PERIOD_SELECT = `
  p.id, p.fiscal_year_id, p.period_no, p.name,
  p.start_date::text AS start_date,
  p.end_date::text AS end_date,
  p.status,
  y.code AS fiscal_year_code,
  y.name AS fiscal_year_name,
  y.is_active AS fiscal_year_is_active
`;

/**
 * Resolve OPEN period covering entry_date for company.
 */
export async function resolveOpenFiscalPeriod(
  entryDate: string,
  companyId: string | null,
  client?: PoolClient
): Promise<ResolvedFiscalPeriod | null> {
  const sql = `
    SELECT ${PERIOD_SELECT}
    FROM accounting.fiscal_periods p
    JOIN accounting.fiscal_years y
      ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
    WHERE y.is_active = true
      AND p.status = 'OPEN'
      AND p.start_date <= $1::date
      AND p.end_date >= $1::date
      AND (
        ($2::uuid IS NULL AND y.company_id IS NULL)
        OR ($2::uuid IS NOT NULL AND y.company_id = $2::uuid)
      )
    ORDER BY p.period_no ASC
    LIMIT 1`;

  if (client) {
    const { rows } = await client.query<ResolvedFiscalPeriod>(sql, [
      entryDate,
      companyId,
    ]);
    return rows[0] ?? null;
  }

  return queryOne<ResolvedFiscalPeriod>(sql, [entryDate, companyId]);
}

export async function assertOpenFiscalPeriod(
  entryDate: string,
  companyId: string | null,
  client?: PoolClient
): Promise<ResolvedFiscalPeriod> {
  const period = await resolveOpenFiscalPeriod(entryDate, companyId, client);
  if (!period) {
    throw ApiError.badRequest(
      "Tidak ada fiscal period OPEN untuk tanggal jurnal. Konfigurasi Fiscal Years terlebih dahulu."
    );
  }
  return period;
}

async function findPeriodCoveringDate(
  entryDate: string,
  companyId: string | null
): Promise<ResolvedFiscalPeriod | null> {
  return queryOne<ResolvedFiscalPeriod>(
    `SELECT ${PERIOD_SELECT}
     FROM accounting.fiscal_periods p
     JOIN accounting.fiscal_years y
       ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
     WHERE y.is_active = true
       AND p.start_date <= $1::date
       AND p.end_date >= $1::date
       AND (
         ($2::uuid IS NULL AND y.company_id IS NULL)
         OR ($2::uuid IS NOT NULL AND y.company_id = $2::uuid)
       )
     ORDER BY p.period_no ASC
     LIMIT 1`,
    [entryDate, companyId]
  );
}

/**
 * Coverage + saran OPEN period untuk tanggal jurnal.
 * Jika period menutupi tanggal masih CLOSED, suggest buka
 * (dengan daftar previous OPEN yang perlu di-close dulu).
 */
export async function resolveFiscalCoverage(
  entryDate: string,
  companyId: string | null
): Promise<FiscalCoverageResult> {
  const open = await resolveOpenFiscalPeriod(entryDate, companyId);
  if (open) {
    return {
      date: entryDate,
      ready: true,
      period: open,
      suggestion: null,
    };
  }

  const covering = await findPeriodCoveringDate(entryDate, companyId);
  if (!covering || covering.status === "OPEN") {
    // Tidak ada period sama sekali, atau anomali
    return {
      date: entryDate,
      ready: false,
      period: null,
      suggestion: null,
    };
  }

  // Period CLOSED → cek previous OPEN di year yang sama
  const previousOpen = await query<{
    id: string;
    period_no: number;
    name: string;
  }>(
    `SELECT id, period_no, name
     FROM accounting.fiscal_periods
     WHERE fiscal_year_id = $1
       AND period_no < $2
       AND status = 'OPEN'
     ORDER BY period_no ASC`,
    [covering.fiscal_year_id, covering.period_no]
  );

  // Cek fiscal year sebelumnya masih punya OPEN
  const priorYearOpen = await queryOne<{ code: string; open_count: string }>(
    `SELECT y.code, COUNT(p.id)::text AS open_count
     FROM accounting.fiscal_years y
     JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
     JOIN accounting.fiscal_years cur ON cur.id = $1
     WHERE y.deleted_at IS NULL
       AND y.end_date < cur.start_date
       AND p.status = 'OPEN'
       AND (
         (cur.company_id IS NULL AND y.company_id IS NULL)
         OR (cur.company_id IS NOT NULL AND y.company_id = cur.company_id)
       )
     GROUP BY y.id, y.code
     HAVING COUNT(p.id) > 0
     ORDER BY y.end_date DESC
     LIMIT 1`,
    [covering.fiscal_year_id]
  );

  if (priorYearOpen) {
    const suggestion: FiscalOpenSuggestion = {
      period: covering,
      can_open: false,
      close_previous: [],
      message: `Period ${covering.name} masih CLOSED, tapi fiscal year ${priorYearOpen.code} masih punya ${priorYearOpen.open_count} period OPEN. Closing fiscal sebelumnya dulu.`,
    };
    return {
      date: entryDate,
      ready: false,
      period: null,
      suggestion,
    };
  }

  const closeNames = previousOpen.map((p) => p.name).join(", ");
  const suggestion: FiscalOpenSuggestion = {
    period: covering,
    can_open: true,
    close_previous: previousOpen,
    message:
      previousOpen.length > 0
        ? `Period ${covering.name} belum OPEN. Sistem bisa menutup ${closeNames} lalu membuka ${covering.name}.`
        : `Period ${covering.name} belum OPEN. Buka sekarang agar bisa input jurnal di tanggal ini.`,
  };

  return {
    date: entryDate,
    ready: false,
    period: null,
    suggestion,
  };
}

/**
 * Buka period target. Jika closePrevious=true, otomatis CLOSE period
 * sebelumnya yang masih OPEN di fiscal year yang sama.
 */
export async function openFiscalPeriodById(opts: {
  periodId: string;
  userId: string;
  companyId: string | null;
  closePrevious: boolean;
}): Promise<ResolvedFiscalPeriod> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<
      ResolvedFiscalPeriod & { company_id: string | null }
    >(
      `SELECT ${PERIOD_SELECT}, y.company_id
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y
         ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
       WHERE p.id = $1`,
      [opts.periodId]
    );
    const target = rows[0];
    if (!target) throw ApiError.notFound("Fiscal period tidak ditemukan");
    if (!target.fiscal_year_is_active) {
      throw ApiError.badRequest("Fiscal year tidak aktif");
    }
    if (
      opts.companyId != null &&
      target.company_id != null &&
      target.company_id !== opts.companyId
    ) {
      throw ApiError.badRequest("Fiscal period di luar scope company");
    }
    if (target.status === "OPEN") {
      return target;
    }

    // Block jika fiscal year sebelumnya belum fully closed
    const priorYearOpen = await client.query<{ code: string }>(
      `SELECT y.code
       FROM accounting.fiscal_years y
       JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
       JOIN accounting.fiscal_years cur ON cur.id = $1
       WHERE y.deleted_at IS NULL
         AND y.end_date < cur.start_date
         AND p.status = 'OPEN'
         AND (
           (cur.company_id IS NULL AND y.company_id IS NULL)
           OR (cur.company_id IS NOT NULL AND y.company_id = cur.company_id)
         )
       GROUP BY y.id, y.code
       HAVING COUNT(p.id) > 0
       LIMIT 1`,
      [target.fiscal_year_id]
    );
    if (priorYearOpen.rows[0]) {
      throw ApiError.badRequest(
        `Tidak bisa OPEN: fiscal year ${priorYearOpen.rows[0].code} belum fully CLOSED`
      );
    }

    const prevOpen = await client.query<{
      id: string;
      period_no: number;
      name: string;
    }>(
      `SELECT id, period_no, name
       FROM accounting.fiscal_periods
       WHERE fiscal_year_id = $1
         AND period_no < $2
         AND status = 'OPEN'
       ORDER BY period_no ASC`,
      [target.fiscal_year_id, target.period_no]
    );

    if (prevOpen.rows.length > 0) {
      if (!opts.closePrevious) {
        throw ApiError.badRequest(
          `Tutup period ${prevOpen.rows.map((p) => p.name).join(", ")} terlebih dahulu sebelum OPEN ${target.name}`
        );
      }
      await client.query(
        `UPDATE accounting.fiscal_periods
         SET status = 'CLOSED', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [prevOpen.rows.map((p) => p.id)]
      );
    }

    await client.query(
      `UPDATE accounting.fiscal_periods
       SET status = 'OPEN', updated_at = now()
       WHERE id = $1`,
      [opts.periodId]
    );
    await client.query(
      `UPDATE accounting.fiscal_years
       SET updated_by = $2, updated_at = now()
       WHERE id = $1`,
      [target.fiscal_year_id, opts.userId]
    );

    const refreshed = await client.query<ResolvedFiscalPeriod>(
      `SELECT ${PERIOD_SELECT}
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
       WHERE p.id = $1`,
      [opts.periodId]
    );
    return refreshed.rows[0];
  });
}

export async function listAccountingPeriods(opts: {
  companyId: string;
  fiscalYearId?: string;
  status?: "OPEN" | "CLOSED";
  search?: string;
}): Promise<AccountingPeriodListItem[]> {
  const params: unknown[] = [opts.companyId];
  const where = [
    "y.deleted_at IS NULL",
    "y.company_id = $1::uuid",
    "y.is_active = true",
  ];

  if (opts.fiscalYearId) {
    params.push(opts.fiscalYearId);
    where.push(`y.id = $${params.length}::uuid`);
  }
  if (opts.status === "OPEN" || opts.status === "CLOSED") {
    params.push(opts.status);
    where.push(`p.status = $${params.length}`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR y.code ILIKE $${params.length} OR y.name ILIKE $${params.length})`
    );
  }

  const rows = await query<
    ResolvedFiscalPeriod & {
      posted_count: number;
      draft_count: number;
    }
  >(
    `SELECT
       ${PERIOD_SELECT},
       COALESCE(je.posted_count, 0)::int AS posted_count,
       COALESCE(je.draft_count, 0)::int AS draft_count
     FROM accounting.fiscal_periods p
     JOIN accounting.fiscal_years y
       ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE e.status = 'POSTED')::int AS posted_count,
         COUNT(*) FILTER (WHERE e.status = 'DRAFT')::int AS draft_count
       FROM accounting.journal_entries e
       WHERE e.fiscal_period_id = p.id
         AND e.deleted_at IS NULL
     ) je ON true
     WHERE ${where.join(" AND ")}
     ORDER BY y.start_date DESC, p.period_no ASC`,
    params
  );

  return rows.map((r) => ({
    ...r,
    start_date: String(r.start_date).slice(0, 10),
    end_date: String(r.end_date).slice(0, 10),
    posted_count: Number(r.posted_count) || 0,
    draft_count: Number(r.draft_count) || 0,
  }));
}

async function loadPeriodForCompany(
  periodId: string,
  companyId: string
): Promise<(ResolvedFiscalPeriod & { company_id: string | null }) | null> {
  return queryOne<ResolvedFiscalPeriod & { company_id: string | null }>(
    `SELECT ${PERIOD_SELECT}, y.company_id
     FROM accounting.fiscal_periods p
     JOIN accounting.fiscal_years y
       ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
     WHERE p.id = $1
       AND y.company_id = $2::uuid`,
    [periodId, companyId]
  );
}

export async function getPeriodClosePreview(opts: {
  periodId: string;
  companyId: string;
}): Promise<PeriodClosePreview> {
  const period = await loadPeriodForCompany(opts.periodId, opts.companyId);
  if (!period) throw ApiError.notFound("Fiscal period tidak ditemukan");

  const draftEntries = await query<{
    id: string;
    entry_no: string;
    entry_date: string;
    description: string | null;
  }>(
    `SELECT id, entry_no, entry_date::text AS entry_date, description
     FROM accounting.journal_entries
     WHERE fiscal_period_id = $1
       AND deleted_at IS NULL
       AND status = 'DRAFT'
     ORDER BY entry_date ASC, entry_no ASC
     LIMIT 20`,
    [opts.periodId]
  );

  const counts = await queryOne<{
    posted_count: number;
    draft_count: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted_count,
       COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft_count
     FROM accounting.journal_entries
     WHERE fiscal_period_id = $1
       AND deleted_at IS NULL`,
    [opts.periodId]
  );

  const posted_count = Number(counts?.posted_count) || 0;
  const draft_count = Number(counts?.draft_count) || 0;
  const blockers: string[] = [];

  if (period.status === "CLOSED") {
    blockers.push(`Period ${period.name} sudah CLOSED`);
  }
  if (!period.fiscal_year_is_active) {
    blockers.push("Fiscal year tidak aktif");
  }
  if (draft_count > 0) {
    blockers.push(
      `Masih ada ${draft_count} jurnal DRAFT. Posting atau hapus dulu sebelum closing.`
    );
  }

  return {
    period: {
      id: period.id,
      fiscal_year_id: period.fiscal_year_id,
      period_no: period.period_no,
      name: period.name,
      start_date: String(period.start_date).slice(0, 10),
      end_date: String(period.end_date).slice(0, 10),
      status: period.status,
      fiscal_year_code: period.fiscal_year_code,
      fiscal_year_name: period.fiscal_year_name,
      fiscal_year_is_active: period.fiscal_year_is_active,
    },
    posted_count,
    draft_count,
    draft_entries: draftEntries.map((e) => ({
      ...e,
      entry_date: String(e.entry_date).slice(0, 10),
    })),
    can_close: blockers.length === 0,
    blockers,
  };
}

/**
 * Soft-close period: set status CLOSED. Blocks if DRAFT journals remain.
 * Does not create closing journals.
 */
export async function closeFiscalPeriodById(opts: {
  periodId: string;
  userId: string;
  companyId: string;
}): Promise<ResolvedFiscalPeriod> {
  const preview = await getPeriodClosePreview({
    periodId: opts.periodId,
    companyId: opts.companyId,
  });
  if (!preview.can_close) {
    throw ApiError.badRequest(preview.blockers[0] || "Period tidak bisa ditutup");
  }

  return withTransaction(async (client) => {
    // Re-check drafts inside transaction
    const { rows: draftRows } = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
       FROM accounting.journal_entries
       WHERE fiscal_period_id = $1
         AND deleted_at IS NULL
         AND status = 'DRAFT'`,
      [opts.periodId]
    );
    if ((draftRows[0]?.c ?? 0) > 0) {
      throw ApiError.badRequest(
        `Masih ada ${draftRows[0].c} jurnal DRAFT. Posting atau hapus dulu sebelum closing.`
      );
    }

    await client.query(
      `UPDATE accounting.fiscal_periods
       SET status = 'CLOSED', updated_at = now()
       WHERE id = $1 AND status = 'OPEN'`,
      [opts.periodId]
    );
    await client.query(
      `UPDATE accounting.fiscal_years
       SET updated_by = $2, updated_at = now()
       WHERE id = $1`,
      [preview.period.fiscal_year_id, opts.userId]
    );

    const refreshed = await client.query<ResolvedFiscalPeriod>(
      `SELECT ${PERIOD_SELECT}
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
       WHERE p.id = $1`,
      [opts.periodId]
    );
    const row = refreshed.rows[0];
    if (!row) throw new Error("Fiscal period tidak ditemukan setelah close");
    if (row.status !== "CLOSED") {
      throw new Error(`Period ${row.name} gagal ditutup`);
    }
    return {
      ...row,
      start_date: String(row.start_date).slice(0, 10),
      end_date: String(row.end_date).slice(0, 10),
    };
  });
}

/** 404 bila period tidak ada, 403 bila company-nya di luar scope user. */
export async function assertFiscalPeriodInScope(
  periodId: string,
  scope: UserScope | null
): Promise<void> {
  const row = await queryOne<{ id: string; company_id: string | null }>(
    `SELECT p.id, y.company_id
     FROM accounting.fiscal_periods p
     JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE p.id = $1 AND y.deleted_at IS NULL`,
    [periodId]
  );
  assertRecordInScope(row ?? null, scope, {
    notFound: "Fiscal period tidak ditemukan",
    outOfScope: "Fiscal period di luar scope",
  });
}
