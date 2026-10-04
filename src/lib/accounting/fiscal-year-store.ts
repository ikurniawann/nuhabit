import { ApiError } from "@/lib/api/auth";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import type {
  FiscalPeriodItem,
  FiscalPeriodPayload,
  FiscalYearItem,
  FiscalYearPayload,
} from "./types";
import type { FiscalPeriodStatus } from "@/lib/accounting/fiscal-types";
import { findOpenSequenceViolation } from "@/lib/accounting/fiscal-periods";

type YearRow = {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
};

type PeriodRow = {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
};

function mapPeriod(row: PeriodRow): FiscalPeriodItem {
  return {
    id: row.id,
    fiscal_year_id: row.fiscal_year_id,
    period_no: row.period_no,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status as FiscalPeriodStatus,
  };
}

function mapYear(row: YearRow, periods: FiscalPeriodItem[]): FiscalYearItem {
  return {
    id: row.id,
    company_id: row.company_id,
    code: row.code,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    periods,
    open_periods_count: periods.filter((p) => p.status === "OPEN").length,
  };
}

export async function fetchPeriodsForYears(
  yearIds: string[]
): Promise<Map<string, FiscalPeriodItem[]>> {
  const map = new Map<string, FiscalPeriodItem[]>();
  if (yearIds.length === 0) return map;

  const rows = await query<PeriodRow>(
    `SELECT id, fiscal_year_id, period_no, name,
            start_date::text AS start_date,
            end_date::text AS end_date,
            status
     FROM accounting.fiscal_periods
     WHERE fiscal_year_id = ANY($1::uuid[])
     ORDER BY period_no ASC`,
    [yearIds]
  );

  for (const row of rows) {
    const list = map.get(row.fiscal_year_id) ?? [];
    list.push(mapPeriod(row));
    map.set(row.fiscal_year_id, list);
  }
  return map;
}

export async function listFiscalYears(opts: {
  search?: string;
  isActive?: string;
  companyScopeOr: string | null;
}): Promise<FiscalYearItem[]> {
  const clauses = ["y.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (opts.isActive === "true") clauses.push("y.is_active = true");
  if (opts.isActive === "false") clauses.push("y.is_active = false");
  if (opts.search) {
    params.push(`%${opts.search}%`);
    clauses.push(
      `(y.code ILIKE $${params.length} OR y.name ILIKE $${params.length})`
    );
  }
  if (opts.companyScopeOr) {
    const match = opts.companyScopeOr.match(/company_id\.eq\.(.+)$/);
    if (match?.[1]) {
      params.push(match[1]);
      clauses.push(`y.company_id = $${params.length}`);
    }
  }

  const rows = await query<YearRow>(
    `SELECT y.id, y.company_id, y.code, y.name,
            y.start_date::text AS start_date,
            y.end_date::text AS end_date,
            y.is_active, y.created_at, y.updated_at
     FROM accounting.fiscal_years y
     WHERE ${clauses.join(" AND ")}
     ORDER BY y.start_date DESC, y.code ASC`,
    params
  );

  const periodMap = await fetchPeriodsForYears(rows.map((r) => r.id));
  return rows.map((r) => mapYear(r, periodMap.get(r.id) ?? []));
}

export async function getFiscalYear(
  id: string
): Promise<FiscalYearItem | null> {
  const row = await queryOne<YearRow>(
    `SELECT y.id, y.company_id, y.code, y.name,
            y.start_date::text AS start_date,
            y.end_date::text AS end_date,
            y.is_active, y.created_at, y.updated_at
     FROM accounting.fiscal_years y
     WHERE y.id = $1 AND y.deleted_at IS NULL`,
    [id]
  );
  if (!row) return null;
  const periodMap = await fetchPeriodsForYears([id]);
  return mapYear(row, periodMap.get(id) ?? []);
}

function validatePeriods(
  yearStart: string,
  yearEnd: string,
  periods: FiscalPeriodPayload[]
) {
  if (periods.length < 1 || periods.length > 12) {
    throw ApiError.badRequest("Fiscal year harus punya 1–12 period");
  }
  const nos = new Set<number>();
  for (const p of periods) {
    if (p.period_no < 1 || p.period_no > 12) {
      throw ApiError.badRequest("period_no harus antara 1–12");
    }
    if (nos.has(p.period_no)) {
      throw ApiError.badRequest(`period_no ${p.period_no} duplikat`);
    }
    nos.add(p.period_no);
    if (p.end_date < p.start_date) {
      throw ApiError.badRequest(`Period ${p.period_no}: end_date < start_date`);
    }
    if (p.start_date < yearStart || p.end_date > yearEnd) {
      throw ApiError.badRequest(
        `Period ${p.period_no} harus berada dalam rentang fiscal year`
      );
    }
    if (p.status !== "OPEN" && p.status !== "CLOSED") {
      throw ApiError.badRequest(`Period ${p.period_no}: status tidak valid`);
    }
  }
  const sequenceError = findOpenSequenceViolation(periods);
  if (sequenceError) throw ApiError.badRequest(sequenceError);
}

/**
 * Fiscal year baru / aktif dengan period OPEN hanya boleh jika
 * semua fiscal year sebelumnya (end_date < start_date) sudah fully CLOSED.
 */
async function assertPreviousFiscalYearsClosed(
  client: PoolClient,
  opts: {
    companyId: string | null;
    startDate: string;
    excludeYearId?: string;
    hasOpenPeriod: boolean;
  }
) {
  if (!opts.hasOpenPeriod) return;

  const { rows } = await client.query<{
    code: string;
    name: string;
    open_count: string;
  }>(
    `SELECT y.code, y.name, COUNT(p.id) FILTER (WHERE p.status = 'OPEN')::text AS open_count
     FROM accounting.fiscal_years y
     JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.deleted_at IS NULL
       AND y.end_date < $1::date
       AND (
         ($2::uuid IS NULL AND y.company_id IS NULL)
         OR ($2::uuid IS NOT NULL AND y.company_id = $2::uuid)
       )
       AND ($3::uuid IS NULL OR y.id <> $3::uuid)
     GROUP BY y.id, y.code, y.name
     HAVING COUNT(p.id) FILTER (WHERE p.status = 'OPEN') > 0
     ORDER BY y.end_date DESC
     LIMIT 1`,
    [opts.startDate, opts.companyId, opts.excludeYearId ?? null]
  );

  if (rows[0]) {
    throw ApiError.badRequest(
      `Tidak bisa OPEN fiscal: fiscal year ${rows[0].code} (${rows[0].name}) masih punya ${rows[0].open_count} period OPEN. Closing semua period fiscal sebelumnya terlebih dahulu.`
    );
  }
}

async function replacePeriods(
  client: PoolClient,
  yearId: string,
  periods: FiscalPeriodPayload[]
) {
  await client.query(
    `DELETE FROM accounting.fiscal_periods WHERE fiscal_year_id = $1`,
    [yearId]
  );

  for (const p of periods) {
    await client.query(
      `INSERT INTO accounting.fiscal_periods (
         fiscal_year_id, period_no, name, start_date, end_date, status
       ) VALUES ($1,$2,$3,$4::date,$5::date,$6)`,
      [yearId, p.period_no, p.name, p.start_date, p.end_date, p.status]
    );
  }
}

export async function createFiscalYearRecord(opts: {
  userId: string;
  companyId: string | null;
  payload: FiscalYearPayload;
}): Promise<FiscalYearItem> {
  const { payload } = opts;
  if (payload.end_date < payload.start_date) {
    throw ApiError.badRequest("end_date harus >= start_date");
  }
  validatePeriods(payload.start_date, payload.end_date, payload.periods);

  const id = await withTransaction(async (client) => {
    await assertPreviousFiscalYearsClosed(client, {
      companyId: opts.companyId,
      startDate: payload.start_date,
      hasOpenPeriod: payload.periods.some((p) => p.status === "OPEN"),
    });

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO accounting.fiscal_years (
         company_id, code, name, start_date, end_date,
         is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$7)
       RETURNING id`,
      [
        opts.companyId,
        payload.code.trim(),
        payload.name.trim(),
        payload.start_date,
        payload.end_date,
        payload.is_active ?? true,
        opts.userId,
      ]
    );
    const yearId = inserted.rows[0].id;
    await replacePeriods(client, yearId, payload.periods);
    return yearId;
  });

  const detail = await getFiscalYear(id);
  if (!detail) throw new Error("Gagal memuat fiscal year setelah create");
  return detail;
}

export async function updateFiscalYearRecord(opts: {
  id: string;
  userId: string;
  payload: FiscalYearPayload;
}): Promise<FiscalYearItem> {
  const { payload } = opts;
  if (payload.end_date < payload.start_date) {
    throw ApiError.badRequest("end_date harus >= start_date");
  }
  validatePeriods(payload.start_date, payload.end_date, payload.periods);

  await withTransaction(async (client) => {
    const yearRow = await client.query<{ company_id: string | null }>(
      `SELECT company_id FROM accounting.fiscal_years
       WHERE id = $1 AND deleted_at IS NULL`,
      [opts.id]
    );
    if (!yearRow.rows[0]) throw ApiError.notFound("Fiscal year tidak ditemukan");

    await assertPreviousFiscalYearsClosed(client, {
      companyId: yearRow.rows[0].company_id,
      startDate: payload.start_date,
      excludeYearId: opts.id,
      hasOpenPeriod: payload.periods.some((p) => p.status === "OPEN"),
    });

    // Block delete of periods that still have journal entries
    const used = await client.query<{ period_no: number }>(
      `SELECT DISTINCT p.period_no
       FROM accounting.fiscal_periods p
       JOIN accounting.journal_entries e
         ON e.fiscal_period_id = p.id AND e.deleted_at IS NULL
       WHERE p.fiscal_year_id = $1`,
      [opts.id]
    );
    if (used.rows.length > 0) {
      const keepNos = new Set(payload.periods.map((p) => p.period_no));
      for (const row of used.rows) {
        if (!keepNos.has(row.period_no)) {
          throw ApiError.badRequest(
            `Period ${row.period_no} masih dipakai journal entry dan tidak boleh dihapus`
          );
        }
      }
      // Prefer update-in-place for used periods to keep FK stable
      for (const p of payload.periods) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM accounting.fiscal_periods
           WHERE fiscal_year_id = $1 AND period_no = $2`,
          [opts.id, p.period_no]
        );
        if (existing.rows[0]) {
          await client.query(
            `UPDATE accounting.fiscal_periods
             SET name = $1, start_date = $2::date, end_date = $3::date,
                 status = $4, updated_at = now()
             WHERE id = $5`,
            [
              p.name,
              p.start_date,
              p.end_date,
              p.status,
              existing.rows[0].id,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO accounting.fiscal_periods (
               fiscal_year_id, period_no, name, start_date, end_date, status
             ) VALUES ($1,$2,$3,$4::date,$5::date,$6)`,
            [
              opts.id,
              p.period_no,
              p.name,
              p.start_date,
              p.end_date,
              p.status,
            ]
          );
        }
      }
      // Remove unused periods only
      await client.query(
        `DELETE FROM accounting.fiscal_periods p
         WHERE p.fiscal_year_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM accounting.journal_entries e
             WHERE e.fiscal_period_id = p.id AND e.deleted_at IS NULL
           )
           AND p.period_no <> ALL($2::int[])`,
        [opts.id, payload.periods.map((p) => p.period_no)]
      );
    } else {
      await replacePeriods(client, opts.id, payload.periods);
    }

    await client.query(
      `UPDATE accounting.fiscal_years
       SET code = $1, name = $2,
           start_date = $3::date, end_date = $4::date,
           is_active = $5, updated_by = $6, updated_at = now()
       WHERE id = $7 AND deleted_at IS NULL`,
      [
        payload.code.trim(),
        payload.name.trim(),
        payload.start_date,
        payload.end_date,
        payload.is_active ?? true,
        opts.userId,
        opts.id,
      ]
    );
  });

  const detail = await getFiscalYear(opts.id);
  if (!detail) throw new Error("Gagal memuat fiscal year setelah update");
  return detail;
}

export async function softDeleteFiscalYear(
  id: string,
  userId: string
): Promise<void> {
  const inUse = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM accounting.journal_entries e
     JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
     WHERE p.fiscal_year_id = $1 AND e.deleted_at IS NULL`,
    [id]
  );
  if (inUse && Number(inUse.n) > 0) {
    throw ApiError.badRequest(
      "Fiscal year masih dipakai journal entry dan tidak bisa dihapus"
    );
  }

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM accounting.fiscal_periods WHERE fiscal_year_id = $1`,
      [id]
    );
    await client.query(
      `UPDATE accounting.fiscal_years
       SET deleted_at = now(), deleted_by = $2,
           is_active = false, updated_by = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId]
    );
  });
}
