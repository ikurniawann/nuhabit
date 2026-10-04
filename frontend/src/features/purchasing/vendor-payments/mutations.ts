"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createVendorPayment } from "@/features/purchasing/po/api";
import { poQueryKeys } from "@/features/purchasing/po/query-keys";
import type { VendorPayment } from "@/types/purchasing";
import { vendorPaymentsQueryKeys } from "./query-keys";

export const usePayPurchaseInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      poId,
      payload,
    }: {
      poId: string;
      payload: {
        payment_term_id?: string | null;
        payment_date?: string;
        amount: number;
        method: VendorPayment["method"];
        reference_number?: string | null;
        notes?: string | null;
        /** Arsip nota hasil scan (EPIC-018 Fase B). */
        receipt_path?: string | null;
        receipt_name?: string | null;
      };
    }) => createVendorPayment(poId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vendorPaymentsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.payments(variables.poId) });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.detail(variables.poId) });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
    },
  });
};
