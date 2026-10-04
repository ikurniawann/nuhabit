import type {
  FiscalPeriodStatus,
  JournalEntryStatus,
  JournalLineSide,
} from "./fiscal-types";
import type {
  JournalAmountSource,
  JournalEntrySide,
  JournalEventCode,
  JournalLineRole,
  JournalModule,
} from "./journal-mapping-types";

// Fiscal years and periods

export interface FiscalPeriodItem {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
}

export interface FiscalYearItem {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  periods: FiscalPeriodItem[];
  open_periods_count: number;
}

export interface FiscalPeriodPayload {
  id?: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
}

export interface FiscalYearPayload {
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  periods: FiscalPeriodPayload[];
}

export interface FiscalYearListFilters {
  search?: string;
  is_active?: string;
}

// Journal entries

export type JournalEntryType = "MANUAL" | "OPENING" | "AUTO";

export interface JournalEntryLineItem {
  id: string;
  entry_id: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  entry_side: JournalLineSide;
  amount: number;
  memo: string | null;
  sort_order: number;
}

export interface JournalEntryItem {
  id: string;
  company_id: string | null;
  entry_no: string;
  entry_date: string;
  description: string | null;
  fiscal_period_id: string;
  fiscal_period_name: string | null;
  fiscal_year_code: string | null;
  entry_type: JournalEntryType;
  status: JournalEntryStatus;
  is_recon: boolean;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  updated_at: string | null;
  source_module?: string | null;
  source_event_code?: string | null;
  source_document_type?: string | null;
  source_document_id?: string | null;
  lines: JournalEntryLineItem[];
  total_debit: number;
  total_credit: number;
  can_edit: boolean;
}

export interface JournalEntryLinePayload {
  id?: string;
  account_id: string;
  entry_side: JournalLineSide;
  amount: number;
  memo?: string | null;
  sort_order?: number;
}

export interface JournalEntryPayload {
  entry_date: string;
  description?: string | null;
  lines: JournalEntryLinePayload[];
  /** If true, save as POSTED in one step */
  post?: boolean;
}

export interface JournalEntryListFilters {
  search?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  entry_type?: string;
  account_id?: string;
}

// Journal mappings

export interface JournalMappingLineItem {
  id: string;
  mapping_id: string;
  entry_side: JournalEntrySide;
  line_role: string;
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
  amount_source: JournalAmountSource;
  sort_order: number;
  is_required: boolean;
}

export interface JournalMappingItem {
  id: string;
  company_id: string | null;
  event_code: string;
  name: string;
  description: string | null;
  module: JournalModule;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  lines: JournalMappingLineItem[];
  lines_count: number;
  mapped_count: number;
}

export interface JournalMappingLinePayload {
  id?: string;
  entry_side: JournalEntrySide;
  line_role: JournalLineRole | string;
  account_id?: string | null;
  amount_source: JournalAmountSource;
  sort_order?: number;
  is_required?: boolean;
}

export interface JournalMappingPayload {
  event_code: JournalEventCode | string;
  name: string;
  description?: string | null;
  module: JournalModule;
  is_active?: boolean;
  lines: JournalMappingLinePayload[];
}

export interface JournalMappingListFilters {
  search?: string;
  module?: string;
  is_active?: string;
}

// Beginning balance

export const PL_ACCOUNT_TYPES = [
  "REVENUE",
  "COGS",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
] as const;

export const BS_ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY"] as const;

export type BeginningBalanceLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type_code: string;
  normal_balance: "DEBIT" | "CREDIT";
  is_contra: boolean;
  /** Suggested signed balance (positive = normal side) */
  suggested_amount: number;
  /** Editable amount (> 0) */
  amount: number;
  entry_side: JournalLineSide;
  source: "PRIOR_BS" | "RETAINED_EARNINGS" | "MANUAL";
};

export type BeginningBalanceSuggestion = {
  fiscal_year_id: string;
  fiscal_year_code: string;
  fiscal_year_name: string;
  start_date: string;
  period_id: string | null;
  period_name: string | null;
  prior_fiscal_year: {
    id: string;
    code: string;
    name: string;
    end_date: string;
    is_fully_closed: boolean;
  } | null;
  retained_earnings_account: {
    id: string;
    code: string;
    name: string;
  } | null;
  lines: BeginningBalanceLine[];
  total_debit: number;
  total_credit: number;
  existing_entry_id: string | null;
  existing_status: "DRAFT" | "POSTED" | null;
  can_edit: boolean;
  is_first_year: boolean;
  message: string | null;
};

export type BeginningBalanceSavePayload = {
  retained_earnings_account_id?: string | null;
  lines: Array<{
    account_id: string;
    entry_side: JournalLineSide;
    amount: number;
    memo?: string | null;
  }>;
  post?: boolean;
};
