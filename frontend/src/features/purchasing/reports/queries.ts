"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listStockWarehouses } from "@/features/inventory/stock/api";
import { useSupplierList } from "@/features/purchasing/suppliers/queries";
import {
  getSupplierPerformance,
  getPoSummary,
  getStockCard,
  getInventoryValuation,
  getPoDetailReport,
  getProductionInHouseReport,
} from "./api";
import { reportsQueryKeys } from "./query-keys";
import type {
  InventoryValuationParams,
  PODetailParams,
  POSummaryParams,
  ProductionInHouseParams,
  StockCardParams,
} from "./types";

export const useSupplierPerformance = (params: {
  date_from?: string;
  date_to?: string;
  supplier_id?: string;
}) =>
  useQuery({
    queryKey: reportsQueryKeys.supplierPerformance(params),
    queryFn: () => getSupplierPerformance(params),
    placeholderData: keepPreviousData,
  });

export const usePoSummary = (params: POSummaryParams) =>
  useQuery({
    queryKey: reportsQueryKeys.poSummary(params),
    queryFn: () => getPoSummary(params),
    placeholderData: keepPreviousData,
  });

export const useStockCard = (params: StockCardParams) =>
  useQuery({
    queryKey: reportsQueryKeys.stockCard(params),
    queryFn: () => getStockCard(params),
    placeholderData: keepPreviousData,
  });

export const useInventoryValuation = (params: InventoryValuationParams) =>
  useQuery({
    queryKey: reportsQueryKeys.inventoryValuation(params),
    queryFn: () => getInventoryValuation(params),
    placeholderData: keepPreviousData,
  });

export const usePoDetailReport = (params: PODetailParams) =>
  useQuery({
    queryKey: reportsQueryKeys.poDetail(params),
    queryFn: () => getPoDetailReport(params),
    placeholderData: keepPreviousData,
  });

export const useProductionInHouseReport = (params: ProductionInHouseParams) =>
  useQuery({
    queryKey: reportsQueryKeys.productionInHouse(params),
    queryFn: () => getProductionInHouseReport(params),
    placeholderData: keepPreviousData,
  });

export const useStockWarehouses = () =>
  useQuery({
    queryKey: reportsQueryKeys.warehouses,
    queryFn: listStockWarehouses,
  });

/** Opsi combobox supplier aktif ("Semua Supplier" + kode — nama). */
export function useSupplierFilterOptions() {
  const suppliersQuery = useSupplierList({ is_active: true, limit: 100 });
  const suppliers = suppliersQuery.data?.data;
  return useMemo(
    () => [
      { value: "all", label: "Semua Supplier" },
      ...(suppliers ?? []).map((supplier) => ({
        value: supplier.id,
        label: `${supplier.kode || supplier.kode_supplier || "-"} — ${supplier.nama_supplier}`,
      })),
    ],
    [suppliers]
  );
}
