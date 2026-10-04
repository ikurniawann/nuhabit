"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { StockOpnameListParams } from "./types";
import {
  getStockOpname,
  listStockOpnamePreview,
  listStockOpnameWarehouses,
  listStockOpnames,
} from "./api";
import { stockOpnameQueryKeys } from "./query-keys";

export const useStockOpnameList = (params: StockOpnameListParams) =>
  useQuery({
    queryKey: stockOpnameQueryKeys.list(params),
    queryFn: () => listStockOpnames(params),
    placeholderData: keepPreviousData,
  });

export const useStockOpname = (id: string) =>
  useQuery({
    queryKey: stockOpnameQueryKeys.detail(id),
    queryFn: () => getStockOpname(id),
    enabled: !!id,
  });

export const useStockOpnameWarehouses = () =>
  useQuery({
    queryKey: stockOpnameQueryKeys.warehouses(),
    queryFn: listStockOpnameWarehouses,
  });

export const useStockOpnamePreview = (warehouseId: string) =>
  useQuery({
    queryKey: stockOpnameQueryKeys.preview(warehouseId),
    queryFn: () => listStockOpnamePreview(warehouseId),
    enabled: !!warehouseId,
  });
