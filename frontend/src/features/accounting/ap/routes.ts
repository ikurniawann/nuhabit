export type {
  ApAgingBucket,
  ApInvoiceRow,
  ApPaymentMethod,
  ApPaymentRow,
  ApPaymentStatus,
} from "@/lib/accounting/ap-types";

export const AP_ROUTES = {
  payable: "/dashboard/accounting/accounts-payable",
  invoices: "/dashboard/accounting/accounts-payable/invoices",
  payments: "/dashboard/accounting/accounts-payable/payments",
  aging: "/dashboard/accounting/accounts-payable/aging",
} as const;
