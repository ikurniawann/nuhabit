export const BEGINNING_BALANCE_ROUTES = {
  list: "/dashboard/accounting/beginning-balance",
  forFiscalYear: (fiscalYearId: string) =>
    `/dashboard/accounting/fiscal-years/beginning-balance/${fiscalYearId}`,
} as const;
