"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ProductStockOpnameListParams } from "./types";
import {
  getProductStockOpname,
  listProductStockOpnamePreview,
  listProductStockOpnameWarehouses,
  listProductStockOpnames,
} from "./api";
import { productStockOpnameQueryKeys } from "./query-keys";

export const useProductStockOpnameList = (
  params: ProductStockOpnameListParams,
) =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.list(params),
    queryFn: () => listProductStockOpnames(params),
    placeholderData: keepPreviousData,
  });

export const useProductStockOpname = (id: string) =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.detail(id),
    queryFn: () => getProductStockOpname(id),
    enabled: !!id,
  });

export const useProductStockOpnamePreview = (warehouseId: string) =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.preview(warehouseId),
    queryFn: () => listProductStockOpnamePreview(warehouseId),
    enabled: !!warehouseId,
  });

export const useProductStockOpnameWarehouses = () =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.warehouses(),
    queryFn: listProductStockOpnameWarehouses,
    staleTime: 5 * 60 * 1000,
  });
