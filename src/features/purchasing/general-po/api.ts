import type {
  GeneralPOFormPayload,
  GeneralPOFormData,
  GeneralPODetail,
  GeneralPOListParams,
  GeneralPOListResult,
  ApprovedGeneralPRForPO,
} from "./types";

const MODULE_TYPE = "general";

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || fallback);
  }
  return json;
}

export async function listGeneralPurchaseOrders(
  params: GeneralPOListParams = {}
): Promise<GeneralPOListResult> {
  const sp = new URLSearchParams();
  sp.set("module_type", MODULE_TYPE);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.status) sp.set("status", params.status);
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/purchasing/po?${sp.toString()}`);
  const json = await parseJson<{ data: GeneralPOListResult["data"]; pagination: GeneralPOListResult["pagination"] }>(
    res,
    "Gagal memuat purchase order"
  );
  return { data: json.data || [], pagination: json.pagination };
}

export async function getGeneralPOFormData(): Promise<GeneralPOFormData> {
  const res = await fetch(`/api/purchasing/po/form-data?module_type=${MODULE_TYPE}`);
  const json = await parseJson<{ data: GeneralPOFormData }>(res, "Gagal memuat data form");
  return json.data;
}

export async function listApprovedGeneralPRsForPO(): Promise<ApprovedGeneralPRForPO[]> {
  const res = await fetch(`/api/purchasing/pr/for-po?module_type=${MODULE_TYPE}`);
  const json = await parseJson<{ data: ApprovedGeneralPRForPO[] }>(res, "Gagal memuat permintaan barang");
  return json.data || [];
}

export async function getGeneralPurchaseOrder(id: string): Promise<GeneralPODetail> {
  const res = await fetch(`/api/purchasing/po/${id}`);
  const json = await parseJson<{ data: GeneralPODetail }>(res, "Gagal memuat purchase order");
  return json.data;
}

export async function createGeneralPurchaseOrder(payload: GeneralPOFormPayload) {
  const res = await fetch("/api/purchasing/po", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, module_type: MODULE_TYPE }),
  });
  return parseJson<{ data: { id: string; nomor_po?: string } }>(res, "Gagal membuat purchase order");
}

export async function approveGeneralPurchaseOrder(id: string) {
  const res = await fetch(`/api/purchasing/po/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Gagal menyetujui purchase order");
  }
}

export async function sendGeneralPurchaseOrder(
  id: string,
  sentVia: "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER"
) {
  const res = await fetch(`/api/purchasing/po/${id}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sent_via: sentVia }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Gagal mengirim purchase order");
  }
}

export async function cancelGeneralPurchaseOrder(id: string, reason: string) {
  const res = await fetch(`/api/purchasing/po/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Gagal membatalkan purchase order");
  }
}
