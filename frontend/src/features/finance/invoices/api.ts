import type {
  InvoicePaymentStatus,
  InvoiceStatus,
} from "@/features/sales-funnel/pipeline/api";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

export interface FinanceInvoice {
  id: string;
  invoice_number: string;
  label: string;
  amount: number;
  due_date: string | null;
  status: InvoiceStatus;
  sent_at: string | null;
  note: string | null;
  created_at: string;
  deal_id: string;
  deal_title: string;
  org_name: string;
  pic_name: string;
  quote_number: string | null;
  created_by_name: string | null;
  paid: number;
  payment_status: InvoicePaymentStatus;
  outstanding: number;
}

export interface FinanceInvoiceFilters {
  status?: string;
  q?: string;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  method: string;
  paid_on: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CreateInvoicePaymentValues {
  amount: number;
  method: string;
  paid_on: string;
  note?: string | null;
}

export interface InvoiceQuotationRef {
  id: string;
  quote_number: string | null;
  status: string | null;
  total: number;
  use_ppn: boolean | null;
  ppn_persen: number;
}

export interface InvoiceTermRef {
  id: string;
  label: string | null;
  percent: number;
  due_date: string | null;
}

export interface InvoiceDetail {
  id: string;
  invoice_number: string;
  label: string;
  amount: number;
  due_date: string | null;
  status: InvoiceStatus;
  sent_at: string | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  deal_id: string;
  deal_title: string;
  event_type: string;
  event_date: string | null;
  org_name: string;
  pic_name: string;
  pic_phone: string;
  pic_title: string | null;
  has_faktur_pajak: boolean;
  quotation: InvoiceQuotationRef | null;
  term: InvoiceTermRef | null;
  paid: number;
  payment_status: InvoicePaymentStatus;
  outstanding: number;
}

export interface ReviseInvoiceValues {
  label: string;
  amount: number;
  due_date?: string | null;
  note?: string | null;
}

export async function fetchFinanceInvoices(
  filters: FinanceInvoiceFilters
): Promise<FinanceInvoice[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  const res = await fetch(`/api/finance/invoices${qs ? `?${qs}` : ""}`);
  if (!res.ok) await parseError(res, "Gagal memuat invoice");
  const body = (await res.json()) as { data: FinanceInvoice[] };
  return body.data;
}

/** Transisi status (terkirim/batal) — route sales-funnel, guard finance. */
export async function updateInvoiceStatus(
  invoiceId: string,
  status: "terkirim" | "batal"
) {
  const res = await fetch(`/api/sales-funnel/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui invoice");
  return res.json();
}

export async function deleteInvoice(invoiceId: string) {
  const res = await fetch(`/api/sales-funnel/invoices/${invoiceId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus invoice");
  }
}

export async function fetchInvoiceDetail(invoiceId: string): Promise<InvoiceDetail> {
  const res = await fetch(`/api/finance/invoices/${invoiceId}`);
  if (!res.ok) await parseError(res, "Gagal memuat detail invoice");
  const body = (await res.json()) as { data: InvoiceDetail };
  return body.data;
}

export async function reviseInvoice(invoiceId: string, values: ReviseInvoiceValues) {
  const res = await fetch(`/api/finance/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal merevisi invoice");
  return res.json();
}

// ── Lampiran Faktur Pajak ────────────────────────────────────────────

export async function uploadFakturPajak(invoiceId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/finance/invoices/${invoiceId}/faktur-pajak`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) await parseError(res, "Gagal mengunggah faktur pajak");
  return res.json();
}

export async function deleteFakturPajak(invoiceId: string) {
  const res = await fetch(`/api/finance/invoices/${invoiceId}/faktur-pajak`, {
    method: "DELETE",
  });
  if (!res.ok) await parseError(res, "Gagal menghapus faktur pajak");
  return res.json();
}

export async function fetchInvoicePayments(
  invoiceId: string
): Promise<InvoicePayment[]> {
  const res = await fetch(`/api/finance/invoices/${invoiceId}/payments`);
  if (!res.ok) await parseError(res, "Gagal memuat pembayaran invoice");
  const body = (await res.json()) as { data: InvoicePayment[] };
  return body.data;
}

export async function createInvoicePayment(
  invoiceId: string,
  values: CreateInvoicePaymentValues
) {
  const res = await fetch(`/api/finance/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal mencatat pembayaran");
  return res.json();
}

export async function deleteInvoicePayment(paymentId: string) {
  const res = await fetch(`/api/finance/payments/${paymentId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus catatan pembayaran");
  }
}
