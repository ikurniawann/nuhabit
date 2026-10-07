"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VendorFormData } from "./types";
import { vendorsQueryKeys } from "./query-keys";
import { createVendor, deactivateVendor, updateVendor } from "./api";

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VendorFormData) => createVendor(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorsQueryKeys.all }),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<VendorFormData> & { is_active?: boolean };
    }) => updateVendor(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorsQueryKeys.all }),
  });
}

export function useDeactivateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateVendor(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorsQueryKeys.all }),
  });
}
