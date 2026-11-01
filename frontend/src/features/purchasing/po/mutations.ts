"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PurchaseOrderFormData } from "@/types/purchasing";
import type { SendVia } from "@/lib/purchasing/po-ui-status";
import { createApPayment } from "@/features/accounting/ap/api";
import { apKeys } from "@/features/accounting/ap/query-keys";
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrderPaymentTerm,
  deletePurchaseOrderPaymentTerm,
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

/**
 * Bayar PO lewat Accounting AP: pembayaran dialokasikan ke satu invoice AP PO,
 * lalu server mencatat vendor payment dan termin PO dalam transaksi yang sama.
 */
export const usePayPurchaseOrderInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createApPayment,
    onSuccess: () => {
      // poQueryKeys.all mencakup detail & payments PO ini.
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: apKeys.all });
      queryClient.invalidateQueries({ queryKey: vendorPaymentsQueryKeys.all });
    },
  });
};
