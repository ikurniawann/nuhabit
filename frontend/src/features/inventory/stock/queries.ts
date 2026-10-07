"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listProductStock, listRawMaterialStock } from "./api";
import { stockQueryKeys } from "./query-keys";
import type { StockListParams } from "./types";

export const useRawMaterialStock = (params: StockListParams) =>
  useQuery({
    queryKey: stockQueryKeys.rawMaterial(params),
    queryFn: () => listRawMaterialStock(params),
    placeholderData: keepPreviousData,
  });

export const useProductStock = (params: StockListParams) =>
  useQuery({
    queryKey: stockQueryKeys.product(params),
    queryFn: () => listProductStock(params),
    placeholderData: keepPreviousData,
  });
