import { parseError } from "../api-error";
import type {
  CatalogProduct,
  Quotation,
  QuotationFormValues,
  QuotationStatus,
  StockShortage,
} from "./types";
import { RealizeConflictError, formToPayload } from "./types";

export async function fetchQuotations(dealId: string): Promise<Quotation[]> {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/quotations`);
  if (!res.ok) await parseError(res, "Gagal memuat quotation");
  const body = (await res.json()) as { data: Quotation[] };
  return body.data;
}

export async function fetchCatalogProducts(): Promise<CatalogProduct[]> {
  const res = await fetch("/api/sales-funnel/products");
  if (!res.ok) await parseError(res, "Gagal memuat katalog produk");
  const body = (await res.json()) as { data: CatalogProduct[] };
  return body.data;
}

export async function createQuotation(dealId: string, form: QuotationFormValues) {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/quotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formToPayload(form)),
  });
  if (!res.ok) await parseError(res, "Gagal membuat quotation");
  return res.json();
}

export async function updateQuotation(
  id: string,
  values: { form?: QuotationFormValues; status?: QuotationStatus }
) {
  const res = await fetch(`/api/sales-funnel/quotations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(values.status ? { status: values.status } : {}),
      ...(values.form ? { payload: formToPayload(values.form) } : {}),
    }),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui quotation");
  return res.json();
}

export async function deleteQuotation(id: string) {
  const res = await fetch(`/api/sales-funnel/quotations/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus quotation");
  }
}

export async function realizeQuotation(
  id: string,
  forceSkipBom: boolean
): Promise<{ message?: string; data?: { bomStatus: string; warnings: string[] } }> {
  const res = await fetch(`/api/sales-funnel/quotations/${id}/realize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_skip_bom: forceSkipBom }),
  });
  if (res.status === 409) {
    const body = (await res.json()) as {
      error?: string;
      shortages?: StockShortage[];
      warnings?: string[];
    };
    throw new RealizeConflictError(
      body.error ?? "Stok tidak mencukupi",
      body.shortages ?? [],
      body.warnings ?? []
    );
  }
  if (!res.ok) await parseError(res, "Gagal merealisasi quotation");
  return res.json();
}

export async function sendQuotationWa(id: string): Promise<{ message?: string }> {
  const res = await fetch(`/api/sales-funnel/quotations/${id}/send-wa`, {
    method: "POST",
  });
  if (!res.ok) await parseError(res, "Gagal mengirim quotation");
  return res.json();
}

/** EPIC-050 T-3.4 — buat versi baru (revisi) dari quotation. */
export async function reviseQuotation(id: string): Promise<{ data: { id: string; version: number }; message?: string }> {
  const res = await fetch(`/api/sales-funnel/quotations/${id}/revise`, { method: "POST" });
  if (!res.ok) await parseError(res, "Gagal membuat revisi");
  return res.json();
}
