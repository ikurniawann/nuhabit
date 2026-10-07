import { BASE, fetchApi } from "@/lib/purchasing/api-client/http";
import type { SendVia } from "@/lib/purchasing/po-ui-status";
import type {
  PurchaseOrder,
  PurchaseOrderWithStats,
  PurchaseOrderItem,
  PurchaseOrderFormData,
  PurchaseOrderPaymentTerm,
  VendorPayment,
  POListParams,
  PaginatedResponse,
} from "@/types/purchasing";

export async function listPurchaseOrders(
  params: POListParams = {}
): Promise<PaginatedResponse<PurchaseOrderWithStats>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.status) sp.set("status", params.status);
  if (params.supplier_id) sp.set("supplier_id", params.supplier_id);
  if (params.tanggal_mulai) sp.set("tanggal_mulai", params.tanggal_mulai);
  if (params.tanggal_sampai) sp.set("tanggal_sampai", params.tanggal_sampai);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  return fetchApi<PaginatedResponse<PurchaseOrderWithStats>>(
    `${BASE}/po?${sp.toString()}`
  );
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderWithStats> {
  const response = await fetchApi<{ data: PurchaseOrderWithStats }>(
    `${BASE}/po/${id}`
  );
  return response.data;
}

export async function createPurchaseOrder(
  payload: PurchaseOrderFormData
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updatePurchaseOrder(
  id: string,
  payload: Partial<PurchaseOrderFormData>
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}/approve`,
    { method: "POST" }
  );
  return response.data;
}

export async function sendPurchaseOrder(
  id: string,
  sentVia: SendVia
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}/send`,
    {
      method: "POST",
      body: JSON.stringify({ sent_via: sentVia }),
    }
  );
  return response.data;
}

export async function cancelPurchaseOrder(
  id: string,
  reason: string
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
  return response.data;
}

export async function closePurchaseOrder(
  id: string,
  reason: string
): Promise<{ id: string; status: string }> {
  const response = await fetchApi<{ data: { id: string; status: string } }>(
    `${BASE}/po/${id}/close`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
  return response.data;
}

export async function getPurchaseOrderPaymentTerms(id: string): Promise<{
  terms: PurchaseOrderPaymentTerm[];
  payments: VendorPayment[];
}> {
  const response = await fetchApi<{
    data: {
      terms: PurchaseOrderPaymentTerm[];
      payments: VendorPayment[];
    };
  }>(`${BASE}/po/${id}/payment-terms`);
  return response.data;
}

export async function createVendorPayment(
  id: string,
  payload: {
    payment_term_id?: string | null;
    payment_date?: string;
    amount: number;
    method: VendorPayment["method"];
    reference_number?: string | null;
    notes?: string | null;
  }
): Promise<VendorPayment> {
  const response = await fetchApi<{ data: VendorPayment }>(
    `${BASE}/po/${id}/payments`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function listPOItems(
  poId: string
): Promise<PurchaseOrderItem[]> {
  const response = await fetchApi<{ data: PurchaseOrderItem[] }>(
    `${BASE}/po/${poId}/items`
  );
  return response.data;
}
