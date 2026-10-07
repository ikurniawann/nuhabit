import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import type { ArInvoiceRow, ArReceiptRow } from "@/lib/accounting/ar-types";

export type { ArInvoiceRow, ArReceiptRow };

const BASE_INV = "/api/accounting/ar/invoices";
const BASE_RCP = "/api/accounting/ar/receipts";

export type ArListFilters = {
  search?: string;
  payment_status?: string;
  limit?: number;
  offset?: number;
};

export const fetchArInvoices = (filters?: ArListFilters) =>
  apiGet<{ data: ArInvoiceRow[]; meta?: { total: number } }>(
    buildListUrl(
      BASE_INV,
      filters as Record<string, string | number | undefined>,
    ),
  );

export const fetchArReceipts = (filters?: ArListFilters) =>
  apiGet<{ data: ArReceiptRow[]; meta?: { total: number } }>(
    buildListUrl(
      BASE_RCP,
      filters as Record<string, string | number | undefined>,
    ),
  );

export const fetchArReceivable = () =>
  apiGet<{ data: ArInvoiceRow[] }>("/api/accounting/ar/receivable").then(
    (r) => r.data,
  );

export const fetchArAging = (asOf?: string) =>
  apiGet<{
    data: {
      asOf: string;
      buckets: Array<{ bucket: string; invoice_count: number; amount: number }>;
      invoices: ArInvoiceRow[];
    };
  }>(buildListUrl("/api/accounting/ar/aging", { as_of: asOf })).then(
    (r) => r.data,
  );

/** AR invoice untuk sales invoice B2B (dibuat on-demand di server). */
export const fetchArInvoiceBySalesInvoice = (salesInvoiceId: string) =>
  apiGet<{ data: ArInvoiceRow }>(
    `/api/accounting/ar/by-sales-invoice/${encodeURIComponent(salesInvoiceId)}`,
  ).then((r) => r.data);

export const createArReceipt = (body: {
  invoice_id: string;
  amount: number;
  receipt_date?: string;
  method?: string;
  reference_number?: string | null;
  notes?: string | null;
}) => apiPost<{ data: ArReceiptRow; message?: string }>(BASE_RCP, body);

export const AR_ROUTES = {
  receivable: "/dashboard/accounting/receivable",
  invoicesB2b: "/dashboard/accounting/receivable/invoices-b2b",
  invoices: "/dashboard/accounting/receivable/invoices",
  receipts: "/dashboard/accounting/receivable/receipts",
  aging: "/dashboard/accounting/receivable/aging",
} as const;
