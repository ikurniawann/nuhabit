"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createVendorPriceList,
  updateVendorPriceList,
  deleteVendorPriceList,
} from "./api";
import { vendorPriceListQueryKeys } from "./query-keys";
import type { VendorPriceListFormData } from "./types";

export function useCreateVendorPriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VendorPriceListFormData) => createVendorPriceList(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorPriceListQueryKeys.all }),
  });
}

export function useUpdateVendorPriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<VendorPriceListFormData> & { is_active?: boolean };
    }) => updateVendorPriceList(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorPriceListQueryKeys.all }),
  });
}

export function useDeleteVendorPriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVendorPriceList(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorPriceListQueryKeys.all }),
  });
}
