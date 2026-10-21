/** Bentuk respons Go /api/accounting/reports/*. */
import type { AccountTypeCode, CashFlowCategory } from "@/lib/accounting/coa-types";

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
