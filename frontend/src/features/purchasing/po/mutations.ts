"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PurchaseOrderFormData, VendorPayment } from "@/types/purchasing";
import type { SendVia } from "@/lib/purchasing/po-ui-status";
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrderPaymentTerm,
  deletePurchaseOrderPaymentTerm,
  createVendorPayment,
} from "./api";
import { poQueryKeys } from "./query-keys";
import { vendorPaymentsQueryKeys } from "@/features/purchasing/vendor-payments/query-keys";

/** Mutasi PO yang cukup menyegarkan semua query PO setelah berhasil. */
function usePOMutation<TVars, TResult>(mutationFn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: poQueryKeys.all }),
  });
}

export const useCreatePurchaseOrder = () =>
  usePOMutation((payload: PurchaseOrderFormData) => createPurchaseOrder(payload));

export const useUpdatePurchaseOrder = () =>
  usePOMutation(({ id, payload }: { id: string; payload: Partial<PurchaseOrderFormData> }) =>
    updatePurchaseOrder(id, payload)
  );

export const useApprovePurchaseOrder = () => usePOMutation((id: string) => approvePurchaseOrder(id));

export const useSendPurchaseOrder = () =>
  usePOMutation(({ id, sentVia }: { id: string; sentVia: SendVia }) => sendPurchaseOrder(id, sentVia));

export const useCancelPurchaseOrder = () =>
  usePOMutation(({ id, reason }: { id: string; reason: string }) => cancelPurchaseOrder(id, reason));

export const useClosePurchaseOrder = () =>
  usePOMutation(({ id, reason }: { id: string; reason: string }) => closePurchaseOrder(id, reason));

export const useCreatePaymentTerm = () =>
  usePOMutation(
    ({ poId, payload }: { poId: string; payload: Parameters<typeof createPurchaseOrderPaymentTerm>[1] }) =>
      createPurchaseOrderPaymentTerm(poId, payload)
  );

export const useDeletePaymentTerm = () =>
  usePOMutation(({ poId, termId }: { poId: string; termId: string }) => deletePurchaseOrderPaymentTerm(poId, termId));

export const useCreateVendorPayment = () => {
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
      };
    }) => createVendorPayment(poId, payload),
    onSuccess: () => {
      // poQueryKeys.all mencakup detail & payments PO ini.
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: vendorPaymentsQueryKeys.all });
    },
  });
};
