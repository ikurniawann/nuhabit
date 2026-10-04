export const CASH_BANK_ROUTES = {
  list: "/dashboard/accounting/cash-bank",
  cashIn: "/dashboard/accounting/cash-bank/cash-in",
  cashOut: "/dashboard/accounting/cash-bank/cash-out",
  transfer: "/dashboard/accounting/cash-bank/transfer",
  reconciliation: "/dashboard/accounting/cash-bank/reconciliation",
  ledger: (accountId: string) =>
    `/dashboard/accounting/cash-bank/${accountId}`,
} as const;
