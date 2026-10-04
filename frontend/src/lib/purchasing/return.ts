import {
  PurchaseReturn,
  PurchaseReturnFormData,
  ReturnListParams,
  ReturnableItem,
} from "@/types/purchasing";

const API_BASE = "/api/purchasing/returns";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? "Invalid response from server"
        : `Request failed (${response.status})`
    );
  }
}

/**
 * List purchase returns with pagination and filters
 */
export async function listReturns(params: ReturnListParams) {
  const searchParams = new URLSearchParams();

  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.status) searchParams.set("status", params.status);
  if (params.supplier_id) searchParams.set("supplier_id", params.supplier_id);
  if (params.reason_type) searchParams.set("reason_type", params.reason_type);
  if (params.date_from) searchParams.set("date_from", params.date_from);
  if (params.date_to) searchParams.set("date_to", params.date_to);
  if (params.search) searchParams.set("search", params.search);
  if (params.sort_by) searchParams.set("sort_by", params.sort_by);
  if (params.sort_order) searchParams.set("sort_order", params.sort_order);
  if (params.module_type) searchParams.set("module_type", params.module_type);
  if (params.vendor_id) searchParams.set("vendor_id", params.vendor_id);

  const response = await fetch(`${API_BASE}?${searchParams}`);
  const result = await parseJsonResponse<{
    error?: string;
    message?: string;
    data?: unknown;
    pagination?: unknown;
  }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to load purchase returns");
  }

  return result;
}

/**
 * Get single purchase return by ID
 */
export async function getReturn(id: string): Promise<PurchaseReturn> {
  const response = await fetch(`${API_BASE}/${id}`);
  const result = await parseJsonResponse<{ error?: string; message?: string; data: PurchaseReturn }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to load purchase return");
  }

  return result.data;
}

/**
 * Create new purchase return
 */
export async function createReturn(data: PurchaseReturnFormData) {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const result = await parseJsonResponse<{ error?: string; message?: string; data?: unknown }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to create purchase return");
  }

  return result;
}

/**
 * Approve purchase return
 */
export async function approveReturn(id: string) {
  const response = await fetch(`${API_BASE}/${id}/approve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  });

  const result = await parseJsonResponse<{ error?: string; message?: string }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to approve purchase return");
  }

  return result;
}

/**
 * Reject purchase return
 */
export async function rejectReturn(id: string, reason: string) {
  const response = await fetch(`${API_BASE}/${id}/reject`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rejection_reason: reason }),
  });

  const result = await parseJsonResponse<{ error?: string; message?: string }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to reject purchase return");
  }

  return result;
}

/**
 * Get returnable items from GRN
 */
export async function getReturnableItems(
  grnId: string,
  excludeReturnId?: string
): Promise<ReturnableItem[]> {
  const params = excludeReturnId
    ? `?exclude_return_id=${encodeURIComponent(excludeReturnId)}`
    : "";
  const response = await fetch(`/api/purchasing/grn/${grnId}/returnable-items${params}`);
  const result = await parseJsonResponse<{ error?: string; message?: string; data?: ReturnableItem[] }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to load returnable items");
  }

  return result.data || [];
}

/**
 * Update return (for draft status only)
 */
export async function updateReturn(id: string, data: Partial<PurchaseReturnFormData>) {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const result = await parseJsonResponse<{ error?: string; message?: string }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to update purchase return");
  }

  return result;
}

/**
 * Cancel return (draft or pending only)
 */
export async function cancelReturn(id: string) {
  const response = await fetch(`${API_BASE}/${id}/cancel`, {
    method: "PATCH",
  });

  const result = await parseJsonResponse<{ error?: string; message?: string }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to cancel purchase return");
  }

  return result;
}

/**
 * Mark return as shipped
 */
export async function shipReturn(id: string, shippingDate: string, trackingNumber?: string) {
  const response = await fetch(`${API_BASE}/${id}/ship`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipping_date: shippingDate, tracking_number: trackingNumber }),
  });

  const result = await parseJsonResponse<{ error?: string; message?: string }>(response);

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to update shipping status");
  }

  return result;
}

/**
 * Revisi retur yang ditolak: membuat dokumen draft baru, dokumen lama tetap
 * tersimpan sebagai riwayat.
 */
export async function reviseReturn(id: string) {
  const response = await fetch(`${API_BASE}/${id}/revise`, { method: "POST" });
  const result = await parseJsonResponse<{
    error?: string;
    message?: string;
    data?: { id: string; return_number: string; revision_no: number };
  }>(response);

  if (!response.ok || !result.data) {
    throw new Error(result.error || result.message || "Gagal membuat revisi retur");
  }

  return result.data;
}
