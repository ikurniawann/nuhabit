"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import type { CatalogCollection } from "@/lib/shop/types";

export type WholesaleAccount = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  discount_pct: number;
  min_order_idr: number;
  payment_terms: "invoice" | "pay_later";
  status: "active" | "disabled";
  last_login_at: string | null;
  created_at: string;
};

export type WholesaleSku = {
  id: string;
  sku: string;
  name: string;
  retailPrice: number;
  price: number;
  stock: number;
  preorder: boolean;
};

export type WholesaleProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  images: string[];
  collection: CatalogCollection | null;
  retailPrice: number;
  price: number;
  minQty: number;
  stock: number;
  preorder: boolean;
  preorderUntil: string | null;
  skus: WholesaleSku[];
};

/** Baris pesanan mitra; angka numeric datang sebagai string. */
export type WholesaleOrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_terms: "invoice" | "pay_later";
  due_at: string | null;
  subtotal: string;
  shipping_cost: string;
  total: string;
  waybill: string | null;
  paid_at: string | null;
  created_at: string;
  invoice_url: string | null;
  item_count: string;
};

export type WholesaleOrderDetail = WholesaleOrderRow & {
  shipping_address: string;
  notes: string | null;
  customer_name: string;
  items: Array<{
    product_name: string;
    sku_name: string | null;
    sku_code: string | null;
    quantity: string;
    unit_price: string;
    total: string;
    is_preorder: boolean;
  }>;
};

export const wholesaleKeys = {
  me: ["wholesale", "me"] as const,
  catalog: ["wholesale", "catalog"] as const,
  orders: ["wholesale", "orders"] as const,
  order: (id: string) => ["wholesale", "orders", id] as const,
};

/** Akun yang sedang masuk; null saat belum masuk (401). */
export const useWholesaleMe = () =>
  useQuery({
    queryKey: wholesaleKeys.me,
    queryFn: () =>
      fetch("/api/wholesale/me").then(async (res) => {
        if (res.status === 401) return null;
        const json = (await res.json().catch(() => ({}))) as { data?: WholesaleAccount; error?: string };
        if (!res.ok) throw new Error(json.error || "Gagal memuat akun");
        return json.data ?? null;
      }),
    retry: false,
    staleTime: 60_000,
  });

export const useWholesaleCatalog = (enabled: boolean) =>
  useQuery({
    queryKey: wholesaleKeys.catalog,
    queryFn: () => apiGet<{ data: WholesaleProduct[] }>("/api/wholesale/catalog").then((res) => res.data ?? []),
    enabled,
    retry: false,
  });

export const useWholesaleOrders = (enabled: boolean) =>
  useQuery({
    queryKey: wholesaleKeys.orders,
    queryFn: () => apiGet<{ data: WholesaleOrderRow[] }>("/api/wholesale/orders").then((res) => res.data ?? []),
    enabled,
    retry: false,
  });

export const useWholesaleOrder = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: wholesaleKeys.order(id),
    queryFn: () => apiGet<{ data: WholesaleOrderDetail }>(`/api/wholesale/orders/${id}`).then((res) => res.data),
    enabled,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 10_000 : false),
  });

export function useWholesaleLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiPost<{ data: WholesaleAccount }>("/api/wholesale/login", input).then((res) => res.data),
    onSuccess: (account) => queryClient.setQueryData(wholesaleKeys.me, account),
  });
}

export function useWholesaleLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost("/api/wholesale/logout", {}),
    onSuccess: () => {
      queryClient.setQueryData(wholesaleKeys.me, null);
      queryClient.removeQueries({ queryKey: wholesaleKeys.catalog });
      queryClient.removeQueries({ queryKey: wholesaleKeys.orders });
    },
  });
}

export type WholesaleOrderPayload = {
  items: Array<{ product_id: string; sku_id: string | null; quantity: number }>;
  shipping_address: string;
  notes: string | null;
};

export type WholesaleOrderResult = {
  id: string;
  order_number: string;
  status: string;
  invoice_url: string | null;
  status_url: string;
};

export function usePlaceWholesaleOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WholesaleOrderPayload) =>
      apiPost<{ data: WholesaleOrderResult }>("/api/wholesale/orders", payload).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wholesaleKeys.orders }),
  });
}
