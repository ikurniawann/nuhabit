export const PERIOD_ROUTES = {
  accountingPeriod: "/dashboard/accounting/period/accounting-period",
  closing: "/dashboard/accounting/period/closing",
  closingWithPeriod: (periodId: string) =>
    `/dashboard/accounting/period/closing?period=${periodId}`,
  fiscalYears: "/dashboard/accounting/fiscal-years",
  journalEntries: "/dashboard/accounting/journal-entries",
} as const;
