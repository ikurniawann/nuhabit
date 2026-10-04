"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchActiveStallName,
  getCashierCheckout,
  getCashierOrder,
  listCashierTables,
  listCustomerFavoriteProducts,
  loadCashierCatalog,
  loadCashierCustomers,
} from "./api";
import { cashierQueryKeys } from "./query-keys";
import type { Product } from "./api";

export const useCashierTables = () =>
  useQuery({
    queryKey: cashierQueryKeys.tables(),
    queryFn: listCashierTables,
    // Restaurant board must refresh after cashier handoff returns.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

export const useCashierOrder = (orderId: string | null) =>
  useQuery({
    queryKey: cashierQueryKeys.order(orderId ?? ""),
    queryFn: () => getCashierOrder(orderId!),
    enabled: !!orderId,
  });

export const useCashierCheckout = (checkoutId: string | null) =>
  useQuery({
    queryKey: cashierQueryKeys.checkout(checkoutId ?? ""),
    queryFn: () => getCashierCheckout(checkoutId!),
    enabled: !!checkoutId,
  });

export const useCustomerFavoriteProducts = (
  customerId: string | null | undefined,
  products: Product[]
) =>
  useQuery({
    queryKey: cashierQueryKeys.favorites(customerId ?? ""),
    queryFn: () => listCustomerFavoriteProducts(customerId!, products),
    enabled: !!customerId && products.length > 0,
  });

/**
 * Katalog & customer dimuat ulang tiap kasir dibuka. Fallback cache offline ada
 * di queryFn, jadi kegagalan yang tersisa = server DAN cache gagal: jangan retry.
 */
export const useCashierCatalog = () =>
  useQuery({
    queryKey: cashierQueryKeys.catalog(),
    queryFn: loadCashierCatalog,
    retry: false,
    staleTime: 0,
  });

export const useCashierCustomers = () =>
  useQuery({
    queryKey: cashierQueryKeys.customers(),
    queryFn: loadCashierCustomers,
    retry: false,
    staleTime: 0,
  });

/** Nama stall aktif untuk header struk; stall hanya berubah lewat reload. */
export const useActiveStallName = () =>
  useQuery({
    queryKey: cashierQueryKeys.activeStall(),
    queryFn: fetchActiveStallName,
    staleTime: Infinity,
  });
