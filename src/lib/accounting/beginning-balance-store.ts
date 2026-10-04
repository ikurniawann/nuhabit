import { ApiError } from "@/lib/api/auth";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import type {
  BeginningBalanceLine,
  BeginningBalanceSavePayload,
  BeginningBalanceSuggestion,
} from "./types";
import { PL_ACCOUNT_TYPES } from "./types";
import type { JournalLineSide } from "@/lib/accounting/fiscal-types";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type YearRow = {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
};

type BalanceAgg = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type_code: string;
  normal_balance: string;
  is_contra: boolean;
  debit: string;
  credit: string;
};

function isPlType(code: string) {
  return (PL_ACCOUNT_TYPES as readonly string[]).includes(code);
}

/** Net position → single opening line (debit or credit). */
function lineFromNet(
  debit: number,
  credit: number
): { entry_side: JournalLineSide; amount: number } | null {
  const net = round2(debit - credit);
  if (net > 0) return { entry_side: "DEBIT", amount: net };
  if (net < 0) return { entry_side: "CREDIT", amount: round2(-net) };
  return null;
}

async function findRetainedEarningsAccount(
  companyId: string | null
): Promise<{ id: string; code: string; name: string } | null> {
  return queryOne<{ id: string; code: string; name: string }>(
    `SELECT coa.id, coa.code, coa.name
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     WHERE coa.deleted_at IS NULL
       AND coa.is_postable = true
       AND coa.is_active = true
       AND t.code = 'EQUITY'
       AND (
         ($1::uuid IS NULL AND coa.company_id IS NULL)
         OR ($1::uuid IS NOT NULL AND coa.company_id = $1::uuid)
       )
       AND (
         coa.name ILIKE '%retained%earn%'
         OR coa.name ILIKE '%laba%ditahan%'
         OR coa.name ILIKE '%laba ditahan%'
         OR coa.code LIKE '32%'
         OR coa.code LIKE '3102%'
       )
     ORDER BY coa.code ASC
     LIMIT 1`,
    [companyId]
  );
}

async function getExistingOpening(fiscalYearId: string) {
  return queryOne<{
    id: string;
    status: string;
  }>(
    `SELECT id, status
     FROM accounting.journal_entries
     WHERE entry_type = 'OPENING'
       AND source_fiscal_year_id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [fiscalYearId]
  );
}

export async function getBeginningBalanceSuggestion(
  fiscalYearId: string
): Promise<BeginningBalanceSuggestion> {
  const year = await queryOne<YearRow>(
    `SELECT id, company_id, code, name,
            start_date::text AS start_date,
            end_date::text AS end_date,
            is_active
     FROM accounting.fiscal_years
     WHERE id = $1 AND deleted_at IS NULL`,
    [fiscalYearId]
  );
  if (!year) throw ApiError.notFound("Fiscal year tidak ditemukan");

  const period1 = await queryOne<{ id: string; name: string; status: string }>(
    `SELECT id, name, status
     FROM accounting.fiscal_periods
     WHERE fiscal_year_id = $1
     ORDER BY period_no ASC
     LIMIT 1`,
    [fiscalYearId]
  );

  const existing = await getExistingOpening(fiscalYearId);
  const reAccount = await findRetainedEarningsAccount(year.company_id);

  const prior = await queryOne<{
    id: string;
    code: string;
    name: string;
    end_date: string;
    open_count: string;
  }>(
    `SELECT y.id, y.code, y.name, y.end_date::text AS end_date,
            COALESCE(
              (SELECT COUNT(*)::text
               FROM accounting.fiscal_periods p
               WHERE p.fiscal_year_id = y.id AND p.status = 'OPEN'),
              '0'
            ) AS open_count
     FROM accounting.fiscal_years y
     WHERE y.deleted_at IS NULL
       AND y.end_date < $1::date
       AND (
         ($2::uuid IS NULL AND y.company_id IS NULL)
         OR ($2::uuid IS NOT NULL AND y.company_id = $2::uuid)
       )
     ORDER BY y.end_date DESC
     LIMIT 1`,
    [year.start_date, year.company_id]
  );

  // If existing OPENING JE, return its lines as editable state
  if (existing) {
    const lines = await query<{
      account_id: string;
      account_code: string;
      account_name: string;
      account_type_code: string;
      normal_balance: string;
      is_contra: boolean;
      entry_side: string;
      amount: string;
    }>(
      `SELECT l.account_id, coa.code AS account_code, coa.name AS account_name,
              t.code AS account_type_code, t.normal_balance, coa.is_contra,
              l.entry_side, l.amount::text AS amount
       FROM accounting.journal_entry_lines l
       JOIN accounting.chart_of_accounts coa ON coa.id = l.account_id
       JOIN accounting.account_types t ON t.id = coa.account_type_id
       WHERE l.entry_id = $1
       ORDER BY l.sort_order ASC`,
      [existing.id]
    );

    const mapped: BeginningBalanceLine[] = lines.map((l) => ({
      account_id: l.account_id,
      account_code: formatAccountCodeDisplay(l.account_code),
      account_name: l.account_name,
      account_type_code: l.account_type_code,
      normal_balance: l.normal_balance as "DEBIT" | "CREDIT",
      is_contra: l.is_contra,
      suggested_amount: Number(l.amount),
      amount: Number(l.amount),
      entry_side: l.entry_side as JournalLineSide,
      source:
        reAccount && l.account_id === reAccount.id
          ? "RETAINED_EARNINGS"
          : "MANUAL",
    }));

    const total_debit = round2(
      mapped
        .filter((l) => l.entry_side === "DEBIT")
        .reduce((s, l) => s + l.amount, 0)
    );
    const total_credit = round2(
      mapped
        .filter((l) => l.entry_side === "CREDIT")
        .reduce((s, l) => s + l.amount, 0)
    );

    return {
      fiscal_year_id: year.id,
      fiscal_year_code: year.code,
      fiscal_year_name: year.name,
      start_date: year.start_date,
      period_id: period1?.id ?? null,
      period_name: period1?.name ?? null,
      prior_fiscal_year: prior
        ? {
            id: prior.id,
            code: prior.code,
            name: prior.name,
            end_date: prior.end_date,
            is_fully_closed: Number(prior.open_count) === 0,
          }
        : null,
      retained_earnings_account: reAccount
        ? {
            id: reAccount.id,
            code: formatAccountCodeDisplay(reAccount.code),
            name: reAccount.name,
          }
        : null,
      lines: mapped,
      total_debit,
      total_credit,
      existing_entry_id: existing.id,
      existing_status: existing.status as "DRAFT" | "POSTED",
      can_edit: existing.status === "DRAFT",
      is_first_year: !prior,
      message:
        existing.status === "POSTED"
          ? "Beginning balance sudah POSTED dan terkunci."
          : "Beginning balance draft — bisa diedit.",
    };
  }

  const lines: BeginningBalanceLine[] = [];
  let message: string | null = null;

  if (!prior) {
    message =
      `Fiscal ${year.code} adalah fiscal year pertama. Tidak ada FY sebelumnya untuk di-suggest — isi saldo awal Kas & Bank secara manual, lalu simpan/post.`;
  } else if (Number(prior.open_count) > 0) {
    message = `Fiscal ${prior.code} belum fully CLOSED (${prior.open_count} period OPEN). Suggest saldo akhir belum final — sebaiknya closing dulu.`;
  }

  if (prior) {
    const aggs = await query<BalanceAgg>(
      `SELECT
         coa.id AS account_id,
         coa.code AS account_code,
         coa.name AS account_name,
         t.code AS account_type_code,
         t.normal_balance,
         coa.is_contra,
         COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
         COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e
         ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED'
       JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
       JOIN accounting.chart_of_accounts coa
         ON coa.id = l.account_id AND coa.deleted_at IS NULL AND coa.is_postable = true
       JOIN accounting.account_types t ON t.id = coa.account_type_id
       WHERE p.fiscal_year_id = $1
       GROUP BY coa.id, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra
       HAVING COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)
            <> COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)
       ORDER BY coa.code ASC`,
      [prior.id]
    );

    let plNetCredit = 0; // positive = credit Retained Earnings (laba)

    for (const row of aggs) {
      const debit = Number(row.debit);
      const credit = Number(row.credit);

      if (isPlType(row.account_type_code)) {
        // Net credit dari P&L → naikkan equity (RE credit)
        plNetCredit += credit - debit;
        continue;
      }

      const pos = lineFromNet(debit, credit);
      if (!pos) continue;

      lines.push({
        account_id: row.account_id,
        account_code: formatAccountCodeDisplay(row.account_code),
        account_name: row.account_name,
        account_type_code: row.account_type_code,
        normal_balance: row.normal_balance as "DEBIT" | "CREDIT",
        is_contra: row.is_contra,
        suggested_amount: pos.amount,
        amount: pos.amount,
        entry_side: pos.entry_side,
        source: "PRIOR_BS",
      });
    }

    const reNet = round2(plNetCredit);
    if (reNet !== 0 && reAccount) {
      const entry_side: JournalLineSide = reNet > 0 ? "CREDIT" : "DEBIT";
      lines.push({
        account_id: reAccount.id,
        account_code: formatAccountCodeDisplay(reAccount.code),
        account_name: reAccount.name,
        account_type_code: "EQUITY",
        normal_balance: "CREDIT",
        is_contra: false,
        suggested_amount: Math.abs(reNet),
        amount: Math.abs(reNet),
        entry_side,
        source: "RETAINED_EARNINGS",
      });
    } else if (reNet !== 0 && !reAccount) {
      message =
        (message ? message + " " : "") +
        `Laba/rugi bersih ${reNet} perlu akun Retained Earnings (Equity) — buat/pilih akun Laba Ditahan di COA.`;
    }

    if (!message && prior) {
      message = `Suggest dari saldo akhir ${prior.code} (POSTED). Angka bisa diedit sebelum simpan.`;
    }
  }

  // Sort: assets, liabilities, equity
  const typeOrder: Record<string, number> = {
    ASSET: 1,
    LIABILITY: 2,
    EQUITY: 3,
  };
  lines.sort(
    (a, b) =>
      (typeOrder[a.account_type_code] ?? 9) -
        (typeOrder[b.account_type_code] ?? 9) ||
      a.account_code.localeCompare(b.account_code)
  );

  const total_debit = round2(
    lines.filter((l) => l.entry_side === "DEBIT").reduce((s, l) => s + l.amount, 0)
  );
  const total_credit = round2(
    lines
      .filter((l) => l.entry_side === "CREDIT")
      .reduce((s, l) => s + l.amount, 0)
  );

  return {
    fiscal_year_id: year.id,
    fiscal_year_code: year.code,
    fiscal_year_name: year.name,
    start_date: year.start_date,
    period_id: period1?.id ?? null,
    period_name: period1?.name ?? null,
    prior_fiscal_year: prior
      ? {
          id: prior.id,
          code: prior.code,
          name: prior.name,
          end_date: prior.end_date,
          is_fully_closed: Number(prior.open_count) === 0,
        }
      : null,
    retained_earnings_account: reAccount
      ? {
          id: reAccount.id,
          code: formatAccountCodeDisplay(reAccount.code),
          name: reAccount.name,
        }
      : null,
    lines,
    total_debit,
    total_credit,
    existing_entry_id: null,
    existing_status: null,
    can_edit: true,
    is_first_year: !prior,
    message,
  };
}

async function nextOpeningNo(
  client: PoolClient,
  startDate: string,
  companyId: string | null
): Promise<string> {
  const y = startDate.slice(0, 4);
  const prefix = `OB-${y}-`;
  const { rows } = await client.query<{ entry_no: string }>(
    `SELECT entry_no
     FROM accounting.journal_entries
     WHERE deleted_at IS NULL
       AND entry_no LIKE $1
       AND (
         ($2::uuid IS NULL AND company_id IS NULL)
         OR ($2::uuid IS NOT NULL AND company_id = $2::uuid)
       )
     ORDER BY entry_no DESC
     LIMIT 1
     FOR UPDATE`,
    [`${prefix}%`, companyId]
  );
  let seq = 1;
  if (rows[0]) {
    const n = Number.parseInt(rows[0].entry_no.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function saveBeginningBalance(opts: {
  fiscalYearId: string;
  userId: string;
  payload: BeginningBalanceSavePayload;
}): Promise<{ entry_id: string; status: string }> {
  const suggestion = await getBeginningBalanceSuggestion(opts.fiscalYearId);
  if (!suggestion.can_edit && suggestion.existing_entry_id) {
    throw ApiError.badRequest("Beginning balance sudah POSTED dan tidak bisa diubah");
  }
  if (!suggestion.period_id) {
    throw ApiError.badRequest("Fiscal year belum punya period");
  }

  const lines = opts.payload.lines.filter((l) => l.amount > 0);
  if (lines.length < 2) {
    throw ApiError.badRequest("Minimal 2 baris saldo awal (debit & credit)");
  }

  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (l.entry_side === "DEBIT") debit += l.amount;
    else credit += l.amount;
  }
  if (round2(debit) !== round2(credit)) {
    throw ApiError.badRequest(
      `Saldo awal tidak balance: Debit ${round2(debit)} ≠ Credit ${round2(credit)}`
    );
  }

  const year = await queryOne<YearRow>(
    `SELECT id, company_id, code, name,
            start_date::text AS start_date,
            end_date::text AS end_date,
            is_active
     FROM accounting.fiscal_years
     WHERE id = $1 AND deleted_at IS NULL`,
    [opts.fiscalYearId]
  );
  if (!year) throw ApiError.notFound("Fiscal year tidak ditemukan");

  // Ensure period 1 is OPEN for opening date
  const period = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM accounting.fiscal_periods WHERE id = $1`,
    [suggestion.period_id]
  );
  if (!period) throw ApiError.notFound("Period 1 tidak ditemukan");

  const post = opts.payload.post ?? false;

  return withTransaction(async (client) => {
    if (period.status !== "OPEN") {
      await client.query(
        `UPDATE accounting.fiscal_periods
         SET status = 'OPEN', updated_at = now()
         WHERE id = $1`,
        [period.id]
      );
    }

    let entryId = suggestion.existing_entry_id;

    if (entryId) {
      await client.query(
        `UPDATE accounting.journal_entries
         SET description = $1,
             entry_date = $2::date,
             fiscal_period_id = $3,
             status = $4::varchar,
             posted_at = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_at, now()) ELSE NULL END,
             posted_by = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_by, $5::uuid) ELSE NULL END,
             updated_by = $5::uuid,
             updated_at = now()
         WHERE id = $6::uuid AND deleted_at IS NULL AND status = 'DRAFT'`,
        [
          `Beginning balance ${year.code}`,
          year.start_date,
          period.id,
          post ? "POSTED" : "DRAFT",
          opts.userId,
          entryId,
        ]
      );
      await client.query(
        `DELETE FROM accounting.journal_entry_lines WHERE entry_id = $1`,
        [entryId]
      );
    } else {
      const entryNo = await nextOpeningNo(
        client,
        year.start_date,
        year.company_id
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO accounting.journal_entries (
           company_id, entry_no, entry_date, description,
           fiscal_period_id, status, is_recon, entry_type,
           source_fiscal_year_id,
           posted_at, posted_by, created_by, updated_by
         ) VALUES (
           $1,$2,$3::date,$4,$5,$6::varchar,false,'OPENING',$7,
           CASE WHEN $6::text = 'POSTED' THEN now() ELSE NULL END,
           CASE WHEN $6::text = 'POSTED' THEN $8::uuid ELSE NULL END,
           $8::uuid,$8::uuid
         )
         RETURNING id`,
        [
          year.company_id,
          entryNo,
          year.start_date,
          `Beginning balance ${year.code}`,
          period.id,
          post ? "POSTED" : "DRAFT",
          year.id,
          opts.userId,
        ]
      );
      entryId = inserted.rows[0].id;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await client.query(
        `INSERT INTO accounting.journal_entry_lines (
           entry_id, account_id, entry_side, amount, memo, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          entryId,
          line.account_id,
          line.entry_side,
          round2(line.amount),
          line.memo?.trim() || null,
          (i + 1) * 10,
        ]
      );
    }

    return { entry_id: entryId!, status: post ? "POSTED" : "DRAFT" };
  });
}
