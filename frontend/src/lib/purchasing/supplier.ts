// ============================================================
// API Service — Purchasing Supplier
// ============================================================

import {
  Supplier,
  SupplierDetail,
  SupplierFormData,
  SupplierListParams,
  SupplierPOSummary,
  PaginatedResponse,
} from "@/types/supplier";

const BASE = "/api/purchasing";

async function fetchApi<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return json as T;
}

// ─── List Suppliers ─────────────────────────────────────────────

export async function listSuppliers(
  params: SupplierListParams = {}
): Promise<PaginatedResponse<Supplier>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.status) sp.set("status", params.status);
  if (params.is_active !== undefined && !params.status) sp.set("is_active", String(params.is_active));
  if (params.payment_terms) sp.set("payment_terms", params.payment_terms);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sort_by) sp.set("sort_by", params.sort_by);
  if (params.sort_dir) sp.set("sort_dir", params.sort_dir);

  return fetchApi<PaginatedResponse<Supplier>>(
    `${BASE}/suppliers?${sp.toString()}`
  );
}

// ─── Get Supplier by ID ─────────────────────────────────────────

export async function getSupplier(id: string): Promise<SupplierDetail> {
  const data = await fetchApi<{ data: SupplierDetail }>(
    `${BASE}/suppliers/${id}`
  );
  return data.data;
}

// ─── Create Supplier ────────────────────────────────────────────

export async function createSupplier(
  payload: SupplierFormData
): Promise<Supplier> {
  const data = await fetchApi<{ data: Supplier }>(`${BASE}/suppliers`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.data;
}

// ─── Update Supplier ────────────────────────────────────────────

export async function updateSupplier(
  id: string,
  payload: Partial<SupplierFormData>
): Promise<Supplier> {
  const data = await fetchApi<{ data: Supplier }>(
    `${BASE}/suppliers/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return data.data;
}

// ─── Status / Delete Supplier ──────────────────────────────────

export async function updateSupplierStatus(
  id: string,
  isActive: boolean
): Promise<Supplier> {
  const data = await fetchApi<{ data: Supplier }>(
    `${BASE}/suppliers/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        is_active: isActive,
        status: isActive ? "active" : "inactive",
      }),
    }
  );
  return data.data;
}

export async function deactivateSupplier(id: string): Promise<void> {
  await fetchApi(`${BASE}/suppliers/${id}`, { method: "DELETE" });
}

export const deleteSupplier = deactivateSupplier;

// ─── Supplier PO History ───────────────────────────────────────

export async function getSupplierPOHistory(
  supplierId: string,
  params: {
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  } = {}
): Promise<PaginatedResponse<SupplierPOSummary>> {
  const sp = new URLSearchParams();
  sp.set("supplier_id", supplierId);
  if (params.status) sp.set("status", params.status);
  if (params.startDate) sp.set("start_date", params.startDate);
  if (params.endDate) sp.set("end_date", params.endDate);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  return fetchApi<PaginatedResponse<SupplierPOSummary>>(
    `${BASE}/po?${sp.toString()}`
  );
}

// ─── Supplier Performance Metrics ─────────────────────────────

export interface SupplierPerformance {
  total_po: number;
  total_spent: number;
  on_time_rate: number;
  qc_pass_rate: number;
  avg_lead_time_days: number;
  po_trend: { month: string; total: number }[];
}

// ─── Export CSV ─────────────────────────────────────────────────

export function exportSuppliersCSV(suppliers: Supplier[]): void {
  const headers = [
    "Kode",
    "Nama Supplier",
    "Kota",
    "Nama PIC",
    "Telepon PIC",
    "Email",
    "Payment Terms",
    "Mata Uang",
    "NPWP",
    "Bank",
    "No Rekening",
    "Atas Nama",
    "Status",
  ];

  const rows = suppliers.map((s) => [
    s.kode,
    s.nama_supplier,
    s.kota ?? "",
    s.pic_name ?? "",
    s.pic_phone ?? "",
    s.email ?? "",
    s.payment_terms,
    s.currency,
    s.npwp ?? "",
    s.bank_nama ?? "",
    s.bank_rekening ?? "",
    s.bank_atas_nama ?? "",
    s.is_active ? "Aktif" : "Nonaktif",
  ]);

  const csvContent =
    "data:text/csv;charset=utf-8," +
    [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

  const link = document.createElement("a");
  link.href = encodeURI(csvContent);
  link.download = `suppliers_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
