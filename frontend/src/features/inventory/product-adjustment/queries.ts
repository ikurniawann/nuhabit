"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchStallAdjustLines } from "./api";

export const productAdjustmentKeys = {
  lines: (warehouseId: string) =>
    ["inventory", "product-adjustment", "lines", warehouseId] as const,
};

export function useStallAdjustLines(warehouseId: string) {
  return useQuery({
    queryKey: productAdjustmentKeys.lines(warehouseId),
    queryFn: () => fetchStallAdjustLines(warehouseId),
    enabled: Boolean(warehouseId),
    // Baris disunting lokal; jangan timpa saat user sedang mengisi.
    staleTime: Infinity,
  });
}
