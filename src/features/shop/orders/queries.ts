"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";

export type ShopOrderRow = {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  shipping_area_label: string | null;
  courier_code: string | null;
  courier_service: string | null;
  total: string;
  waybill: string | null;
  item_count: string;
  customer_id: string | null;
  created_at: string;
};

export type ShopOrderDetail = ShopOrderRow & {
  shipping_address: string;
  shipping_postal_code: string | null;
  subtotal: string;
  shipping_cost: string;
  notes: string | null;
  shipment_provider: string | null;
  shipment_status: string | null;
  provider_order_id: string | null;
  items: Array<{
    product_name: string;
    sku_name: string | null;
    sku_code: string | null;
    quantity: string;
    unit_price: string;
    total: string;
  }>;
};

/** Aksi back-office pada satu order (status atau pengiriman). */
export type ShopOrderAction =
  | { kind: "transition"; status: "packing" | "completed" | "cancelled"; note?: string }
  | { kind: "ship-provider" }
  | { kind: "ship-manual"; waybill: string };

const keys = {
  all: ["shop", "orders"] as const,
  list: (status: string, search: string) => ["shop", "orders", "list", status, search] as const,
  detail: (id: string) => ["shop", "orders", "detail", id] as const,
};

export const useShopOrders = (status: string, search: string) =>
  useQuery({
    queryKey: keys.list(status, search),
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      return apiGet<{ data: ShopOrderRow[] }>(`/api/shop/orders?${params.toString()}`).then(
        (res) => res.data ?? []
      );
    },
    placeholderData: keepPreviousData,
  });

export const useShopOrderDetail = (orderId: string) =>
  useQuery({
    queryKey: keys.detail(orderId),
    queryFn: () => apiGet<{ data: ShopOrderDetail }>(`/api/shop/orders/${orderId}`).then((res) => res.data),
  });

function runOrderAction(orderId: string, action: ShopOrderAction) {
  switch (action.kind) {
    case "transition":
      return apiPatch(`/api/shop/orders/${orderId}`, { status: action.status, note: action.note });
    case "ship-provider":
      return apiPost(`/api/shop/orders/${orderId}/shipment`, { mode: "provider" });
    case "ship-manual":
      return apiPost(`/api/shop/orders/${orderId}/shipment`, { mode: "manual", waybill: action.waybill });
  }
}

export function useShopOrderAction(orderId: string, onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action }: { action: ShopOrderAction; successMessage: string }) =>
      runOrderAction(orderId, action),
    onSuccess: async (_result, { successMessage }) => {
      toast.success(successMessage);
      onDone();
      await queryClient.invalidateQueries({ queryKey: keys.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Aksi gagal"),
  });
}
