import { query, queryOne } from "@/lib/db";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import type { AccountTypeCode, CashFlowCategory } from "@/lib/accounting/coa-types";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type ReportAccountBalance = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  account_type_code: AccountTypeCode;
  normal_balance: "DEBIT" | "CREDIT";
  is_contra: boolean;
  is_cash_bank: boolean;
  cash_flow_category: CashFlowCategory | null;
  level: number;
  debit: number;
  credit: number;
  /** Signed balance by normal balance (contra flips). */
  balance: number;
};

export type TrialBalanceReport = {
  as_of: string;
  rows: ReportAccountBalance[];
  total_debit: number;
  total_credit: number;
};

export type BalanceSheetReport = {
  as_of: string;
  assets: ReportAccountBalance[];
  liabilities: ReportAccountBalance[];
  equity: ReportAccountBalance[];
  current_year_earnings: number;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  total_liabilities_and_equity: number;
};

export type IncomeStatementReport = {
  date_from: string;
  date_to: string;
  revenue: ReportAccountBalance[];
  cogs: ReportAccountBalance[];
  expenses: ReportAccountBalance[];
  other_income: ReportAccountBalance[];
  other_expenses: ReportAccountBalance[];
  total_revenue: number;
  total_cogs: number;
  gross_profit: number;
  total_expenses: number;
  operating_income: number;
  total_other_income: number;
  total_other_expenses: number;
  net_income: number;
};

export type CashFlowSection = {
  category: CashFlowCategory;
  rows: ReportAccountBalance[];
  total: number;
};

export type CashFlowReport = {
  date_from: string;
  date_to: string;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  non_cash: CashFlowSection;
  net_cash_change: number;
  cash_opening: number;
  cash_closing: number;
};

export type GeneralLedgerLine = {
  line_id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  entry_type: string;
  description: string | null;
  memo: string | null;
  entry_side: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  running_balance: number;
};

export type GeneralLedgerReport = {
  account: {
    id: string;
    code: string;
    code_display: string;
    name: string;
    account_type_code: string;
    normal_balance: "DEBIT" | "CREDIT";
  };
  date_from: string | null;
  date_to: string | null;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  lines: GeneralLedgerLine[];
};

export type GeneralLedgerAccountOption = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  account_type_code: string;
  balance: number;
};

function asNormal(v: string): "DEBIT" | "CREDIT" {
  return v === "CREDIT" ? "CREDIT" : "DEBIT";
}

function computeBalance(
  debit: number,
  credit: number,
  normal: "DEBIT" | "CREDIT",
  isContra: boolean
) {
  const raw = normal === "DEBIT" ? debit - credit : credit - debit;
  return round2(isContra ? -raw : raw);
}

function signedDelta(
  side: string,
  amount: number,
  normal: "DEBIT" | "CREDIT",
  isContra: boolean
) {
  const increase =
    (normal === "DEBIT" && side === "DEBIT") ||
    (normal === "CREDIT" && side === "CREDIT");
  const delta = increase ? amount : -amount;
  return isContra ? -delta : delta;
}

const PL_TYPES = new Set([
  "REVENUE",
  "COGS",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
]);

const BS_TYPES = new Set(["ASSET", "LIABILITY", "EQUITY"]);

/**
 * All active postable COA for company, with aggregated posted activity.
 * Accounts without mutasi return debit/credit/balance = 0.
 */
async function loadPostableBalances(
  companyId: string,
  opts: { asOf?: string; dateFrom?: string; dateTo?: string }
): Promise<ReportAccountBalance[]> {
  const params: unknown[] = [companyId];
  const dateClauses: string[] = [
    "e.deleted_at IS NULL",
    "e.status = 'POSTED'",
    "e.company_id = $1::uuid",
  ];

  if (opts.asOf) {
    params.push(opts.asOf);
    dateClauses.push(`e.entry_date <= $${params.length}::date`);
  }
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    dateClauses.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    dateClauses.push(`e.entry_date <= $${params.length}::date`);
  }

  const rows = await query<{
    id: string;
    code: string;
    name: string;
    account_type_code: string;
    normal_balance: string;
    is_contra: boolean;
    is_cash_bank: boolean;
    cash_flow_category: string | null;
    level: number;
    debit: string;
    credit: string;
  }>(
    `SELECT
       coa.id,
       coa.code,
       coa.name,
       t.code AS account_type_code,
       t.normal_balance,
       coa.is_contra,
       coa.is_cash_bank,
       coa.cash_flow_category,
       coa.level,
       COALESCE(SUM(mov.debit), 0)::text AS debit,
       COALESCE(SUM(mov.credit), 0)::text AS credit
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     LEFT JOIN (
       SELECT
         l.account_id,
         CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END AS debit,
         CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e ON e.id = l.entry_id
       WHERE ${dateClauses.join(" AND ")}
     ) mov ON mov.account_id = coa.id
     WHERE coa.deleted_at IS NULL
       AND coa.is_active = true
       AND coa.is_postable = true
       AND coa.company_id = $1::uuid
     GROUP BY
       coa.id, coa.code, coa.name, t.code, t.normal_balance,
       coa.is_contra, coa.is_cash_bank, coa.cash_flow_category, coa.level
     ORDER BY coa.code ASC`,
    params
  );

  return rows.map((row) => {
    const normal = asNormal(row.normal_balance);
    const debit = Number(row.debit);
    const credit = Number(row.credit);
    return {
      id: row.id,
      code: row.code,
      code_display: formatAccountCodeDisplay(row.code),
      name: row.name,
      account_type_code: row.account_type_code as AccountTypeCode,
      normal_balance: normal,
      is_contra: row.is_contra,
      is_cash_bank: row.is_cash_bank,
      cash_flow_category: (row.cash_flow_category as CashFlowCategory) || null,
      level: row.level,
      debit: round2(debit),
      credit: round2(credit),
      balance: computeBalance(debit, credit, normal, row.is_contra),
    };
  });
}

function tbColumns(row: ReportAccountBalance): {
  debit: number;
  credit: number;
} {
  // Classic TB: net debit OR net credit column (not both)
  const net = round2(row.debit - row.credit);
  if (net > 0) return { debit: net, credit: 0 };
  if (net < 0) return { debit: 0, credit: round2(-net) };
  return { debit: 0, credit: 0 };
}

export async function getTrialBalanceReport(
  companyId: string,
  asOf: string
): Promise<TrialBalanceReport> {
  const balances = await loadPostableBalances(companyId, { asOf });
  const rows = balances.map((b) => {
    const cols = tbColumns(b);
    return { ...b, debit: cols.debit, credit: cols.credit };
  });
  const total_debit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const total_credit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { as_of: asOf, rows, total_debit, total_credit };
}

async function fiscalYearStartForDate(
  companyId: string,
  asOf: string
): Promise<string> {
  const fy = await queryOne<{ start_date: string }>(
    `SELECT start_date::text AS start_date
     FROM accounting.fiscal_years
     WHERE deleted_at IS NULL
       AND company_id = $1::uuid
       AND start_date <= $2::date
       AND end_date >= $2::date
     ORDER BY start_date DESC
     LIMIT 1`,
    [companyId, asOf]
  );
  if (fy?.start_date) return fy.start_date;
  return `${asOf.slice(0, 4)}-01-01`;
}

export async function getBalanceSheetReport(
  companyId: string,
  asOf: string
): Promise<BalanceSheetReport> {
  const balances = await loadPostableBalances(companyId, { asOf });
  const assets = balances.filter((b) => b.account_type_code === "ASSET");
  const liabilities = balances.filter(
    (b) => b.account_type_code === "LIABILITY"
  );
  const equity = balances.filter((b) => b.account_type_code === "EQUITY");

  const fyStart = await fiscalYearStartForDate(companyId, asOf);
  const pl = await loadPostableBalances(companyId, {
    dateFrom: fyStart,
    dateTo: asOf,
  });
  const current_year_earnings = round2(
    pl
      .filter((b) => PL_TYPES.has(b.account_type_code))
      .reduce((s, b) => {
        // P&L contribution to equity (credit nature of earnings)
        if (
          b.account_type_code === "REVENUE" ||
          b.account_type_code === "OTHER_INCOME"
        ) {
          return s + b.balance;
        }
        return s - b.balance;
      }, 0)
  );

  const total_assets = round2(assets.reduce((s, r) => s + r.balance, 0));
  const total_liabilities = round2(
    liabilities.reduce((s, r) => s + r.balance, 0)
  );
  const total_equity = round2(
    equity.reduce((s, r) => s + r.balance, 0) + current_year_earnings
  );

  return {
    as_of: asOf,
    assets,
    liabilities,
    equity,
    current_year_earnings,
    total_assets,
    total_liabilities,
    total_equity,
    total_liabilities_and_equity: round2(total_liabilities + total_equity),
  };
}

export async function getIncomeStatementReport(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<IncomeStatementReport> {
  const balances = await loadPostableBalances(companyId, {
    dateFrom,
    dateTo,
  });

  const revenue = balances.filter((b) => b.account_type_code === "REVENUE");
  const cogs = balances.filter((b) => b.account_type_code === "COGS");
  const expenses = balances.filter((b) => b.account_type_code === "EXPENSE");
  const other_income = balances.filter(
    (b) => b.account_type_code === "OTHER_INCOME"
  );
  const other_expenses = balances.filter(
    (b) => b.account_type_code === "OTHER_EXPENSE"
  );

  const total_revenue = round2(revenue.reduce((s, r) => s + r.balance, 0));
  const total_cogs = round2(cogs.reduce((s, r) => s + r.balance, 0));
  const gross_profit = round2(total_revenue - total_cogs);
  const total_expenses = round2(expenses.reduce((s, r) => s + r.balance, 0));
  const operating_income = round2(gross_profit - total_expenses);
  const total_other_income = round2(
    other_income.reduce((s, r) => s + r.balance, 0)
  );
  const total_other_expenses = round2(
    other_expenses.reduce((s, r) => s + r.balance, 0)
  );
  const net_income = round2(
    operating_income + total_other_income - total_other_expenses
  );

  return {
    date_from: dateFrom,
    date_to: dateTo,
    revenue,
    cogs,
    expenses,
    other_income,
    other_expenses,
    total_revenue,
    total_cogs,
    gross_profit,
    total_expenses,
    operating_income,
    total_other_income,
    total_other_expenses,
    net_income,
  };
}

function section(
  category: CashFlowCategory,
  rows: ReportAccountBalance[]
): CashFlowSection {
  // Cash flow activity: use period nets; for CF sign, increase in cash-related
  // Non-cash accounts: balance change contributes opposite to cash approx (indirect-lite)
  const filtered = rows.filter((r) => r.cash_flow_category === category);
  // For cash flow statement by category on non-cash accounts: outflow when asset/expense up
  const total = round2(
    filtered.reduce((s, r) => {
      if (r.is_cash_bank) return s;
      // Approximate: credit-nature increases and expense decreases improve cash
      if (
        r.account_type_code === "REVENUE" ||
        r.account_type_code === "OTHER_INCOME" ||
        r.account_type_code === "LIABILITY" ||
        r.account_type_code === "EQUITY"
      ) {
        return s + r.balance;
      }
      return s - r.balance;
    }, 0)
  );
  return { category, rows: filtered, total };
}

export async function getCashFlowReport(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<CashFlowReport> {
  const period = await loadPostableBalances(companyId, { dateFrom, dateTo });
  const before = await loadPostableBalances(companyId, {
    asOf: (() => {
      const d = new Date(dateFrom + "T00:00:00");
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })(),
  });
  const through = await loadPostableBalances(companyId, { asOf: dateTo });

  const cashOpening = round2(
    before.filter((b) => b.is_cash_bank).reduce((s, r) => s + r.balance, 0)
  );
  const cashClosing = round2(
    through.filter((b) => b.is_cash_bank).reduce((s, r) => s + r.balance, 0)
  );
  const net_cash_change = round2(cashClosing - cashOpening);

  const operating = section("OPERATING", period);
  const investing = section("INVESTING", period);
  const financing = section("FINANCING", period);
  const non_cash = section("NON_CASH", period);

  return {
    date_from: dateFrom,
    date_to: dateTo,
    operating,
    investing,
    financing,
    non_cash,
    net_cash_change,
    cash_opening: cashOpening,
    cash_closing: cashClosing,
  };
}

export async function listGeneralLedgerAccounts(
  companyId: string,
  asOf?: string
): Promise<GeneralLedgerAccountOption[]> {
  const balances = await loadPostableBalances(companyId, {
    asOf: asOf || new Date().toISOString().slice(0, 10),
  });
  return balances.map((b) => ({
    id: b.id,
    code: b.code,
    code_display: b.code_display,
    name: b.name,
    account_type_code: b.account_type_code,
    balance: b.balance,
  }));
}

export async function getGeneralLedgerReport(opts: {
  companyId: string;
  accountId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<GeneralLedgerReport | null> {
  const account = await queryOne<{
    id: string;
    code: string;
    name: string;
    account_type_code: string;
    normal_balance: string;
    is_contra: boolean;
    company_id: string | null;
    deleted_at: string | null;
    is_postable: boolean;
  }>(
    `SELECT coa.id, coa.code, coa.name, t.code AS account_type_code,
            t.normal_balance, coa.is_contra, coa.company_id,
            coa.deleted_at, coa.is_postable
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     WHERE coa.id = $1::uuid`,
    [opts.accountId]
  );

  if (
    !account ||
    account.deleted_at ||
    !account.is_postable ||
    account.company_id !== opts.companyId
  ) {
    return null;
  }

  const normal = asNormal(account.normal_balance);

  let openingBalance = 0;
  if (opts.dateFrom) {
    const opening = await queryOne<{ debit: string; credit: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
         COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e
         ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED'
       WHERE l.account_id = $1::uuid
         AND e.company_id = $2::uuid
         AND e.entry_date < $3::date`,
      [opts.accountId, opts.companyId, opts.dateFrom]
    );
    openingBalance = computeBalance(
      Number(opening?.debit ?? 0),
      Number(opening?.credit ?? 0),
      normal,
      account.is_contra
    );
  }

  const params: unknown[] = [opts.accountId, opts.companyId];
  const clauses = [
    "l.account_id = $1::uuid",
    "e.company_id = $2::uuid",
    "e.deleted_at IS NULL",
    "e.status = 'POSTED'",
  ];
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    clauses.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    clauses.push(`e.entry_date <= $${params.length}::date`);
  }

  const movementRows = await query<{
    line_id: string;
    entry_id: string;
    entry_no: string;
    entry_date: string;
    entry_type: string;
    description: string | null;
    memo: string | null;
    entry_side: string;
    amount: string;
  }>(
    `SELECT
       l.id AS line_id,
       e.id AS entry_id,
       e.entry_no,
       e.entry_date::text AS entry_date,
       COALESCE(e.entry_type, 'MANUAL') AS entry_type,
       e.description,
       l.memo,
       l.entry_side,
       l.amount::text AS amount
     FROM accounting.journal_entry_lines l
     JOIN accounting.journal_entries e ON e.id = l.entry_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.entry_date ASC, e.entry_no ASC, l.sort_order ASC, l.entry_side ASC`,
    params
  );

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines: GeneralLedgerLine[] = movementRows.map((row) => {
    const amount = Number(row.amount);
    const debit = row.entry_side === "DEBIT" ? amount : 0;
    const credit = row.entry_side === "CREDIT" ? amount : 0;
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    running = round2(
      running +
        signedDelta(row.entry_side, amount, normal, account.is_contra)
    );
    return {
      line_id: row.line_id,
      entry_id: row.entry_id,
      entry_no: row.entry_no,
      entry_date: row.entry_date,
      entry_type: row.entry_type,
      description: row.description,
      memo: row.memo,
      entry_side: row.entry_side === "CREDIT" ? "CREDIT" : "DEBIT",
      debit,
      credit,
      running_balance: running,
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      code_display: formatAccountCodeDisplay(account.code),
      name: account.name,
      account_type_code: account.account_type_code,
      normal_balance: normal,
    },
    date_from: opts.dateFrom ?? null,
    date_to: opts.dateTo ?? null,
    opening_balance: openingBalance,
    closing_balance: running,
    total_debit: totalDebit,
    total_credit: totalCredit,
    lines,
  };
}

export { BS_TYPES, PL_TYPES };
