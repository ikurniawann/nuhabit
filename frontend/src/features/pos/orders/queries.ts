"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { loadOrderTransactionDetail } from "@/features/pos/reports/utils/load-order-detail";
import { listOrders } from "./api";
import { ordersQueryKeys } from "./query-keys";
import type { OrderListParams } from "./types";

export const useOrderList = (params: OrderListParams = { limit: 100 }) =>
  useQuery({
    queryKey: ordersQueryKeys.list(params),
    queryFn: () => listOrders(params),
    placeholderData: keepPreviousData,
  });

/** Detail transaksi satu order (plus cap checkout bila ada). */
export const useOrderTransactionDetail = (order: { id: string; checkout_id?: string | null } | null) =>
  useQuery({
    queryKey: ordersQueryKeys.detail(order?.id ?? ""),
    queryFn: () => loadOrderTransactionDetail(order!.id, order!.checkout_id),
    enabled: Boolean(order),
  });
