"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  listSourceStockLines,
  listStockTransfers,
  listTransferWarehouses,
} from "./api";
import { stockTransferQueryKeys } from "./query-keys";
import type { StockTransferListParams } from "./types";

export const useStockTransferList = (params: StockTransferListParams) =>
  useQuery({
    queryKey: stockTransferQueryKeys.list(params),
    queryFn: () => listStockTransfers(params),
    placeholderData: keepPreviousData,
  });

export const useTransferWarehouses = () =>
  useQuery({
    queryKey: stockTransferQueryKeys.warehouses(),
    queryFn: listTransferWarehouses,
  });

export const useTransferSourceStock = (warehouseId: string) =>
  useQuery({
    queryKey: stockTransferQueryKeys.sourceStock(warehouseId),
    queryFn: () => listSourceStockLines(warehouseId),
    enabled: !!warehouseId,
  });
