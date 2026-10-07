"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { SupplierListParams } from "@/types/supplier";
import { suppliersQueryKeys } from "./query-keys";
import { listSuppliers, getSupplier, getSupplierPOHistory } from "@/lib/purchasing/supplier";
import type { PurchasePriceHistoryItem } from "./price-history-types";

export const useSupplierList = (params: SupplierListParams) =>
  useQuery({
    queryKey: suppliersQueryKeys.list(params),
    queryFn: () => listSuppliers(params),
    placeholderData: keepPreviousData,
  });

export const useSupplier = (id: string) =>
  useQuery({
    queryKey: suppliersQueryKeys.detail(id),
    queryFn: () => getSupplier(id),
    enabled: !!id,
  });

export const useSupplierPOHistory = (id: string) =>
  useQuery({
    queryKey: suppliersQueryKeys.poHistory(id),
    queryFn: () => getSupplierPOHistory(id),
    enabled: !!id,
  });

/** Riwayat harga beli dari GRN; materialId "all" = semua bahan baku. */
export const useSupplierPriceHistory = (supplierId: string, months: number, materialId: string) =>
  useQuery({
    queryKey: suppliersQueryKeys.priceHistory(supplierId, months, materialId),
    queryFn: async (): Promise<PurchasePriceHistoryItem[]> => {
      const params = new URLSearchParams({ months: String(months) });
      if (materialId !== "all") params.set("material_id", materialId);
      const response = await fetch(`/api/purchasing/suppliers/${supplierId}/price-history?${params}`);
      const result = (await response.json()) as { success?: boolean; data?: PurchasePriceHistoryItem[]; message?: string; error?: string };
      if (!result.success) throw new Error(result.message || result.error || "Kesalahan tidak diketahui");
      return result.data ?? [];
    },
    enabled: !!supplierId,
  });
