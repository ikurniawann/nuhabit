import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import type { ApInvoiceRow, ApPaymentRow } from "./routes";

const INVOICES = "/api/accounting/ap/invoices";
const PAYMENTS = "/api/accounting/ap/payments";
const PAYABLE = "/api/accounting/ap/payable";
const AGING = "/api/accounting/ap/aging";

export type ApListFilters = {
  search?: string;
  status?: string;
  payment_status?: string;
  limit?: number;
  offset?: number;
};

export const fetchApInvoices = (filters?: ApListFilters) =>
  apiGet<{ data: ApInvoiceRow[]; meta?: { total: number } }>(
    buildListUrl(INVOICES, filters as Record<string, string | number | undefined>)
  );

export const fetchApPayments = (filters?: ApListFilters) =>
  apiGet<{ data: ApPaymentRow[]; meta?: { total: number } }>(
    buildListUrl(PAYMENTS, filters as Record<string, string | number | undefined>)
  );

export const fetchApPayable = () =>
  apiGet<{ data: ApInvoiceRow[] }>(PAYABLE).then((r) => r.data);

export const fetchApAging = (asOf?: string) =>
  apiGet<{
    data: {
      asOf: string;
      buckets: Array<{ bucket: string; invoice_count: number; amount: number }>;
      invoices: ApInvoiceRow[];
    };
  }>(buildListUrl(AGING, { as_of: asOf })).then((r) => r.data);

export const createApPayment = (body: {
  invoice_id: string;
  amount: number;
  payment_date?: string;
  method?: string;
  reference_number?: string | null;
  notes?: string | null;
}) =>
  apiPost<{
    data: ApPaymentRow;
    invoice?: ApInvoiceRow;
    message?: string;
  }>(PAYMENTS, body);
