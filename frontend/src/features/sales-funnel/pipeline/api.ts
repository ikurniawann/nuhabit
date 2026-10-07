import { parseError } from "../api-error";
import type {
  DealFilters,
  DealFormValues,
  DealUpdatePayload,
  SalesDeal,
  SalesLostReason,
  SalesStage,
  StageUpdatePayload,
} from "./types";

export async function fetchStages(all = false, pipelineId?: string): Promise<SalesStage[]> {
  const params = new URLSearchParams();
  if (all) params.set("all", "1");
  if (pipelineId) params.set("pipeline_id", pipelineId);
  const qs = params.toString();
  const res = await fetch(`/api/sales-funnel/stages${qs ? `?${qs}` : ""}`);
  if (!res.ok) await parseError(res, "Gagal memuat tahap pipeline");
  const body = (await res.json()) as { data: SalesStage[] };
  return body.data;
}

export async function updateStage(id: string, values: StageUpdatePayload) {
  const res = await fetch(`/api/sales-funnel/stages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui tahap");
  return res.json();
}

export async function fetchLostReasons(): Promise<SalesLostReason[]> {
  const res = await fetch("/api/sales-funnel/lost-reasons");
  if (!res.ok) await parseError(res, "Gagal memuat alasan kalah");
  const body = (await res.json()) as { data: SalesLostReason[] };
  return body.data;
}

export async function fetchDeals(filters: DealFilters): Promise<SalesDeal[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.event_type) params.set("event_type", filters.event_type);
  if (filters.pipeline_id) params.set("pipeline_id", filters.pipeline_id);
  const qs = params.toString();
  const res = await fetch(`/api/sales-funnel/deals${qs ? `?${qs}` : ""}`);
  if (!res.ok) await parseError(res, "Gagal memuat deals");
  const body = (await res.json()) as { data: SalesDeal[] };
  return body.data;
}

export async function createDeal(values: DealFormValues) {
  const res = await fetch("/api/sales-funnel/deals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead_id: values.lead_id,
      title: values.title,
      event_type: values.event_type,
      event_date: values.event_date || null,
      is_event_date_fixed: values.is_event_date_fixed,
      pax_estimate: values.pax_estimate ? Number(values.pax_estimate) : null,
      value_estimate: values.value_estimate ? Number(values.value_estimate) : null,
      pipeline_id: values.pipeline_id || null,
      custom: values.custom ?? {},
    }),
  });
  if (!res.ok) await parseError(res, "Gagal membuat deal");
  return res.json();
}

export async function updateDeal(id: string, values: DealUpdatePayload) {
  const res = await fetch(`/api/sales-funnel/deals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui deal");
  return res.json();
}

export async function deleteDeal(id: string) {
  const res = await fetch(`/api/sales-funnel/deals/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus deal");
}

// ── Invoice deal ─────────────────────────────────────────────────────

export type InvoiceStatus = "diajukan" | "draft" | "terkirim" | "batal";
export type InvoicePaymentStatus = "belum" | "sebagian" | "lunas";

export interface DealInvoice {
  id: string;
  invoice_number: string;
  label: string;
  amount: number;
  due_date: string | null;
  status: InvoiceStatus;
  sent_at: string | null;
  note: string | null;
  quotation_id: string | null;
  term_id: string | null;
  quote_number: string | null;
  paid: number;
  payment_status: InvoicePaymentStatus;
  created_at: string;
}

export interface InvoiceTermOption {
  term_id: string;
  label: string;
  percent: number;
  amount: number;
  due_date: string | null;
  invoiced: boolean;
}

export interface DealInvoiceData {
  invoices: DealInvoice[];
  reference: {
    quotation_id: string;
    quote_number: string;
    is_accepted: boolean;
    total: number;
    use_ppn: boolean;
    ppn_persen: number;
  } | null;
  available_terms: InvoiceTermOption[];
}

export interface CreateInvoiceValues {
  term_id?: string | null;
  label: string;
  amount: number;
  due_date?: string | null;
  note?: string | null;
}

export async function fetchDealInvoices(dealId: string): Promise<DealInvoiceData> {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/invoices`);
  if (!res.ok) await parseError(res, "Gagal memuat invoice");
  const body = (await res.json()) as { data: DealInvoiceData };
  return body.data;
}

export async function createDealInvoice(dealId: string, values: CreateInvoiceValues) {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal membuat invoice");
  return res.json();
}

export async function deleteDealInvoice(invoiceId: string) {
  const res = await fetch(`/api/sales-funnel/invoices/${invoiceId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus invoice");
  }
}

// ── Pembayaran deal (Fase G) ─────────────────────────────────────────

export interface DealPayment {
  id: string;
  amount: number;
  method: string;
  paid_on: string;
  note: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface DealPaymentTermProgress {
  label: string;
  due_date: string | null;
  percent: number;
  amount: number;
  paid: number;
  status: "lunas" | "sebagian" | "belum";
}

export interface DealPaymentData {
  payments: DealPayment[];
  summary: {
    reference_total: number;
    reference_quote_number: string | null;
    reference_is_accepted: boolean;
    total_paid: number;
    outstanding: number;
  };
  terms: DealPaymentTermProgress[];
}

// Pencatatan/koreksi pembayaran pindah ke modul Finance (EPIC-025 Opsi B) —
// pipeline hanya MEMBACA progress pelunasan.
export async function fetchDealPayments(dealId: string): Promise<DealPaymentData> {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/payments`);
  if (!res.ok) await parseError(res, "Gagal memuat pembayaran");
  const body = (await res.json()) as { data: DealPaymentData };
  return body.data;
}

// ── EPIC-050 Fase 3: pipelines, tahap baru, deal team ──
import type { DealMember, SalesPipeline } from "./types";

export async function fetchPipelines(all = false): Promise<SalesPipeline[]> {
  const res = await fetch(`/api/sales-funnel/pipelines${all ? "?all=1" : ""}`);
  if (!res.ok) await parseError(res, "Gagal memuat pipeline");
  const body = (await res.json()) as { data: SalesPipeline[] };
  return body.data;
}

export async function createPipeline(values: { name: string; description?: string | null; stages: Array<{ name: string; probability: number }> }) {
  const res = await fetch("/api/sales-funnel/pipelines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
  if (!res.ok) await parseError(res, "Gagal membuat pipeline");
  return res.json();
}

export async function updatePipeline(id: string, values: Partial<{ name: string; description: string | null; is_default: boolean; is_active: boolean; sort_order: number }>) {
  const res = await fetch(`/api/sales-funnel/pipelines/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
  if (!res.ok) await parseError(res, "Gagal memperbarui pipeline");
  return res.json();
}

export async function createStage(values: { pipeline_id: string; name: string; probability: number; stuck_threshold_days?: number }) {
  const res = await fetch("/api/sales-funnel/stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
  if (!res.ok) await parseError(res, "Gagal menambah tahap");
  return res.json();
}

export async function fetchDealMembers(dealId: string): Promise<DealMember[]> {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/members`);
  if (!res.ok) await parseError(res, "Gagal memuat tim deal");
  const body = (await res.json()) as { data: DealMember[] };
  return body.data;
}

export async function addDealMember(dealId: string, values: { user_id: string; role: DealMember["role"]; split_percent?: number }) {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
  if (!res.ok) await parseError(res, "Gagal menambah anggota tim");
  return res.json();
}

export async function removeDealMember(dealId: string, memberId: string) {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/members?member_id=${memberId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus anggota tim");
}
