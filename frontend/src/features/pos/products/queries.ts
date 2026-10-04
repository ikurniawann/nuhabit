"use client";

import { useQuery } from "@tanstack/react-query";
import { listPosCatalogProducts, listPurchasingProductOptions } from "./api";
import { productsQueryKeys } from "./query-keys";

export const usePosCatalogProducts = () =>
  useQuery({
    queryKey: productsQueryKeys.catalog(),
    queryFn: listPosCatalogProducts,
  });

/** Dimuat saat dialog merchandise pertama kali dibuka, lalu di-cache. */
export const usePurchasingProductOptions = (enabled: boolean) =>
  useQuery({
    queryKey: productsQueryKeys.purchasingOptions(),
    queryFn: listPurchasingProductOptions,
    enabled,
    staleTime: Infinity,
  });
