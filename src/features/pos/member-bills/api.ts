/** Klien fetch halaman POS → Operasional → Tagihan (tagihan member). */

import type { MemberBillBalance } from "@/lib/pos/member-bill";
import type { PosPaymentMethod } from "@/lib/pos/payment-methods";

export type MemberBillSummary = {
  customer_id: string;
  name: string;
  phone: string | null;
  membership_tier: string | null;
  open_order_count: number;
  oldest_order_at: string | null;
  balance: MemberBillBalance;
};

export type MemberBillOrder = {
  id: string;
  order_number: string | null;
  queue_number: string | null;
  ordered_at: string;
  order_type: string | null;
  status: string;
  total_amount: number;
  items: { name: string; quantity: number; total_amount: number; options: string[] }[];
};

export type MemberBillPayment = {
  id: string;
  amount: number;
  payment_method: string;
  payment_method_name: string | null;
  reference_number: string | null;
  notes: string | null;
  received_by_name: string | null;
  settlement_id: string | null;
  created_at: string;
};

export type MemberBillDetail = {
  customer: { id: string; name: string; phone: string | null; membership_tier: string | null };
  balance: MemberBillBalance;
  open_orders: MemberBillOrder[];
  settled_orders: { id: string; order_number: string | null; ordered_at: string; total_amount: number; settled_at: string }[];
  payments: MemberBillPayment[];
};

export type PayMemberBillResult = {
  payment_id: string;
  balance: MemberBillBalance;
  settled_order_count: number;
  notes: string[];
};

export const memberBillKeys = {
  all: ["pos", "member-bills"] as const,
  list: (search: string) => ["pos", "member-bills", "list", search] as const,
  detail: (customerId: string) => ["pos", "member-bills", "detail", customerId] as const,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
  if (!response.ok || body.success === false) {
    throw new Error(body.error || "Permintaan gagal");
  }
  return body.data as T;
}

export function fetchMemberBills(search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  return request<MemberBillSummary[]>(`/api/pos/member-bills${params.size ? `?${params}` : ""}`);
}

export function fetchMemberBillDetail(customerId: string) {
  return request<MemberBillDetail>(`/api/pos/member-bills/${customerId}`);
}

export function fetchPaymentMethods() {
  return request<PosPaymentMethod[]>("/api/pos/payment-methods?active=1");
}

export function payMemberBill(
  customerId: string,
  body: {
    amount: number;
    payment_method_code: string;
    reference_number?: string | null;
    notes?: string | null;
    shift_id?: string | null;
  }
) {
  return request<PayMemberBillResult>(`/api/pos/member-bills/${customerId}/payments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function settleMemberBill(customerId: string) {
  return request<{ settled_order_count: number; notes: string[] }>(
    `/api/pos/member-bills/${customerId}/settle`,
    { method: "POST" }
  );
}
