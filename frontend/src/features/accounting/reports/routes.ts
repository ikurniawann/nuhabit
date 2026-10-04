export const REPORT_ROUTES = {
  hub: "/dashboard/accounting/reports",
  trialBalance: "/dashboard/accounting/reports/trial-balance",
  balanceSheet: "/dashboard/accounting/reports/balance-sheet",
  incomeStatement: "/dashboard/accounting/reports/income-statement",
  cashFlow: "/dashboard/accounting/reports/cash-flow",
  generalLedger: "/dashboard/accounting/reports/general-ledger",
} as const;

export type ReportKind =
  | "trial-balance"
  | "balance-sheet"
  | "income-statement"
  | "cash-flow"
  | "general-ledger";
