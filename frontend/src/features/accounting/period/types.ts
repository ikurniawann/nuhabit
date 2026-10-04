import type {
  AccountingPeriodListItem,
  PeriodClosePreview,
  ResolvedFiscalPeriod,
} from "@/lib/accounting/fiscal-types";

export type {
  AccountingPeriodListItem,
  PeriodClosePreview,
  ResolvedFiscalPeriod,
};

export type AccountingPeriodFilters = {
  fiscal_year_id?: string;
  status?: "OPEN" | "CLOSED" | "";
  search?: string;
};
