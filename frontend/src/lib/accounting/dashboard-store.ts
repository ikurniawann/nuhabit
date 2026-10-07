import {
  getBalanceSheetReport,
  getCashFlowReport,
  getIncomeStatementReport,
  getTrialBalanceReport,
} from "@/lib/accounting/reports-store";
import { query } from "@/lib/db";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${today().slice(0, 4)}-01-01`;
}

export type AccountingDashboard = {
  as_of: string;
  date_from: string;
  date_to: string;
  kpis: {
    total_assets: number;
    total_liabilities: number;
    total_equity: number;
    net_income: number;
    cash_balance: number;
    cash_opening: number;
    cash_change: number;
    trial_balance_diff: number;
    posted_entries_ytd: number;
    draft_entries: number;
  };
  balance_composition: {
    name: string;
    value: number;
  }[];
  pnl_breakdown: {
    name: string;
    value: number;
  }[];
  cash_flow_breakdown: {
    name: string;
    value: number;
  }[];
  monthly_trend: {
    month: string;
    revenue: number;
    expense: number;
    net: number;
  }[];
  top_expense_accounts: {
    code: string;
    name: string;
    balance: number;
  }[];
};

export async function getAccountingDashboard(
  companyId: string,
  opts?: { asOf?: string; dateFrom?: string; dateTo?: string }
): Promise<AccountingDashboard> {
  const asOf = opts?.asOf || today();
  const dateFrom = opts?.dateFrom || yearStart();
  const dateTo = opts?.dateTo || asOf;

  const [bs, is, cf, tb, counts, monthly, topExpenses] = await Promise.all([
    getBalanceSheetReport(companyId, asOf),
    getIncomeStatementReport(companyId, dateFrom, dateTo),
    getCashFlowReport(companyId, dateFrom, dateTo),
    getTrialBalanceReport(companyId, asOf),
    query<{ posted: string; draft: string }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'POSTED'
             AND entry_date >= $2::date
             AND entry_date <= $3::date
         )::text AS posted,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::text AS draft
       FROM accounting.journal_entries
       WHERE deleted_at IS NULL
         AND company_id = $1::uuid`,
      [companyId, dateFrom, dateTo]
    ),
    query<{
      month: string;
      revenue: string;
      expense: string;
    }>(
      `WITH months AS (
         SELECT to_char(d, 'YYYY-MM') AS month,
                date_trunc('month', d)::date AS start_date,
                (date_trunc('month', d) + interval '1 month' - interval '1 day')::date AS end_date
         FROM generate_series(
           date_trunc('month', $2::date),
           date_trunc('month', $3::date),
           interval '1 month'
         ) AS d
       )
       SELECT
         m.month,
         COALESCE(SUM(
           CASE
             WHEN t.code IN ('REVENUE', 'OTHER_INCOME') THEN
               CASE WHEN l.entry_side = 'CREDIT' THEN l.amount
                    WHEN l.entry_side = 'DEBIT' THEN -l.amount
                    ELSE 0 END
             ELSE 0
           END
         ), 0)::text AS revenue,
         COALESCE(SUM(
           CASE
             WHEN t.code IN ('EXPENSE', 'COGS', 'OTHER_EXPENSE') THEN
               CASE WHEN l.entry_side = 'DEBIT' THEN l.amount
                    WHEN l.entry_side = 'CREDIT' THEN -l.amount
                    ELSE 0 END
             ELSE 0
           END
         ), 0)::text AS expense
       FROM months m
       LEFT JOIN accounting.journal_entries e
         ON e.deleted_at IS NULL
        AND e.status = 'POSTED'
        AND e.company_id = $1::uuid
        AND e.entry_date >= m.start_date
        AND e.entry_date <= LEAST(m.end_date, $3::date)
       LEFT JOIN accounting.journal_entry_lines l ON l.entry_id = e.id
       LEFT JOIN accounting.chart_of_accounts coa ON coa.id = l.account_id
       LEFT JOIN accounting.account_types t ON t.id = coa.account_type_id
       GROUP BY m.month
       ORDER BY m.month ASC`,
      [companyId, dateFrom, asOf]
    ),
    query<{ code: string; name: string; balance: string }>(
      `SELECT
         coa.code,
         coa.name,
         COALESCE(SUM(
           CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE -l.amount END
         ), 0)::text AS balance
       FROM accounting.chart_of_accounts coa
       JOIN accounting.account_types t ON t.id = coa.account_type_id
       LEFT JOIN accounting.journal_entry_lines l ON l.account_id = coa.id
       LEFT JOIN accounting.journal_entries e
         ON e.id = l.entry_id
        AND e.deleted_at IS NULL
        AND e.status = 'POSTED'
        AND e.company_id = $1::uuid
        AND e.entry_date >= $2::date
        AND e.entry_date <= $3::date
       WHERE coa.deleted_at IS NULL
         AND coa.is_active = true
         AND coa.is_postable = true
         AND coa.company_id = $1::uuid
         AND t.code IN ('EXPENSE', 'COGS', 'OTHER_EXPENSE')
       GROUP BY coa.id, coa.code, coa.name
       HAVING COALESCE(SUM(
         CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE -l.amount END
       ), 0) > 0
       ORDER BY 3 DESC
       LIMIT 8`,
      [companyId, dateFrom, dateTo]
    ),
  ]);

  const countRow = counts[0];
  const monthly_trend = monthly.map((row) => {
    const revenue = round2(Number(row.revenue));
    const expense = round2(Number(row.expense));
    return {
      month: row.month,
      revenue,
      expense,
      net: round2(revenue - expense),
    };
  });

  return {
    as_of: asOf,
    date_from: dateFrom,
    date_to: dateTo,
    kpis: {
      total_assets: bs.total_assets,
      total_liabilities: bs.total_liabilities,
      total_equity: bs.total_equity,
      net_income: is.net_income,
      cash_balance: cf.cash_closing,
      cash_opening: cf.cash_opening,
      cash_change: cf.net_cash_change,
      trial_balance_diff: round2(
        Math.abs(tb.total_debit - tb.total_credit)
      ),
      posted_entries_ytd: Number(countRow?.posted ?? 0),
      draft_entries: Number(countRow?.draft ?? 0),
    },
    balance_composition: [
      { name: "Assets", value: Math.max(bs.total_assets, 0) },
      { name: "Liabilities", value: Math.max(bs.total_liabilities, 0) },
      { name: "Equity", value: Math.max(bs.total_equity, 0) },
    ],
    pnl_breakdown: [
      { name: "Revenue", value: is.total_revenue },
      { name: "COGS", value: is.total_cogs },
      { name: "Expenses", value: is.total_expenses },
      { name: "Other Income", value: is.total_other_income },
      { name: "Other Expense", value: is.total_other_expenses },
    ],
    cash_flow_breakdown: [
      { name: "Operating", value: cf.operating.total },
      { name: "Investing", value: cf.investing.total },
      { name: "Financing", value: cf.financing.total },
    ],
    monthly_trend,
    top_expense_accounts: topExpenses.map((r) => ({
      code: r.code,
      name: r.name,
      balance: round2(Number(r.balance)),
    })),
  };
}
